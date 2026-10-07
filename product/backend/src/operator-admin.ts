import { Pool } from "pg";

import { OperatorAuthService } from "./operator-auth-service.js";

interface ParsedArguments {
  command: "initialize" | "recover";
  values: Map<string, string>;
}

function parseArguments(arguments_: string[]): ParsedArguments {
  const normalizedArguments = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const [command, ...rest] = normalizedArguments;
  if (command !== "initialize" && command !== "recover") {
    throw new Error("Expected command: initialize or recover");
  }
  const values = new Map<string, string>();
  const allowed =
    command === "initialize"
      ? new Set(["login-name", "display-name", "request-id"])
      : new Set(["operator-id", "request-id"]);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Arguments must use --name value pairs; passwords are stdin-only");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`Unexpected or duplicate argument --${name}`);
    }
    values.set(name, value);
  }
  return { command, values };
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("Password must be piped through standard input");
  }
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input.replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.SG_PRODUCT_DATABASE_URL;
  if (!databaseUrl) throw new Error("SG_PRODUCT_DATABASE_URL is required");
  const securityPepper = process.env.SG_PRODUCT_AUTH_PEPPER;
  if (!securityPepper) throw new Error("SG_PRODUCT_AUTH_PEPPER is required");
  const { command, values } = parseArguments(process.argv.slice(2));
  const password = await readPassword();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const service = new OperatorAuthService(pool, securityPepper);
    const operator =
      command === "initialize"
        ? await service.initializeFirstOperator({
            loginName: required(values, "login-name"),
            displayName: required(values, "display-name"),
            requestId: required(values, "request-id"),
            password,
          })
        : await service.recoverOperator({
            operatorId: required(values, "operator-id"),
            requestId: required(values, "request-id"),
            newPassword: password,
          });
    process.stdout.write(`${JSON.stringify({ operator })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown operator admin failure";
  process.stderr.write(`[operator-admin] ${message}\n`);
  process.exitCode = 1;
});
