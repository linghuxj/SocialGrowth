import { ArtemisMcp } from "./artemis.ts";
import { createHash } from "node:crypto";
import { requireFact } from "./contracts.ts";

// Bounded integration probe: no autonomous tasks, UI actions, drafts or submissions.
const root = process.env.SG_ARTEMIS_ROOT ?? "";
const serial = process.env.SG_DEVICE_SERIAL ?? "";
requireFact(root && serial, "ARTEMIS_ROOT_AND_DEVICE_SERIAL_REQUIRED");
const client = new ArtemisMcp(root);
const timeout = setTimeout(() => {
  console.error("ARTEMIS_PROBE_TIMEOUT");
  void client.close();
  process.exitCode = 1;
}, 55000);
try {
  await client.connect();
  const hierarchy = await client.call(
    "mobile_get_device_state",
    { device_serial: serial, view_type: "hierarchy" },
    40000,
  );
  if (typeof hierarchy === "string" && hierarchy.startsWith("Error:"))
    console.error(
      hierarchy
        .replace(/(?:api[_-]?key|token|password)\s*[:=]\s*\S+/gi, "credential=<redacted>")
        .slice(0, 400),
    );
  requireFact(
    typeof hierarchy === "string" && hierarchy.length > 50 && !hierarchy.startsWith("Error:"),
    "DEVICE_OBSERVATION_FAILED",
  );
  console.info(
    JSON.stringify({
      status: "passed",
      transport: "MCP stdio",
      deviceSerial: serial,
      tool: "mobile_get_device_state",
      hierarchyBytes: Buffer.byteLength(hierarchy),
      hierarchySha256: createHash("sha256").update(hierarchy).digest("hex"),
      uiActions: 0,
      publishSubmissions: 0,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "ARTEMIS_PROBE_FAILED");
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await client.close();
}
