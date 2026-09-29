import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { contractVersion } from "./common.js";
import { firstBatchContractRegistry } from "./registry.js";

const outputUrl = new URL(
  "../generated/first-batch-contracts.v1.json",
  import.meta.url,
);
const androidOutputUrl = new URL(
  "../../android/app/src/main/java/com/socialgrowth/product/GeneratedFirstBatchContractSpec.kt",
  import.meta.url,
);

const schemas = Object.fromEntries(
  Object.entries(firstBatchContractRegistry).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: "draft-2020-12" }),
  ]),
);

const generatedContent = `${JSON.stringify({ contractVersion, schemas }, null, 2)}\n`;

function kotlinString(value: string): string {
  return JSON.stringify(value).replaceAll("$", "\\$");
}

function kotlinSet(values: readonly string[]): string {
  return `setOf(${values.map(kotlinString).join(", ")})`;
}

type JsonObject = Record<string, unknown>;

function requireObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Cannot generate Android contracts: ${label} must be an object.`);
  }
  return value as JsonObject;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Cannot generate Android contracts: ${label} must be an array.`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Cannot generate Android contracts: ${label} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Cannot generate Android contracts: ${label} must be a finite number.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) =>
    requireString(item, `${label}[${index}]`),
  );
}

function requireProperties(schema: JsonObject, label: string): JsonObject {
  return requireObject(schema.properties, `${label}.properties`);
}

