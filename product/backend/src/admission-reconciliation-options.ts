export interface AdmissionReconciliationOptions {
  databaseUrl: string;
  limit: number;
  cursor: string | null;
}

export function readAdmissionReconciliationOptions(args: readonly string[], environment: NodeJS.ProcessEnv): AdmissionReconciliationOptions {
  if (environment.SG_PRODUCT_ADMISSION_RECONCILE_ENABLED !== "1" || !environment.SG_PRODUCT_DATABASE_URL) {
    throw new Error("Admission reconciliation requires explicit enablement and database configuration");
  }
  const values = new Map<string, string>();
  const normalized = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index], value = normalized[index + 1];
    if ((key !== "--limit" && key !== "--cursor") || !value || values.has(key)) {
      throw new Error("Invalid admission reconciliation arguments");
    }
    values.set(key, value);
  }
  const text = values.get("--limit") ?? "100";
  const limit = Number(text);
  const cursor = values.get("--cursor") ?? null;
  if (!/^[0-9]{1,4}$/.test(text) || limit < 1 || limit > 1000
    || (cursor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))) {
    throw new Error("Invalid admission reconciliation scope");
  }
  return { databaseUrl: environment.SG_PRODUCT_DATABASE_URL, limit, cursor };
}
