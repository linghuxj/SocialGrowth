import { identityVerificationReceiptSchema, type AccountPreparationIntent, type IdentityVerificationReceipt } from "@socialgrowth/product-contracts";

export interface IdentityVerificationTarget {
  taskId: string; projectId: string; accountId: string; deviceId: string;
  intentDigest: string; intent: AccountPreparationIntent; loginIdentifier: string;
  canonicalAccountRef: string | null;
}
export function validateIdentityVerification(raw: unknown, target: IdentityVerificationTarget, now: Date): IdentityVerificationReceipt {
  const receipt = identityVerificationReceiptSchema.parse(raw);
  const timestamp = Date.parse(receipt.verifiedAt);
  if (receipt.requestId !== target.taskId || receipt.projectId !== target.projectId
    || receipt.accountId !== target.accountId || receipt.deviceId !== target.deviceId
    || receipt.intentDigest !== target.intentDigest || receipt.platform !== target.intent.target.platform
    || receipt.scopeRef !== target.intent.scopeRef || receipt.observedName !== target.intent.target.name
    || receipt.observedLoginIdentifier.toLowerCase() !== target.loginIdentifier.toLowerCase()
    || (target.intent.target.expectedId !== null && receipt.canonicalIdentityRef !== target.intent.target.expectedId)
    || (target.canonicalAccountRef !== null && receipt.canonicalAccountRef !== target.canonicalAccountRef)
    || timestamp > now.getTime() || now.getTime() - timestamp > 86400000) {
    throw new Error("IDENTITY_RECEIPT_SCOPE_OR_FRESHNESS_INVALID");
  }
  return receipt;
}
