import { readFile, writeFile } from "node:fs/promises";
import { participationProtocolVersion, participationChallengeSchema, participationReceiptSchema, participationRunSchema, participationScopeSchema } from "./local-participation.js";
const set = (keys: string[]) => `setOf(${keys.map(k => JSON.stringify(k)).join(", ")})`;
const output = `// Generated from product/contracts/src/local-participation.ts; do not edit.\npackage com.socialgrowth.product\n\nobject GeneratedParticipationContractSpec {\n    const val VERSION = ${JSON.stringify(participationProtocolVersion)}\n    val SCOPE_KEYS = ${set(Object.keys(participationScopeSchema.shape))}\n    val CHALLENGE_KEYS = ${set(Object.keys(participationChallengeSchema.shape))}\n    val RECEIPT_KEYS = ${set(Object.keys(participationReceiptSchema.shape))}\n    val RUN_KEYS = ${set(Object.keys(participationRunSchema.shape))}\n}\n`;
const path = new URL("../../android/app/src/main/java/com/socialgrowth/product/GeneratedParticipationContractSpec.kt", import.meta.url);
if (process.argv.includes("--check")) {
  if (await readFile(path, "utf8").catch(() => "") !== output) throw new Error("Participation Kotlin contract is stale; run pnpm generate");
} else await writeFile(path, output);
