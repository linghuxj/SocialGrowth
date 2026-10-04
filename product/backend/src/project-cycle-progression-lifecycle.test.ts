import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";
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

test("pool connection timeout closes a stalled PostgreSQL handshake before pool shutdown", async () => {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const pool = new Pool({ host: "127.0.0.1", port: address.port, user: "isolated-timeout-fixture",
    database: "isolated-timeout-fixture", connectionTimeoutMillis: 60, max: 1 });
  const startedAt = Date.now();
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const connectResult = Promise.race([pool.connect(), new Promise<never>((_resolve, reject) => {
      guard = setTimeout(() => reject(new Error("test_guard_timeout")), 1_000);
    })]);
    await assert.rejects(connectResult, /Connection terminated due to connection timeout/);
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(pool.totalCount, 0);
    const shutdownAt = Date.now();
    await pool.end();
    assert.ok(Date.now() - shutdownAt < 1_000);
    assert.equal(pool.totalCount, 0);
  } finally {
    if (guard) clearTimeout(guard);
    for (const socket of sockets) socket.destroy();
    if (pool.ended === false) await pool.end();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
