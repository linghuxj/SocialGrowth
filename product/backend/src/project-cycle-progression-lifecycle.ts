import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { ProjectCycleStore } from "./project-cycle-store.js";

const s = "socialgrowth_product";
const TICK_MS = 30_000;
const PROJECTS_PER_TICK = 20;

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
    const projectIds = await this.dueProjects();
    if (projectIds.length === 0) {
      this.afterProjectId = null;
      return;
    }
    for (const projectId of projectIds) {
      if (this.stopped) return;
      await this.advanceOne(projectId);
      this.afterProjectId = projectId;
    }
    // A short page reached the end of the keyset. Wrap next tick so projects
    // that became due while this bounded pass was running are not starved.
    if (projectIds.length < PROJECTS_PER_TICK) this.afterProjectId = null;
  }

  private async dueProjects(): Promise<string[]> {
    const c = await this.pool.connect();
    try {
      const rows = await c.query<{ project_id: string }>(`WITH tick AS MATERIALIZED (
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
      return rows.rows.map(row => row.project_id);
    } finally {
      c.release();
    }
  }

  private async advanceOne(projectId: string): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='15s'");
      for (const guard of ["material_registry_guard", "resource_reservation_guard", "business_plan_guard"]) {
        if ((await c.query(`SELECT 1 FROM ${s}.${guard} WHERE singleton=true FOR UPDATE`)).rowCount !== 1) {
          throw new Error("progression_guard_unavailable");
        }
      }
      if ((await c.query(`SELECT 1 FROM ${s}.projects WHERE project_id=$1 FOR UPDATE`, [projectId])).rowCount !== 1) {
        await c.query("ROLLBACK");
        return;
      }
      const now = (await c.query<{ observed_at: string }>(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed_at`)).rows[0]?.observed_at;
      if (!now) throw new Error("progression_clock_unavailable");
      await this.cycles.appendDueSuccessor(c, projectId, now);
      await c.query("COMMIT");
    } catch (error) {
      try { await c.query("ROLLBACK"); } catch { /* Pool client is released below. */ }
      throw error;
    } finally {
      c.release();
    }
  }
}
