import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { ProjectCycleProgressionLifecycle } from "./project-cycle-progression-lifecycle.js";

test("one failed due project does not prevent later projects in the bounded page", async () => {
  const lifecycle = new ProjectCycleProgressionLifecycle({} as Pool);
  const source = lifecycle as unknown as {
    dueProjects(): Promise<string[]>;
    advanceOne(projectId: string): Promise<void>;
    sweep(): Promise<void>;
    afterProjectId: string | null;
  };
  const projectIds = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
  const attempted: string[] = [];
  source.dueProjects = async () => projectIds;
  source.advanceOne = async projectId => {
    attempted.push(projectId);
    if (projectId === projectIds[0]) throw new Error("test-only store failure");
  };

  await source.sweep();

  assert.deepEqual(attempted, projectIds);
  assert.equal(source.afterProjectId, projectIds.at(-1));
});

test("client query timeout discards the connection and prevents reuse", async () => {
  const lifecycle = new ProjectCycleProgressionLifecycle({} as Pool);
  const source = lifecycle as unknown as {
    withQueryBudget(client: PoolClient, deadline: number): PoolClient;
  };
  const seenTimeouts: number[] = [];
  let releasedWith: Error | boolean | undefined;
  let call = 0;
  const client = {
    query: async (config: { text: string; query_timeout?: number }) => {
      seenTimeouts.push(config.query_timeout ?? 0);
      call += 1;
      if (call === 3) throw new Error("Query read timeout");
      return { rows: [], rowCount: 0 };
    },
    release: (error?: Error | boolean) => { releasedWith = error; },
  } as unknown as PoolClient;
  const bounded = source.withQueryBudget(client, Date.now() + 1_000);

  await assert.rejects(bounded.query("SELECT pg_sleep(1)"), /Query read timeout/);
  assert.ok(seenTimeouts.every(timeout => timeout > 0 && timeout <= 1_000));
  assert.equal(releasedWith instanceof Error ? releasedWith.message : releasedWith, "progression_query_timeout");
  await assert.rejects(bounded.query("ROLLBACK"), /progression_query_timeout/);
  bounded.release();
  assert.equal(releasedWith instanceof Error ? releasedWith.message : releasedWith, "progression_query_timeout");
});
