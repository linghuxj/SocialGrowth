import {
  contractVersion,
  createOperatorResponseSchema,
  disableOperatorResponseSchema,
  listOperatorsResponseSchema,
  operatorLoginResponseSchema,
  productErrorResponseSchema,
  type OperatorLoginResponse,
  type OperatorView,
  type ProductErrorResponse,
} from "@socialgrowth/product-contracts";

const csrfStorageKey = "socialgrowth.operator.csrf";
const pendingMutationKeys = new Map<string, { fingerprint: string; key: string }>();

export class ProductApiError extends Error {
  constructor(readonly response: ProductErrorResponse, readonly status: number) {
    super(response.error.message);
    this.name = "ProductApiError";
  }
}

function requestId(): string { return `request-${crypto.randomUUID()}`; }
function mutationMetadata(operation: string, fingerprint: string) {
  const pending = pendingMutationKeys.get(operation);
  const key = pending?.fingerprint === fingerprint
    ? pending.key
    : `idempotency-${crypto.randomUUID()}`;
  pendingMutationKeys.set(operation, { fingerprint, key });
  return { contractVersion, requestId: requestId(), idempotencyKey: key };
}
function csrfToken(): string { return sessionStorage.getItem(csrfStorageKey) ?? ""; }
export function hasCsrfToken(): boolean { return csrfToken().length > 0; }
export function clearLocalSession(): void { sessionStorage.removeItem(csrfStorageKey); }

function fallbackError(status: number): ProductErrorResponse {
  return {
    contractVersion,
    requestId: requestId(),
    error: {
      code: "INTERNAL_ERROR",
      message: status >= 500
        ? "服务暂时不可用，请稍后重试"
        : "服务返回了无法识别的响应",
      retryable: status >= 500,
    },
  };
}

async function responseError(response: Response): Promise<ProductApiError> {
  let body: unknown;
  try { body = await response.json(); } catch { return new ProductApiError(fallbackError(response.status), response.status); }
  const parsed = productErrorResponseSchema.safeParse(body);
  return new ProductApiError(parsed.success ? parsed.data : fallbackError(response.status), response.status);
}

async function request<T>(url: string, schema: { parse(input: unknown): T }, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const error = await responseError(response);
    if (response.status === 401) clearLocalSession();
    throw error;
  }
  const body: unknown = await response.json();
  return schema.parse(body);
}

export async function login(loginName: string, password: string): Promise<OperatorLoginResponse> {
  const response = await request("/api/operator/login", operatorLoginResponseSchema, {
    method: "POST",
    body: JSON.stringify({
      metadata: { contractVersion, requestId: requestId() },
      loginName: loginName.trim().toLowerCase(),
      password,
    }),
  });
  sessionStorage.setItem(csrfStorageKey, response.csrfToken);
  return response;
}

export async function listOperators(): Promise<OperatorView[]> {
  return (await request("/api/operator/accounts", listOperatorsResponseSchema)).operators;
}

export async function createOperator(input: { displayName: string; initialPassword: string; loginName: string }): Promise<OperatorView> {
  const normalized = {
    loginName: input.loginName.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    initialPassword: input.initialPassword,
  };
  const fingerprint = JSON.stringify(normalized);
  const response = await request("/api/operator/accounts", createOperatorResponseSchema, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken() },
    body: JSON.stringify({
      metadata: mutationMetadata("create-operator", fingerprint),
      ...normalized,
    }),
  });
  pendingMutationKeys.delete("create-operator");
  return response.operator;
}

export async function disableOperator(operator: OperatorView): Promise<OperatorView> {
  const fingerprint = `${operator.operatorId}:${operator.factVersion}`;
  const response = await request(`/api/operator/accounts/${operator.operatorId}/disable`, disableOperatorResponseSchema, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken() },
    body: JSON.stringify({
      metadata: mutationMetadata("disable-operator", fingerprint),
      expectedFactVersion: operator.factVersion,
    }),
  });
  pendingMutationKeys.delete("disable-operator");
  return response.operator;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/operator/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify({ metadata: { contractVersion, requestId: requestId() } }),
  });
  if (!response.ok) {
    const error = await responseError(response);
    if (response.status === 401) clearLocalSession();
    throw error;
  }
  clearLocalSession();
}
