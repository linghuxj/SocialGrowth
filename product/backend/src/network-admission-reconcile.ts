import { Pool } from "pg";
import { readAdmissionReconciliationOptions } from "./admission-reconciliation-options.js";
import { NetworkAdmissionStore } from "./network-admission-store.js";

async function main(): Promise<void> {
  const options = readAdmissionReconciliationOptions(process.argv.slice(2), process.env);
  const pool = new Pool({ connectionString: options.databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  pool.on("error", () => {
    process.stderr.write("[admission-reconcile] Database connection failed\n");
    process.exitCode = 1;
  });
  try {
    const batch = await new NetworkAdmissionStore(pool).reconcileBatch(options.limit, options.cursor);
    process.stdout.write(`${JSON.stringify({ scope: "internal_admission_reclamation_intents_only", ...batch })}\n`);
    if (batch.failures.length) process.exitCode = 1;
  } finally { await pool.end(); }
}

main().catch(() => {
  // Configuration/driver messages may include a URL, password or query detail.
  process.stderr.write("[admission-reconcile] Batch failed; no external revocation success asserted\n");
  process.exitCode = 1;
});
