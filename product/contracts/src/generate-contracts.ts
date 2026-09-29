import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { contractVersion } from "./common.js";
import { firstBatchContractRegistry } from "./registry.js";

const outputUrl = new URL(
  "../generated/first-batch-contracts.v1.json",
  import.meta.url,
);

const schemas = Object.fromEntries(
  Object.entries(firstBatchContractRegistry).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: "draft-2020-12" }),
  ]),
);

await mkdir(fileURLToPath(new URL(".", outputUrl)), { recursive: true });
await writeFile(
  fileURLToPath(outputUrl),
  `${JSON.stringify({ contractVersion, schemas }, null, 2)}\n`,
  "utf8",
);