function requireSchemaProperty(
  properties: JsonObject,
  name: string,
  label: string,
): JsonObject {
  return requireObject(properties[name], `${label}.properties.${name}`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const associationQrSchema = requireObject(
  schemas.associationQrPayload,
  "associationQrPayload",
);
const associationQrProperties = requireProperties(
  associationQrSchema,
  "associationQrPayload",
);
const associationQrRequired = requireStringArray(
  associationQrSchema.required,
  "associationQrPayload.required",
);
const associationCodePattern = requireString(
  requireSchemaProperty(
    associationQrProperties,
    "associationCode",
    "associationQrPayload",
  ).pattern,
  "associationQrPayload.associationCode.pattern",
);

const installationSelfSchema = requireObject(
  schemas.installationSelfView,
  "installationSelfView",
);
const installationBranches = requireArray(
  installationSelfSchema.oneOf,
  "installationSelfView.oneOf",
).map((branch, index) =>
  requireObject(branch, `installationSelfView.oneOf[${index}]`),
);
if (installationBranches.length < 2) {
  throw new Error("Cannot generate Android contracts: installationSelfView needs at least two state branches.");
}
const installationProperties = requireProperties(
  installationBranches[0]!,
  "installationSelfView.oneOf[0]",
);
const installationRequired = requireStringArray(
  installationBranches[0]!.required,
  "installationSelfView.oneOf[0].required",
);
for (const [index, branch] of installationBranches.entries()) {
  const properties = requireProperties(branch, `installationSelfView.oneOf[${index}]`);
  const required = requireStringArray(
    branch.required,
    `installationSelfView.oneOf[${index}].required`,
  );
  if (
    !sameStrings(Object.keys(installationProperties), Object.keys(properties)) ||
    !sameStrings(installationRequired, required)
  ) {
    throw new Error("Cannot generate Android contracts: installationSelfView branches must expose identical keys.");
  }
}
const installationStatePairs = installationBranches.flatMap((branch, index) => {
  const properties = requireProperties(branch, `installationSelfView.oneOf[${index}]`);
  const state = requireSchemaProperty(
    properties,
    "state",
    `installationSelfView.oneOf[${index}]`,
  );
  const states = state.enum === undefined
    ? [requireString(state.const, `installationSelfView.oneOf[${index}].state.const`)]
    : requireStringArray(state.enum, `installationSelfView.oneOf[${index}].state.enum`);
  const deviceType = requireString(
    requireSchemaProperty(
      properties,
      "deviceId",
      `installationSelfView.oneOf[${index}]`,
    ).type,
    `installationSelfView.oneOf[${index}].deviceId.type`,
  );
  if (deviceType !== "null" && deviceType !== "string") {
    throw new Error("Cannot generate Android contracts: deviceId branch type must be null or string.");
  }
  return states.map((value) => ({ deviceType, value }));
});
const installationIdSchema = requireSchemaProperty(
  installationProperties,
  "installationId",
  "installationSelfView.oneOf[0]",
);
const timestampSchema = requireSchemaProperty(
  installationProperties,
  "updatedAt",
  "installationSelfView.oneOf[0]",
);
const factVersionSchema = requireSchemaProperty(
  installationProperties,
  "factVersion",
  "installationSelfView.oneOf[0]",
);

const productErrorSchema = requireObject(
  schemas.productErrorResponse,
  "productErrorResponse",
);
const productErrorProperties = requireProperties(
  productErrorSchema,
  "productErrorResponse",
);
const productErrorRequired = requireStringArray(
  productErrorSchema.required,
  "productErrorResponse.required",
);
const requestIdSchema = requireSchemaProperty(
  productErrorProperties,
  "requestId",
  "productErrorResponse",
);
const errorDetailSchema = requireSchemaProperty(
  productErrorProperties,
  "error",
  "productErrorResponse",
);
const errorDetailProperties = requireProperties(
  errorDetailSchema,
  "productErrorResponse.error",
);
const errorDetailRequired = requireStringArray(
  errorDetailSchema.required,
  "productErrorResponse.error.required",
);
const errorCodes = requireStringArray(
  requireSchemaProperty(errorDetailProperties, "code", "productErrorResponse.error").enum,
  "productErrorResponse.error.code.enum",
);
const errorMessageSchema = requireSchemaProperty(
  errorDetailProperties,
  "message",
  "productErrorResponse.error",
);
const errorFieldSchema = requireSchemaProperty(
  errorDetailProperties,
  "field",
  "productErrorResponse.error",
);
const androidGeneratedContent = `// Generated by product/contracts; do not edit manually.
package com.socialgrowth.product

internal object GeneratedFirstBatchContractSpec {
    const val CONTRACT_VERSION = ${kotlinString(contractVersion)}
    const val ASSOCIATION_CODE_PATTERN = ${kotlinString(associationCodePattern)}
    const val UUID_PATTERN = ${kotlinString(requireString(installationIdSchema.pattern, "installationSelfView.installationId.pattern"))}
    const val TIMESTAMP_PATTERN = ${kotlinString(requireString(timestampSchema.pattern, "installationSelfView.updatedAt.pattern"))}
    const val FACT_VERSION_MAX = ${requireNumber(factVersionSchema.maximum, "installationSelfView.factVersion.maximum")}L
    const val REQUEST_ID_MIN_LENGTH = ${requireNumber(requestIdSchema.minLength, "productErrorResponse.requestId.minLength")}
    const val REQUEST_ID_MAX_LENGTH = ${requireNumber(requestIdSchema.maxLength, "productErrorResponse.requestId.maxLength")}
    const val ERROR_MESSAGE_MIN_LENGTH = ${requireNumber(errorMessageSchema.minLength, "productErrorResponse.error.message.minLength")}
    const val ERROR_FIELD_MIN_LENGTH = ${requireNumber(errorFieldSchema.minLength, "productErrorResponse.error.field.minLength")}
    val ASSOCIATION_QR_KEYS = ${kotlinSet(Object.keys(associationQrProperties))}
    val ASSOCIATION_QR_REQUIRED_KEYS = ${kotlinSet(associationQrRequired)}
    val INSTALLATION_SELF_KEYS = ${kotlinSet(Object.keys(installationProperties))}
    val INSTALLATION_SELF_REQUIRED_KEYS = ${kotlinSet(installationRequired)}
    val NULL_DEVICE_STATES = ${kotlinSet(installationStatePairs.filter(({ deviceType }) => deviceType === "null").map(({ value }) => value))}
    val IDENTIFIED_DEVICE_STATES = ${kotlinSet(installationStatePairs.filter(({ deviceType }) => deviceType === "string").map(({ value }) => value))}
    val ERROR_RESPONSE_KEYS = ${kotlinSet(Object.keys(productErrorProperties))}
    val ERROR_RESPONSE_REQUIRED_KEYS = ${kotlinSet(productErrorRequired)}
    val ERROR_DETAIL_KEYS = ${kotlinSet(Object.keys(errorDetailProperties))}
    val ERROR_DETAIL_REQUIRED_KEYS = ${kotlinSet(errorDetailRequired)}
    val ERROR_CODES = ${kotlinSet(errorCodes)}
}
`;

if (process.argv.includes("--check")) {
  const [committedContent, committedAndroidContent] = await Promise.all([
    readFile(outputUrl, "utf8"),
    readFile(androidOutputUrl, "utf8"),
  ]);
  if (
    committedContent !== generatedContent ||
    committedAndroidContent !== androidGeneratedContent
  ) {
    throw new Error(
      "Generated JSON/Kotlin contracts are stale. Run `pnpm --filter @socialgrowth/product-contracts generate` and commit the result.",
    );
  }
  process.exit(0);
}

await mkdir(fileURLToPath(new URL(".", outputUrl)), { recursive: true });
await mkdir(fileURLToPath(new URL(".", androidOutputUrl)), { recursive: true });
await Promise.all([
  writeFile(fileURLToPath(outputUrl), generatedContent, "utf8"),
  writeFile(fileURLToPath(androidOutputUrl), androidGeneratedContent, "utf8"),
]);
