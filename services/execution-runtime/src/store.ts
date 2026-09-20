import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createEmptyFirstLoopState } from "../../../apps/web-console/lib/first-loop/engine.ts";
import type { FirstLoopState } from "../../../apps/web-console/lib/first-loop/types.ts";

export class RuntimeStore {
  readonly db: DatabaseSync;
  private transactionDepth = 0;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY, payload TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings (id TEXT PRIMARY KEY, device TEXT NOT NULL, platform TEXT NOT NULL, account TEXT NOT NULL UNIQUE, body TEXT NOT NULL, UNIQUE(device,platform));
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, schedule TEXT NOT NULL UNIQUE, attempt TEXT NOT NULL UNIQUE, identity TEXT NOT NULL, device TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, claimed_at TEXT, receipt TEXT);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, task TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, task TEXT NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL, body BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, task TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pauses (scope TEXT PRIMARY KEY, reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, payload TEXT NOT NULL, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL);
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO state VALUES (1,0,?)")
      .run(JSON.stringify(createEmptyFirstLoopState()));
  }
  snapshot(): { revision: number; state: FirstLoopState } {
    const row = this.db.prepare("SELECT revision,body FROM state WHERE id=1").get()!;
    return { revision: row.revision as number, state: JSON.parse(row.body as string) };
  }
  save(state: FirstLoopState): void {
    this.db
      .prepare("UPDATE state SET revision=revision+1,body=? WHERE id=1")
      .run(JSON.stringify(state));
  }
  transaction<T>(operation: () => T): T {
    const depth = this.transactionDepth++;
    const point = `nested_${depth}`;
    this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${point}`);
    try {
      const result = operation();
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${point}`);
      return result;
    } catch (error) {
      this.db.exec(
        depth === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${point}; RELEASE SAVEPOINT ${point}`,
      );
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.db.close();
  }
}
