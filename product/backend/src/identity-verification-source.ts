import { identityVerificationReceiptSchema, type IdentityVerificationReceipt } from "@socialgrowth/product-contracts";

export interface IdentityVerificationSource {
  read(requestId: string): Promise<IdentityVerificationReceipt | null>;
}

export class RuntimeIdentityVerificationSource implements IdentityVerificationSource {
  constructor(private readonly config: { url: string; token: string }) {}
  async read(requestId: string) {
    try {
      const response = await fetch(new URL(`/api/runtime/onboarding/receipts/${encodeURIComponent(requestId)}`, this.config.url), {
        headers: { authorization: `Bearer ${this.config.token}` }, signal: AbortSignal.timeout(20000), redirect: "error",
      });
      if (!response.ok) throw new Error("IDENTITY_SOURCE_UNAVAILABLE");
      const raw: unknown = await response.json();
      const value = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
      if (value === null) return null;
      const receipt = identityVerificationReceiptSchema.parse(value);
      if (receipt.requestId !== requestId) throw new Error("IDENTITY_SOURCE_SCOPE_MISMATCH");
      return receipt;
    } catch { throw new Error("IDENTITY_SOURCE_UNAVAILABLE"); }
  }
}
