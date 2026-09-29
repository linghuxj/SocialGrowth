import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const generatedContent = `${JSON.stringify({ contractVersion, schemas }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committedContent = await readFile(outputUrl, "utf8");
  if (committedContent !== generatedContent) {
    throw new Error(
      "Generated contracts are stale. Run `pnpm --filter @socialgrowth/product-contracts generate` and commit the result.",
    );
  }
  process.exit(0);
}

await mkdir(fileURLToPath(new URL(".", outputUrl)), { recursive: true });
await writeFile(fileURLToPath(outputUrl), generatedContent, "utf8");
