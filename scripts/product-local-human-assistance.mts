import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// R-157 development assistance only. Registration, association and participation
// must still be submitted in the actual App, never through this helper.
const dir = resolve(".runtime/product-local-live");
const mode = process.argv[2];
let stage = "configuration";
interface LocalConfig { databasePassword: string; clusterId: string; developmentSmsToken: string }
interface Challenge { challenge_id: string; delivery_state: string; expires_at: Date; verification_id: string | null }
interface PgClient {
  query<T extends object>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}
async function main(): Promise<void> {
  assert.ok(mode === "status" || mode === "sms" || mode === "participation", "Use status, sms or participation");
  const configPath = resolve(dir, "config.json"), info = await lstat(configPath);
  assert.ok(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0);
  const config = JSON.parse(await readFile(configPath, "utf8")) as LocalConfig;
  const { Client } = createRequire(resolve("product/backend/package.json"))("pg") as {
    Client: new (input: { connectionString: string }) => PgClient & { connect(): Promise<void> };
  };
  const client = new Client({ connectionString: `postgresql://socialgrowth:${config.databasePassword}@127.0.0.1:55432/sg_product_local_live` });
  await client.connect();
  stage = "database_read";
  let challenge: Challenge | undefined;
  try {
    await client.query("BEGIN READ ONLY");
    const actual = (await client.query<{ database: string; cluster: string }>("SELECT current_database() AS database, system_identifier::text AS cluster FROM pg_control_system()")).rows[0]!;
    assert.equal(actual.database, "sg_product_local_live"); assert.equal(actual.cluster, config.clusterId);
    challenge = (await client.query<Challenge>(`SELECT challenge_id,delivery_state,expires_at,verification_id
      FROM socialgrowth_product.phone_verification_challenges WHERE phone_e164=$1
      AND purpose='provider_registration' ORDER BY created_at DESC LIMIT 1`, ["+15555550123"])).rows[0];
    if (mode === "status") {
      const counts = (await client.query<{ providers: number; associations: number; installations: number }>(`SELECT
        (SELECT count(*)::int FROM socialgrowth_product.providers) AS providers,
        (SELECT count(*)::int FROM socialgrowth_product.device_associations WHERE ended_at IS NULL) AS associations,
        (SELECT count(*)::int FROM socialgrowth_product.installations) AS installations`)).rows[0]!;
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...counts,
        challengeRequested: Boolean(challenge), challengeExpiresAt: challenge?.expires_at ?? null,
        challengeDeliveryState: challenge?.delivery_state ?? null, evidenceScope: "read_only_supplement_only" }));
    }
    if (mode === "participation") {
      const devices = (await client.query<{ device_id: string; state: string; generation: string }>(`SELECT
        d.device_id,d.state,i.generation::text FROM socialgrowth_product.devices d
        JOIN socialgrowth_product.device_associations a ON a.device_id=d.device_id AND a.ended_at IS NULL
        JOIN socialgrowth_product.installations i ON i.installation_id=a.installation_id`)).rows;
      assert.equal(devices.length, 1, "Exactly one actual associated device required");
      const current = (await client.query<Record<string, unknown>>(`SELECT p.sequence,p.command_kind,
        p.receipt->>'runId' AS run_id,p.receipt->>'state' AS participation_state,
        p.receipt->>'checkedAt' AS checked_at,p.receipt->>'validUntil' AS valid_until,
        p.receipt->>'actionPermissionGranted' AS action_permission_granted,p.receipt->>'stopConfirmed' AS stop_confirmed,
        r.revoked_at,j.disposition AS control_disposition,j.control_generation,
        (p.receipt->>'scope') IS NOT NULL AS has_scope,
        (p.receipt->'scope'->>'associationId'=a.association_id::text
          AND p.receipt->'scope'->>'installationId'=a.installation_id::text
          AND p.receipt->'scope'->>'deviceId'=a.device_id::text
          AND p.receipt->'scope'->>'installationGeneration'=i.generation::text) AS current_association_matches
        FROM socialgrowth_product.local_participation p
        JOIN socialgrowth_product.device_associations a ON a.device_id=p.device_id AND a.ended_at IS NULL
        JOIN socialgrowth_product.installations i ON i.installation_id=a.installation_id
        LEFT JOIN socialgrowth_product.local_participation_runs r ON r.run_id=(p.receipt->>'runId')::uuid
        LEFT JOIN socialgrowth_product.phone_control_journals j ON j.device_id=p.device_id
        WHERE p.device_id=$1`, [devices[0]!.device_id])).rows[0] ?? null;
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), device: devices[0], participation: current,
        evidenceScope: "read_only_supplement_only", physicalControlAccepted: false }));
    }
    await client.query("COMMIT");
  } finally { await client.end(); }
  if (mode !== "sms") return;
  stage = "current_challenge_check";
  assert.ok(challenge && challenge.expires_at.getTime() > Date.now() && !challenge.verification_id,
    "No current unused App-requested challenge; ask user to request a fresh code");
  stage = "protected_code_read";
  const response = await fetch("http://127.0.0.1:4320/internal/development/provider-sms-codes/read", {
    method: "POST", headers: { "content-type": "application/json", "x-development-sms-token": config.developmentSmsToken },
    body: JSON.stringify({ challengeId: challenge.challenge_id, requestId: `local-human-${randomUUID()}` }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) console.error(JSON.stringify({ event: "protected_code_read_denied", httpStatus: response.status }));
  assert.ok(response.ok, "Protected development code read failed");
  const result = await response.json() as { challengeId: string; code: string };
  assert.equal(result.challengeId, challenge.challenge_id); assert.match(result.code, /^[0-9]{4,8}$/);
  stage = "private_code_file";
  const codePath = resolve(dir, "current-development-code.txt");
  try {
    const old = await lstat(codePath); assert.ok(old.isFile() && !old.isSymbolicLink() && (old.mode & 0o077) === 0);
  } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
  await writeFile(codePath, `仅用于本次模拟器开发注册，不是真实短信。\n验证码：${result.code}\n有效至：${challenge.expires_at.toISOString()}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ event: "development_code_private_file_ready", path: codePath,
    expiresAt: challenge.expires_at, actualSmsDeliveryVerified: false }));
}
await main().catch((error: unknown) => {
  // Never echo raw database, HTTP payloads or assertion actual/expected secrets.
  console.error(JSON.stringify({ event: "local_development_assistance_unavailable", stage,
    errorClass: error instanceof Error ? error.name : "unknown",
    helperLine: error instanceof Error ? error.stack?.match(/product-local-human-assistance\.mts:(\d+):/)?.[1] : undefined,
    businessStateChanged: false }));
  process.exitCode = 1;
});
