import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { ProjectCycleStore } from "./project-cycle-store.js";

const s = "socialgrowth_product";
const TICK_MS = 30_000;
const PROJECTS_PER_TICK = 20;
const SWEEP_BUDGET_MS = 25_000;
const MAX_POOL_WAIT_MS = 5_000;

/** A small backend-owned due pass. It writes only one immutable successor per
 * due project per tick; it never starts strategy, Task, metrics, or execution work. */
@Injectable()
export class ProjectCycleProgressionLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private afterProjectId: string | null = null;
  private readonly cycles = new ProjectCycleStore();

  constructor(@Inject(Pool) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.sweep().catch(() => {
        // Keep diagnostics finite and never print SQL or operator/project data.
        console.warn(JSON.stringify({ event: "project_cycle_progression_failed" }));
      }).finally(() => {
        this.running = undefined;
        this.schedule(TICK_MS);
      });
    }, delay);
    this.timer.unref?.();
  }

  private async sweep(): Promise<void> {
    const deadline = Date.now() + SWEEP_BUDGET_MS;
    const projectIds = await this.dueProjects(deadline);
    if (projectIds.length === 0) {
      this.afterProjectId = null;
      return;
    }
    for (const projectId of projectIds) {
      if (this.stopped || Date.now() >= deadline) return;
      try {
        await this.advanceOne(projectId, deadline);
      } catch {
        // Keep later projects moving; revisit this project after keyset wrap.
        console.warn(JSON.stringify({ event: "project_cycle_progression_project_failed" }));
      } finally {
        this.afterProjectId = projectId;
      }
    }
    // A short page reached the end of the keyset. Wrap next tick so projects
    // that became due while this bounded pass was running are not starved.
    if (projectIds.length < PROJECTS_PER_TICK) this.afterProjectId = null;
  }

  private async dueProjects(deadline: number): Promise<string[]> {
    const c = await this.connectBounded(deadline);
    const bounded = this.withQueryBudget(c, deadline);
    try {
      await bounded.query("BEGIN");
      const rows = await bounded.query<{ project_id: string }>(`WITH tick AS MATERIALIZED (
          SELECT to_char(date_trunc('second', clock_timestamp() AT TIME ZONE 'UTC'),
            'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS due_cutoff
        )
        SELECT cycle.project_id
        FROM ${s}.project_review_cycles cycle CROSS JOIN tick
        WHERE cycle.ends_at COLLATE "C"<=tick.due_cutoff COLLATE "C"
          AND ($1::uuid IS NULL OR cycle.project_id>$1::uuid)
          AND NOT EXISTS (SELECT 1 FROM ${s}.project_review_cycles newer
            WHERE newer.project_id=cycle.project_id AND newer.cycle_number>cycle.cycle_number)
          AND NOT EXISTS (
            SELECT 1 FROM (SELECT intent FROM ${s}.project_lifecycle_intents
              WHERE project_id=cycle.project_id ORDER BY revision DESC LIMIT 1) latest
            WHERE latest.intent='end_requested')
        ORDER BY cycle.project_id LIMIT $2`, [this.afterProjectId, PROJECTS_PER_TICK]);
      await bounded.query("COMMIT");
      return rows.rows.map(row => row.project_id);
    } catch (error) {
      try { await bounded.query("ROLLBACK"); } catch { /* Release any failed discovery transaction. */ }
      throw error;
    } finally {
      bounded.release();
    }
  }

  private async advanceOne(projectId: string, deadline: number): Promise<void> {
    const c = await this.connectBounded(deadline);
    const bounded = this.withQueryBudget(c, deadline);
    try {
      await bounded.query("BEGIN");
      for (const guard of ["material_registry_guard", "resource_reservation_guard", "business_plan_guard"]) {
        if ((await bounded.query(`SELECT 1 FROM ${s}.${guard} WHERE singleton=true FOR UPDATE`)).rowCount !== 1) {
          throw new Error("progression_guard_unavailable");
        }
      }
      if ((await bounded.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rowCount !== 1) {
        await bounded.query("ROLLBACK");
        return;
      }
      const now = (await bounded.query<{ observed_at: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at`)).rows[0]?.observed_at;
      if (!now) throw new Error("progression_clock_unavailable");
      await this.cycles.appendDueSuccessor(bounded, projectId, now);
      await bounded.query("COMMIT");
    } catch (error) {
      try { await bounded.query("ROLLBACK"); } catch { /* Pool client is released below. */ }
      throw error;
    } finally {
      bounded.release();
    }
  }

  private async connectBounded(deadline: number): Promise<PoolClient> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = this.pool.connect().then(client => {
      if (expired) {
        client.release();
        throw new Error("progression_pool_acquire_timeout");
      }
      return client;
    });
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        const wait = Math.min(MAX_POOL_WAIT_MS, Math.max(0, deadline - Date.now()));
        timer = setTimeout(() => { expired = true; reject(new Error("progression_pool_acquire_timeout")); }, wait);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private withQueryBudget(client: PoolClient, deadline: number): PoolClient {
    const rawQuery = client.query.bind(client) as unknown as (config: {
      text: string;
      values?: unknown[];
      query_timeout: number;
    }) => Promise<unknown>;
    let discarded = false;
    let transactionOpen = false;
    let timeoutError: Error | undefined;
    const execute = async (text: string, values?: unknown[]): Promise<unknown> => {
      if (discarded) throw timeoutError ?? new Error("progression_client_discarded");
      const remaining = Math.floor(deadline - Date.now());
      if (remaining <= 0) throw new Error("progression_sweep_deadline");
      try {
        const result = await rawQuery({ text, values, query_timeout: remaining });
        if (/^\s*BEGIN\b/i.test(text)) transactionOpen = true;
        if (/^\s*(COMMIT|ROLLBACK)\b/i.test(text)) transactionOpen = false;
        return result;
      } catch (error) {
        // pg's query_timeout is a client-side response timer. If it fires while
        // a request is in flight, discard the client so the pool cannot reuse
        // a socket whose server-side query may still be running.
        if (error instanceof Error && error.message === "Query read timeout") {
          timeoutError = new Error("progression_query_timeout");
          discarded = true;
          client.release(timeoutError);
        }
        throw error;
      }
    };
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property === "query") return async (...args: Parameters<PoolClient["query"]>) => {
          const remaining = Math.floor(deadline - Date.now());
          if (remaining <= 0) throw new Error("progression_sweep_deadline");
          const text = args[0] as string;
          if (/^\s*BEGIN\b/i.test(text)) return execute(text, args[1] as unknown[] | undefined);
          await execute(`SET LOCAL statement_timeout='${remaining}ms'`);
          await execute(`SET LOCAL lock_timeout='${Math.min(5_000, remaining)}ms'`);
          return execute(text, args[1] as unknown[] | undefined);
        };
        if (property === "release") return (...args: Parameters<PoolClient["release"]>) => {
          if (discarded) return;
          if (transactionOpen || Date.now() >= deadline) {
            client.release(new Error("progression_client_discarded_with_open_transaction"));
          } else {
            client.release(...args);
          }
        };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
}
