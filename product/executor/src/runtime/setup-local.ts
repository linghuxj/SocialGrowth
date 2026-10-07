import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { requireFact } from "./contracts.js";

const root = resolve(process.argv[2] ?? ".");
const serial = process.argv[3] ?? "";
requireFact(
  existsSync(resolve(root, ".venv/bin/python")) &&
    /^[A-Za-z0-9._:-]+$/.test(serial) &&
    !serial.startsWith("emulator-"),
  "EXISTING_ARTEMIS_AND_PHYSICAL_SERIAL_REQUIRED",
);
const runtimePath = resolve(".env.runtime"),
  agentPath = resolve(".env.agent");
requireFact(!existsSync(runtimePath) && !existsSync(agentPath), "LOCAL_CONFIG_ALREADY_EXISTS");
const operator = randomBytes(32).toString("hex"),
  agent = randomBytes(32).toString("hex"),
  signing = randomBytes(32).toString("hex");
writeFileSync(
  runtimePath,
  [
    `SG_RUNTIME_TOKEN=${operator}`,
    `SG_MEDIA_SIGNING_KEY=${signing}`,
    `SG_DEVICE_TOKENS='${JSON.stringify({ [serial]: agent })}'`,
    "SG_RUNTIME_PORT=4318",
    "SG_RUNTIME_URL=http://127.0.0.1:4318",
    "SG_RUNTIME_DATA=.runtime",
  ].join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
writeFileSync(
  agentPath,
  [
    `SG_AGENT_TOKEN=${agent}`,
    `SG_DEVICE_ID=${serial}`,
    `SG_DEVICE_SERIAL=${serial}`,
    `SG_ARTEMIS_ROOT=${JSON.stringify(root)}`,
    "SG_RUNTIME_URL=http://127.0.0.1:4318",
    "SG_AGENT_LEDGER=.runtime/agent.sqlite",
  ].join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
console.info(
  "Created private .env.runtime and .env.agent. No services started; no account binding or publication authorization created.",
);
