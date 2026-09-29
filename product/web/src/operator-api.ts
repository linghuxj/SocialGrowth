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

export class ProductApiError extends Error {
  constructor(readonly response: ProductErrorResponse, readonly status: number) {
    super(response.error.message);
    this.name = "ProductApiError";
  }
}

function requestId(): string { return `request-${crypto.randomUUID()}`; }
function metadata() {
  return { contractVersion, requestId: requestId(), idempotencyKey: `idempotency-${crypto.randomUUID()}` };
}
function csrfToken(): string { return sessionStorage.getItem(csrfStorageKey) ?? ""; }

async function request<T>(url: string, schema: { parse(input: unknown): T }, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new ProductApiError(productErrorResponseSchema.parse(body), response.status);
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
  const response = await request("/api/operator/accounts", createOperatorResponseSchema, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken() },
    body: JSON.stringify({
      metadata: metadata(),
      loginName: input.loginName.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      initialPassword: input.initialPassword,
    }),
  });
  return response.operator;
}

export async function disableOperator(operator: OperatorView): Promise<OperatorView> {
  const response = await request(`/api/operator/accounts/${operator.operatorId}/disable`, disableOperatorResponseSchema, {
    method: "POST",
    headers: { "x-csrf-token": csrfToken() },
    body: JSON.stringify({ metadata: metadata(), expectedFactVersion: operator.factVersion }),
  });
  return response.operator;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/operator/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify({ metadata: { contractVersion, requestId: requestId() } }),
  });
  sessionStorage.removeItem(csrfStorageKey);
  if (!response.ok) throw new ProductApiError(productErrorResponseSchema.parse(await response.json()), response.status);
}
