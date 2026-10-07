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
const admissionAndroidOutputUrl = new URL(
  "../../android/app/src/main/java/com/socialgrowth/product/GeneratedAdmissionContractSpec.kt",
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

function requireOnlyKeys(
  value: JsonObject,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(
      `Cannot generate Android contracts: ${label} has unsupported keys ${unexpected.join(", ")}.`,
    );
  }
}

function requireSchemaType(
  schema: JsonObject,
  expected: string,
  label: string,
): void {
  if (schema.type !== expected) {
    throw new Error(
      `Cannot generate Android contracts: ${label}.type must be ${expected}.`,
    );
  }
}

function requireStrictObject(schema: JsonObject, label: string): void {
  requireSchemaType(schema, "object", label);
  if (schema.additionalProperties !== false) {
    throw new Error(
      `Cannot generate Android contracts: ${label} must reject additional properties.`,
    );
  }
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
requireOnlyKeys(
  associationQrSchema,
  ["$schema", "type", "properties", "required", "additionalProperties"],
  "associationQrPayload",
);
requireStrictObject(associationQrSchema, "associationQrPayload");
requireOnlyKeys(
  associationQrProperties,
  ["contractVersion", "associationCode"],
  "associationQrPayload.properties",
);
const associationVersionSchema = requireSchemaProperty(
  associationQrProperties,
  "contractVersion",
  "associationQrPayload",
);
requireOnlyKeys(
  associationVersionSchema,
  ["type", "const"],
  "associationQrPayload.contractVersion",
);
requireSchemaType(
  associationVersionSchema,
  "string",
  "associationQrPayload.contractVersion",
);
if (associationVersionSchema.const !== contractVersion) {
  throw new Error("Cannot generate Android contracts: QR contract version differs from the registry version.");
}
const associationCodeSchema = requireSchemaProperty(
  associationQrProperties,
  "associationCode",
  "associationQrPayload",
);
requireOnlyKeys(
  associationCodeSchema,
  ["type", "pattern"],
  "associationQrPayload.associationCode",
);
requireSchemaType(
  associationCodeSchema,
  "string",
  "associationQrPayload.associationCode",
);
const associationQrRequired = requireStringArray(
  associationQrSchema.required,
  "associationQrPayload.required",
);
const associationCodePattern = requireString(
  associationCodeSchema.pattern,
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
requireOnlyKeys(installationSelfSchema, ["$schema", "oneOf"], "installationSelfView");
const installationProperties = requireProperties(
  installationBranches[0]!,
  "installationSelfView.oneOf[0]",
);
const installationRequired = requireStringArray(
  installationBranches[0]!.required,
  "installationSelfView.oneOf[0].required",
);
for (const [index, branch] of installationBranches.entries()) {
  requireOnlyKeys(
    branch,
    ["type", "properties", "required", "additionalProperties"],
    `installationSelfView.oneOf[${index}]`,
  );
  requireStrictObject(branch, `installationSelfView.oneOf[${index}]`);
  const properties = requireProperties(branch, `installationSelfView.oneOf[${index}]`);
  requireOnlyKeys(
    properties,
    ["factVersion", "updatedAt", "installationId", "state", "deviceId"],
    `installationSelfView.oneOf[${index}].properties`,
  );
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
  for (const sharedName of ["factVersion", "updatedAt", "installationId"]) {
    const expected = requireSchemaProperty(
      installationProperties,
      sharedName,
      "installationSelfView.oneOf[0]",
    );
    const actual = requireSchemaProperty(
      properties,
      sharedName,
      `installationSelfView.oneOf[${index}]`,
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Cannot generate Android contracts: ${sharedName} differs across installationSelfView branches.`,
      );
    }
  }
}
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
const installationStatePairs = installationBranches.flatMap((branch, index) => {
  const properties = requireProperties(branch, `installationSelfView.oneOf[${index}]`);
  const state = requireSchemaProperty(
    properties,
    "state",
    `installationSelfView.oneOf[${index}]`,
  );
  requireOnlyKeys(
    state,
    state.enum === undefined ? ["type", "const"] : ["type", "enum"],
    `installationSelfView.oneOf[${index}].state`,
  );
  requireSchemaType(
    state,
    "string",
    `installationSelfView.oneOf[${index}].state`,
  );
  const states = state.enum === undefined
    ? [requireString(state.const, `installationSelfView.oneOf[${index}].state.const`)]
    : requireStringArray(state.enum, `installationSelfView.oneOf[${index}].state.enum`);
  const deviceId = requireSchemaProperty(
    properties,
    "deviceId",
    `installationSelfView.oneOf[${index}]`,
  );
  const deviceType = requireString(
    deviceId.type,
    `installationSelfView.oneOf[${index}].deviceId.type`,
  );
  if (deviceType !== "null" && deviceType !== "string") {
    throw new Error("Cannot generate Android contracts: deviceId branch type must be null or string.");
  }
  requireOnlyKeys(
    deviceId,
    deviceType === "null" ? ["type"] : ["type", "format", "pattern"],
    `installationSelfView.oneOf[${index}].deviceId`,
  );
  if (
    deviceType === "string" &&
    JSON.stringify(deviceId) !== JSON.stringify(installationIdSchema)
  ) {
    throw new Error(
      "Cannot generate Android contracts: string deviceId must use the installation UUID schema.",
    );
  }
  return states.map((value) => ({ deviceType, value }));
});
requireOnlyKeys(
  factVersionSchema,
  ["type", "minimum", "maximum"],
  "installationSelfView.factVersion",
);
requireSchemaType(factVersionSchema, "integer", "installationSelfView.factVersion");
requireOnlyKeys(
  timestampSchema,
  ["type", "format", "pattern"],
  "installationSelfView.updatedAt",
);
requireSchemaType(timestampSchema, "string", "installationSelfView.updatedAt");
requireOnlyKeys(
  installationIdSchema,
  ["type", "format", "pattern"],
  "installationSelfView.installationId",
);
requireSchemaType(installationIdSchema, "string", "installationSelfView.installationId");

const productErrorSchema = requireObject(
  schemas.productErrorResponse,
  "productErrorResponse",
);
const productErrorProperties = requireProperties(
  productErrorSchema,
  "productErrorResponse",
);
requireOnlyKeys(
  productErrorSchema,
  ["$schema", "type", "properties", "required", "additionalProperties"],
  "productErrorResponse",
);
requireStrictObject(productErrorSchema, "productErrorResponse");
requireOnlyKeys(
  productErrorProperties,
  ["contractVersion", "requestId", "error"],
  "productErrorResponse.properties",
);
const errorVersionSchema = requireSchemaProperty(
  productErrorProperties,
  "contractVersion",
  "productErrorResponse",
);
requireOnlyKeys(
  errorVersionSchema,
  ["type", "const"],
  "productErrorResponse.contractVersion",
);
requireSchemaType(
  errorVersionSchema,
  "string",
  "productErrorResponse.contractVersion",
);
if (errorVersionSchema.const !== contractVersion) {
  throw new Error("Cannot generate Android contracts: error contract version differs from the registry version.");
}
const productErrorRequired = requireStringArray(
  productErrorSchema.required,
  "productErrorResponse.required",
);
const requestIdSchema = requireSchemaProperty(
  productErrorProperties,
  "requestId",
  "productErrorResponse",
);
requireOnlyKeys(
  requestIdSchema,
  ["type", "minLength", "maxLength"],
  "productErrorResponse.requestId",
);
requireSchemaType(requestIdSchema, "string", "productErrorResponse.requestId");
const errorDetailSchema = requireSchemaProperty(
  productErrorProperties,
  "error",
  "productErrorResponse",
);
const errorDetailProperties = requireProperties(
  errorDetailSchema,
  "productErrorResponse.error",
);
requireOnlyKeys(
  errorDetailSchema,
  ["type", "properties", "required", "additionalProperties"],
  "productErrorResponse.error",
);
requireStrictObject(errorDetailSchema, "productErrorResponse.error");
requireSchemaType(
  requireSchemaProperty(errorDetailProperties, "code", "productErrorResponse.error"),
  "string",
  "productErrorResponse.error.code",
);
requireOnlyKeys(
  errorDetailProperties,
  ["code", "message", "retryable", "field"],
  "productErrorResponse.error.properties",
);
const errorDetailRequired = requireStringArray(
  errorDetailSchema.required,
  "productErrorResponse.error.required",
);
const errorCodes = requireStringArray(
  requireSchemaProperty(errorDetailProperties, "code", "productErrorResponse.error").enum,
  "productErrorResponse.error.code.enum",
);
requireOnlyKeys(
  requireSchemaProperty(errorDetailProperties, "code", "productErrorResponse.error"),
  ["type", "enum"],
  "productErrorResponse.error.code",
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
requireSchemaType(
  errorMessageSchema,
  "string",
  "productErrorResponse.error.message",
);
requireSchemaType(
  errorFieldSchema,
  "string",
  "productErrorResponse.error.field",
);
requireOnlyKeys(
  errorMessageSchema,
  ["type", "minLength"],
  "productErrorResponse.error.message",
);
requireSchemaType(
  requireSchemaProperty(errorDetailProperties, "retryable", "productErrorResponse.error"),
  "boolean",
  "productErrorResponse.error.retryable",
);
requireOnlyKeys(
  errorFieldSchema,
  ["type", "minLength"],
  "productErrorResponse.error.field",
);
requireOnlyKeys(
  requireSchemaProperty(errorDetailProperties, "retryable", "productErrorResponse.error"),
  ["type"],
  "productErrorResponse.error.retryable",
);

function requireResponseObject(
  name: string,
  expectedKeys: readonly string[],
): { properties: JsonObject; required: string[] } {
  const schema = requireObject(schemas[name], name);
  requireOnlyKeys(
    schema,
    ["$schema", "type", "properties", "required", "additionalProperties"],
    name,
  );
  requireStrictObject(schema, name);
  const properties = requireProperties(schema, name);
  requireOnlyKeys(properties, expectedKeys, `${name}.properties`);
  if (!sameStrings(Object.keys(properties), expectedKeys)) {
    throw new Error(`Cannot generate Android contracts: ${name} properties changed order.`);
  }
  const required = requireStringArray(schema.required, `${name}.required`);
  if (!sameStrings(required, expectedKeys)) {
    throw new Error(`Cannot generate Android contracts: ${name} must require every field.`);
  }
  return { properties, required };
}

const phoneChallenge = requireResponseObject("phoneVerificationChallengeResponse", [
  "challengeId", "purpose", "phoneHint", "deliveryState", "expiresAt", "resendAvailableAt",
]);
const phoneProof = requireResponseObject("phoneVerificationResponse", [
  "phoneVerificationId", "purpose", "phoneHint", "verifiedAt", "expiresAt",
]);
const providerSelf = requireResponseObject("providerSelfView", [
  "providerId", "displayName", "phoneHint", "status", "createdAt", "updatedAt",
]);
const providerAuth = requireResponseObject("providerAuthResponse", [
  "provider", "session", "sessionToken",
]);
const providerPurposeSchema = requireSchemaProperty(
  phoneChallenge.properties,
  "purpose",
  "phoneVerificationChallengeResponse",
);
const providerPurposes = requireStringArray(
  providerPurposeSchema.enum,
  "phoneVerificationChallengeResponse.purpose.enum",
);
const proofPurposeSchema = requireSchemaProperty(
  phoneProof.properties,
  "purpose",
  "phoneVerificationResponse",
);
if (JSON.stringify(providerPurposeSchema) !== JSON.stringify(proofPurposeSchema)) {
  throw new Error("Cannot generate Android contracts: verification purposes differ across responses.");
}
const phoneHintSchema = requireSchemaProperty(
  phoneChallenge.properties,
  "phoneHint",
  "phoneVerificationChallengeResponse",
);
for (const [label, properties] of [
  ["phoneVerificationResponse", phoneProof.properties],
  ["providerSelfView", providerSelf.properties],
] as const) {
  if (
    JSON.stringify(requireSchemaProperty(properties, "phoneHint", label)) !==
    JSON.stringify(phoneHintSchema)
  ) {
    throw new Error(`Cannot generate Android contracts: ${label} uses a different phone hint schema.`);
  }
}
const deliveryStateSchema = requireSchemaProperty(
  phoneChallenge.properties,
  "deliveryState",
  "phoneVerificationChallengeResponse",
);
const providerStatusSchema = requireSchemaProperty(
  providerSelf.properties,
  "status",
  "providerSelfView",
);
const providerDisplayNameSchema = requireSchemaProperty(
  providerSelf.properties,
  "displayName",
  "providerSelfView",
);
requireOnlyKeys(
  providerDisplayNameSchema,
  ["type", "minLength", "maxLength"],
  "providerSelfView.displayName",
);
requireSchemaType(providerDisplayNameSchema, "string", "providerSelfView.displayName");
const providerAuthProviderSchema = requireSchemaProperty(
  providerAuth.properties,
  "provider",
  "providerAuthResponse",
);
const { $schema: _providerSelfDialect, ...providerSelfWithoutDialect } = requireObject(
  schemas.providerSelfView,
  "providerSelfView",
);
if (JSON.stringify(providerAuthProviderSchema) !== JSON.stringify(providerSelfWithoutDialect)) {
  throw new Error("Cannot generate Android contracts: providerAuthResponse embeds a divergent provider view.");
}
const sessionSchema = requireSchemaProperty(
  providerAuth.properties,
  "session",
  "providerAuthResponse",
);
requireStrictObject(sessionSchema, "providerAuthResponse.session");
const sessionProperties = requireProperties(sessionSchema, "providerAuthResponse.session");
requireOnlyKeys(sessionProperties, ["sessionId", "createdAt", "expiresAt"], "providerAuthResponse.session.properties");
const sessionRequired = requireStringArray(sessionSchema.required, "providerAuthResponse.session.required");
const sessionTokenSchema = requireSchemaProperty(
  providerAuth.properties,
  "sessionToken",
  "providerAuthResponse",
);
const androidGeneratedContent = `// Generated by product/contracts; do not edit manually.
package com.socialgrowth.product

internal object GeneratedFirstBatchContractSpec {
    const val CONTRACT_VERSION = ${kotlinString(contractVersion)}
    const val ASSOCIATION_CODE_PATTERN = ${kotlinString(associationCodePattern)}
    const val UUID_PATTERN = ${kotlinString(requireString(installationIdSchema.pattern, "installationSelfView.installationId.pattern"))}
    const val TIMESTAMP_PATTERN = ${kotlinString(requireString(timestampSchema.pattern, "installationSelfView.updatedAt.pattern"))}
    const val FACT_VERSION_MAX = ${requireNumber(factVersionSchema.maximum, "installationSelfView.factVersion.maximum")}L
    const val FACT_VERSION_MIN = ${requireNumber(factVersionSchema.minimum, "installationSelfView.factVersion.minimum")}L
    const val REQUEST_ID_MIN_LENGTH = ${requireNumber(requestIdSchema.minLength, "productErrorResponse.requestId.minLength")}
    const val REQUEST_ID_MAX_LENGTH = ${requireNumber(requestIdSchema.maxLength, "productErrorResponse.requestId.maxLength")}
    const val ERROR_MESSAGE_MIN_LENGTH = ${requireNumber(errorMessageSchema.minLength, "productErrorResponse.error.message.minLength")}
    const val ERROR_FIELD_MIN_LENGTH = ${requireNumber(errorFieldSchema.minLength, "productErrorResponse.error.field.minLength")}
    const val PHONE_HINT_PATTERN = ${kotlinString(requireString(phoneHintSchema.pattern, "phoneVerificationChallengeResponse.phoneHint.pattern"))}
    const val SESSION_TOKEN_PATTERN = ${kotlinString(requireString(sessionTokenSchema.pattern, "providerAuthResponse.sessionToken.pattern"))}
    const val PHONE_CHALLENGE_DELIVERY_STATE = ${kotlinString(requireString(deliveryStateSchema.const, "phoneVerificationChallengeResponse.deliveryState.const"))}
    const val PROVIDER_DISPLAY_NAME_MIN_CODE_POINTS = ${requireNumber(providerDisplayNameSchema.minLength, "providerSelfView.displayName.minLength")}
    const val PROVIDER_DISPLAY_NAME_MAX_CODE_POINTS = ${requireNumber(providerDisplayNameSchema.maxLength, "providerSelfView.displayName.maxLength")}
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
    val PHONE_VERIFICATION_PURPOSES = ${kotlinSet(providerPurposes)}
    val PHONE_CHALLENGE_KEYS = ${kotlinSet(Object.keys(phoneChallenge.properties))}
    val PHONE_CHALLENGE_REQUIRED_KEYS = ${kotlinSet(phoneChallenge.required)}
    val PHONE_PROOF_KEYS = ${kotlinSet(Object.keys(phoneProof.properties))}
    val PHONE_PROOF_REQUIRED_KEYS = ${kotlinSet(phoneProof.required)}
    val PROVIDER_SELF_KEYS = ${kotlinSet(Object.keys(providerSelf.properties))}
    val PROVIDER_SELF_REQUIRED_KEYS = ${kotlinSet(providerSelf.required)}
    val PROVIDER_STATUSES = ${kotlinSet(requireStringArray(providerStatusSchema.enum, "providerSelfView.status.enum"))}
    val PROVIDER_AUTH_KEYS = ${kotlinSet(Object.keys(providerAuth.properties))}
    val PROVIDER_AUTH_REQUIRED_KEYS = ${kotlinSet(providerAuth.required)}
    val SESSION_KEYS = ${kotlinSet(Object.keys(sessionProperties))}
    val SESSION_REQUIRED_KEYS = ${kotlinSet(sessionRequired)}
}
`;

const admissionSchema = requireObject(schemas.enrollmentChallenge, "enrollmentChallenge");
requireOnlyKeys(admissionSchema, ["$schema", "type", "properties", "required", "additionalProperties"], "enrollmentChallenge");
requireStrictObject(admissionSchema, "enrollmentChallenge");
const admissionProperties = requireProperties(admissionSchema, "enrollmentChallenge");
const admissionKeys = ["protocolVersion", "purpose", "challengeId", "enrollmentId", "deviceId", "installationId", "installationGeneration", "enrollmentGeneration", "node", "nonce", "issuedAt", "expiresAt"];
requireOnlyKeys(admissionProperties, admissionKeys, "enrollmentChallenge.properties");
if (!sameStrings(Object.keys(admissionProperties), admissionKeys) || !sameStrings(requireStringArray(admissionSchema.required, "admission.required"), admissionKeys)) {
  throw new Error("Cannot generate Android contracts: admission fields must remain ordered and required.");
}
const admissionNodeSchema = requireSchemaProperty(admissionProperties, "node", "enrollmentChallenge");
requireOnlyKeys(admissionNodeSchema, ["type", "properties", "required", "additionalProperties"], "enrollmentChallenge.node");
requireStrictObject(admissionNodeSchema, "enrollmentChallenge.node");
const admissionNodeProperties = requireProperties(admissionNodeSchema, "enrollmentChallenge.node");
requireOnlyKeys(admissionNodeProperties, ["nodeId", "nodeKey", "networkRevision"], "enrollmentChallenge.node.properties");
if (!sameStrings(Object.keys(admissionNodeProperties), ["nodeId", "nodeKey", "networkRevision"]) || !sameStrings(requireStringArray(admissionNodeSchema.required, "admission.node.required"), ["nodeId", "nodeKey", "networkRevision"])) {
  throw new Error("Cannot generate Android contracts: admission node fields must remain ordered and required.");
}
const admissionProperty = (name: string) => requireSchemaProperty(admissionProperties, name, "enrollmentChallenge");
const admissionNodeProperty = (name: string) => requireSchemaProperty(admissionNodeProperties, name, "enrollmentChallenge.node");
for (const name of ["protocolVersion", "purpose", "installationGeneration", "enrollmentGeneration", "nonce", "challengeId", "enrollmentId", "deviceId", "installationId", "issuedAt", "expiresAt"]) {
  const allowed = ["protocolVersion", "purpose"].includes(name) ? ["type", "const"]
    : ["challengeId", "enrollmentId", "deviceId", "installationId", "issuedAt", "expiresAt"].includes(name) ? ["type", "format", "pattern"] : ["type", "pattern"];
  requireOnlyKeys(admissionProperty(name), allowed, `admission.${name}`);
  requireSchemaType(admissionProperty(name), "string", `admission.${name}`);
}
for (const [names, schema] of [
  [["challengeId", "enrollmentId", "deviceId", "installationId"], admissionProperty("challengeId")],
  [["issuedAt", "expiresAt"], admissionProperty("issuedAt")],
  [["installationGeneration", "enrollmentGeneration"], admissionProperty("installationGeneration")],
] as const) {
  for (const name of names) {
    if (JSON.stringify(admissionProperty(name)) !== JSON.stringify(schema)) {
      throw new Error(`Cannot generate Android contracts: admission ${name} schema diverged.`);
    }
  }
}
requireOnlyKeys(admissionNodeProperty("nodeId"), ["type", "pattern"], "admission.nodeId");
requireOnlyKeys(admissionNodeProperty("nodeKey"), ["type", "minLength", "maxLength"], "admission.nodeKey");
requireOnlyKeys(admissionNodeProperty("networkRevision"), ["type", "minimum", "maximum"], "admission.networkRevision");
requireSchemaType(admissionNodeProperty("nodeId"), "string", "admission.nodeId");
requireSchemaType(admissionNodeProperty("nodeKey"), "string", "admission.nodeKey");
requireSchemaType(admissionNodeProperty("networkRevision"), "integer", "admission.networkRevision");
const admissionAndroidContent = `// Generated by product/contracts; do not edit manually.
package com.socialgrowth.product

internal object GeneratedAdmissionContractSpec {
    const val PROTOCOL_VERSION = ${kotlinString(requireString(admissionProperty("protocolVersion").const, "admission.protocolVersion.const"))}
    const val PURPOSE = ${kotlinString(requireString(admissionProperty("purpose").const, "admission.purpose.const"))}
    const val UUID_PATTERN = ${kotlinString(requireString(admissionProperty("challengeId").pattern, "admission.uuid.pattern"))}
    const val TIMESTAMP_PATTERN = ${kotlinString(requireString(admissionProperty("issuedAt").pattern, "admission.timestamp.pattern"))}
    const val GENERATION_PATTERN = ${kotlinString(requireString(admissionProperty("installationGeneration").pattern, "admission.generation.pattern"))}
    const val NONCE_PATTERN = ${kotlinString(requireString(admissionProperty("nonce").pattern, "admission.nonce.pattern"))}
    const val NODE_ID_PATTERN = ${kotlinString(requireString(admissionNodeProperty("nodeId").pattern, "admission.nodeId.pattern"))}
    const val NODE_KEY_MIN = ${requireNumber(admissionNodeProperty("nodeKey").minLength, "admission.nodeKey.minLength")}
    const val NODE_KEY_MAX = ${requireNumber(admissionNodeProperty("nodeKey").maxLength, "admission.nodeKey.maxLength")}
    const val NETWORK_REVISION_MIN = ${requireNumber(admissionNodeProperty("networkRevision").minimum, "admission.networkRevision.minimum")}L
    const val NETWORK_REVISION_MAX = ${requireNumber(admissionNodeProperty("networkRevision").maximum, "admission.networkRevision.maximum")}L
    val CHALLENGE_KEYS = ${kotlinSet(Object.keys(admissionProperties))}
    val CHALLENGE_REQUIRED_KEYS = ${kotlinSet(requireStringArray(admissionSchema.required, "admission.required"))}
    val NODE_KEYS = ${kotlinSet(Object.keys(admissionNodeProperties))}
    val NODE_REQUIRED_KEYS = ${kotlinSet(requireStringArray(admissionNodeSchema.required, "admission.node.required"))}
}
`;

if (process.argv.includes("--check")) {
  const [committedContent, committedAndroidContent, committedAdmissionAndroidContent] = await Promise.all([
    readFile(outputUrl, "utf8"),
    readFile(androidOutputUrl, "utf8"),
    readFile(admissionAndroidOutputUrl, "utf8"),
  ]);
  if (
    committedContent !== generatedContent ||
    committedAndroidContent !== androidGeneratedContent ||
    committedAdmissionAndroidContent !== admissionAndroidContent
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
  writeFile(fileURLToPath(admissionAndroidOutputUrl), admissionAndroidContent, "utf8"),
]);
