import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const require = createRequire(new URL("../product/backend/package.json", import.meta.url));
const { Pool } = require("pg") as typeof import("pg");
const config = JSON.parse(await readFile(new URL("../.runtime/product-local-live/config.json", import.meta.url), "utf8"));
const url = new URL("postgresql://socialgrowth@127.0.0.1:55432/sg_product_local_live"); url.password = config.databasePassword;
const pool = new Pool({ connectionString: url.toString() }), database = `sg_identity_verification_test_${randomBytes(6).toString("hex")}`;
let created = false;
try {
  await pool.query(`CREATE DATABASE ${database}`); created = true; url.pathname = `/${database}`;
  const child = spawn("pnpm", ["exec", "tsx", "--tsconfig", "product/backend/tsconfig.json", "--test", "product/backend/src/identity-verification.pg-test.ts"],
    { stdio: "inherit", env: { ...process.env, SG_PRODUCT_TEST_DATABASE_URL: url.toString() } });
  const code = await new Promise<number | null>((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  if (code !== 0) throw new Error("Isolated identity component checks failed");
} finally { if (created) await pool.query(`DROP DATABASE ${database}`); await pool.end(); }
