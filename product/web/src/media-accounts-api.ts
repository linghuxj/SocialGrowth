import {
  accountAssignmentListResponseSchema,
  accountAssignmentRequestSchema,
  accountAssignmentResponseSchema,
  contractVersion,
  createMediaAccountRequestSchema,
  createMediaAccountResponseSchema,
  mediaAccountCommandLookupResponseSchema,
  mediaAccountSchema,
  mediaAccountListResponseSchema,
  resourceCommandLookupResponseSchema,
  updateMediaAccountRequestSchema,
  updateMediaAccountResponseSchema,
  uuidSchema,
  writeMediaCredentialRequestSchema,
  writeMediaCredentialResponseSchema,
  type AccountAssignmentRequest,
  type CreateMediaAccountRequest,
  type MediaAccount,
  type UpdateMediaAccountRequest,
} from "@socialgrowth/product-contracts";
import {
  captureOperatorWriteSession,
  newIdempotencyKey,
  prepareOperatorPost,
  ProductApiError,
  readOperatorResource,
} from "./operator-api.js";

export type MediaAccountList = ReturnType<typeof mediaAccountListResponseSchema.parse>;
export type AccountAssignmentList = ReturnType<typeof accountAssignmentListResponseSchema.parse>;
export type AccountAssignmentResult = ReturnType<typeof accountAssignmentResponseSchema.parse>;
export type MediaAccountCommandLookup = ReturnType<typeof mediaAccountCommandLookupResponseSchema.parse>;
export type ResourceCommandLookup = ReturnType<typeof resourceCommandLookupResponseSchema.parse>;

export class MediaAccountsApiError extends Error {
  constructor(readonly code: "MEDIA_ACCOUNTS_INPUT_INVALID" | "MEDIA_ACCOUNTS_RESPONSE_INVALID" | "MEDIA_ACCOUNTS_UNAVAILABLE") {
    super(code);
  }
}

export function newMediaMetadata() {
  return { contractVersion, requestId: `request-${crypto.randomUUID()}`, idempotencyKey: newIdempotencyKey() };
}

export async function readMediaAccounts(): Promise<MediaAccountList> {
  const checkSession = captureOperatorWriteSession();
  try {
    const value = await readOperatorResource("/api/operator/media-accounts", mediaAccountListResponseSchema);
    checkSession();
    return value;
  } catch (error) {
    if (error instanceof ProductApiError) throw error;
    throw new MediaAccountsApiError("MEDIA_ACCOUNTS_UNAVAILABLE");
  }
}

export async function readAccountAssignments(projectId?: string): Promise<AccountAssignmentList> {
  const checkSession = captureOperatorWriteSession();
  const query = projectId ? `?projectId=${encodeURIComponent(projectId.toLowerCase())}` : "";
  try {
    const value = await readOperatorResource(`/api/operator/resources/account-assignments${query}`, accountAssignmentListResponseSchema);
    if (projectId && value.projectId?.toLowerCase() !== projectId.toLowerCase()) throw new MediaAccountsApiError("MEDIA_ACCOUNTS_RESPONSE_INVALID");
    checkSession();
    return value;
  } catch (error) {
    if (error instanceof MediaAccountsApiError) throw error;
    if (error instanceof ProductApiError) throw error;
    throw new MediaAccountsApiError("MEDIA_ACCOUNTS_UNAVAILABLE");
  }
}

function sameId(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }

export class PreparedMediaAccountCreate {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly platform: string;
  readonly loginIdentifier: string;
  readonly sendOriginal: () => Promise<ReturnType<typeof createMediaAccountResponseSchema.parse>>;

  constructor(raw: unknown) {
    let input: CreateMediaAccountRequest;
    try { input = createMediaAccountRequestSchema.parse(raw); }
    catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID"); }
    this.idempotencyKey = input.metadata.idempotencyKey;
    this.requestId = input.metadata.requestId;
    const body = JSON.stringify(input);
    this.sendOriginal = prepareOperatorPost("/api/operator/media-accounts", body, {
      parse(rawResponse: unknown) {
        try {
          const response = createMediaAccountResponseSchema.parse(rawResponse);
          if (response.account.platform !== input.platform || response.account.loginIdentifier !== input.loginIdentifier
            || response.account.parentLoginVerification !== "registered_unverified"
            || response.account.credential?.state !== "stored_unverified") throw new Error();
          return response;
        } catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_RESPONSE_INVALID"); }
      },
    });
    this.platform = input.platform;
    this.loginIdentifier = input.loginIdentifier;
  }
  send() { return this.sendOriginal(); }
}

export class PreparedMediaAccountProfile {
  readonly idempotencyKey: string;
  readonly requestId: string;
  private readonly sendOriginal: () => Promise<MediaAccount>;
  constructor(raw: unknown) {
    const accountId = (raw as { accountId?: unknown })?.accountId;
    try { uuidSchema.parse(accountId); } catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID"); }
    const request = { ...(raw as Record<string, unknown>) }; delete request.accountId;
    let input: UpdateMediaAccountRequest;
    try { input = updateMediaAccountRequestSchema.parse(request); }
    catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID"); }
    this.idempotencyKey = input.metadata.idempotencyKey;
    this.requestId = input.metadata.requestId;
    this.sendOriginal = prepareOperatorPost(`/api/operator/media-accounts/${String(accountId).toLowerCase()}/profile`, JSON.stringify(input), {
      parse(rawResponse: unknown) {
        try {
          const response = updateMediaAccountResponseSchema.parse(rawResponse);
          const parsed = mediaAccountSchema.parse(response.account) as MediaAccount;
          if (!sameId(parsed.accountId, String(accountId)) || parsed.displayName !== input.displayName) throw new Error();
          return parsed;
        } catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_RESPONSE_INVALID"); }
      },
    });
  }
  send() { return this.sendOriginal(); }
}

export function prepareMediaAccountCreate(input: {
  expectedResourceVersion: number; platform: "facebook" | "youtube"; displayName: string;
  loginIdentifier: string; password: string; persona?: { name: string | null; birthday: string | null; gender: string | null };
}) {
  return new PreparedMediaAccountCreate({ metadata: newMediaMetadata(), ...input });
}

export function prepareMediaAccountProfile(input: Omit<UpdateMediaAccountRequest, "metadata"> & { accountId: string }) {
  return new PreparedMediaAccountProfile({ metadata: newMediaMetadata(), ...input });
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

export class PreparedMediaCredentialWrite {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly operation: "put" | "invalidate";
  readonly accountId: string;
  private readonly sendOriginal: () => Promise<ReturnType<typeof writeMediaCredentialResponseSchema.parse>>;
  constructor(raw: unknown) {
    let input: ReturnType<typeof writeMediaCredentialRequestSchema.parse>;
    try { input = writeMediaCredentialRequestSchema.parse(raw); }
    catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID"); }
    this.idempotencyKey = input.metadata.idempotencyKey;
    this.requestId = input.metadata.requestId;
    this.operation = input.operation;
    this.accountId = input.accountId;
    this.sendOriginal = prepareOperatorPost(`/api/operator/media-accounts/${input.accountId.toLowerCase()}/credentials`, JSON.stringify(input), {
      parse(rawResponse: unknown) {
        try {
          const response = writeMediaCredentialResponseSchema.parse(rawResponse);
          if (!sameId(response.credential.accountId, input.accountId) || response.credential.platform !== input.platform
            || response.credential.state !== (input.operation === "put" ? "stored_unverified" : "invalidated")) throw new Error();
          return response;
        } catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_RESPONSE_INVALID"); }
      },
    });
  }
  send() { return this.sendOriginal(); }
}

export function prepareCredentialPut(account: MediaAccount, loginIdentifier: string, password: string) {
  return new PreparedMediaCredentialWrite({ metadata: newMediaMetadata(), operation: "put",
    credentialId: account.credential?.credentialId ?? null, accountId: account.accountId,
    platform: account.platform, expectedRevision: account.credential?.revision ?? 0,
    loginIdentifier, payloadBase64: base64Utf8(JSON.stringify({ login: loginIdentifier, password })) });
}

export function prepareCredentialInvalidate(account: MediaAccount) {
  if (!account.credential) throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID");
  return new PreparedMediaCredentialWrite({ metadata: newMediaMetadata(), operation: "invalidate",
    credentialId: account.credential.credentialId, accountId: account.accountId, platform: account.platform,
    expectedRevision: account.credential.revision });
}

export class PreparedAccountAssignment {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly projectId: string;
  private readonly sendOriginal: () => Promise<AccountAssignmentResult>;
  constructor(raw: unknown) {
    let input: AccountAssignmentRequest;
    try { input = accountAssignmentRequestSchema.parse(raw); }
    catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_INPUT_INVALID"); }
    this.idempotencyKey = input.metadata.idempotencyKey;
    this.requestId = input.metadata.requestId;
    this.projectId = input.projectId;
    this.sendOriginal = prepareOperatorPost("/api/operator/resources/account-assignments", JSON.stringify(input), {
      parse(rawResponse: unknown) {
        try {
          const response = accountAssignmentResponseSchema.parse(rawResponse);
          if (input.accountIds.some(id => !response.assignments.some(a => sameId(a.accountId, id)
            && sameId(a.projectId, input.projectId) && sameId(a.deviceId, input.deviceId)))) throw new Error();
          if (response.actionPermissionGranted || response.publicationAllowed) throw new Error();
          return response;
        } catch { throw new MediaAccountsApiError("MEDIA_ACCOUNTS_RESPONSE_INVALID"); }
      },
    });
  }
  send() { return this.sendOriginal(); }
}

export function prepareAccountAssignment(input: Omit<AccountAssignmentRequest, "metadata">) {
  return new PreparedAccountAssignment({ metadata: newMediaMetadata(), ...input });
}

export async function readMediaAccountCommand(key: string): Promise<MediaAccountCommandLookup> {
  const checkSession = captureOperatorWriteSession();
  const value = await readOperatorResource(`/api/operator/media-accounts/commands/${encodeURIComponent(key)}`, mediaAccountCommandLookupResponseSchema);
  checkSession(); return value;
}

export async function readResourceCommand(key: string): Promise<ResourceCommandLookup> {
  const checkSession = captureOperatorWriteSession();
  const value = await readOperatorResource(`/api/operator/resources/commands/${encodeURIComponent(key)}`, resourceCommandLookupResponseSchema);
  checkSession(); return value;
}

export function prepareCreateRequest(raw: unknown) { return createMediaAccountRequestSchema.parse(raw); }
export function prepareAssignmentRequest(raw: unknown) { return accountAssignmentRequestSchema.parse(raw); }
