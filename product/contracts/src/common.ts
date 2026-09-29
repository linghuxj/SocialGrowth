import { z } from "zod";

export const contractVersion = "2026-09-29.identity-v1" as const;
export const contractVersionSchema = z.literal(contractVersion);
export const uuidSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const requestIdSchema = z.string().min(8).max(128);
export const idempotencyKeySchema = z.string().min(16).max(128);

export const requestMetadataSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  requestId: requestIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const requestTraceSchema = z.strictObject({
  contractVersion: contractVersionSchema,
  requestId: requestIdSchema,
});

export const versionedFactSchema = z.strictObject({
  factVersion: z.int().nonnegative(),
  updatedAt: timestampSchema,
});

export function compareTimestamps(left: string, right: string): number | null {
  const parts = (value: string): { fraction: string; seconds: bigint } | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6] || !match[8]) return null;
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setUTCHours(Number(match[4]), Number(match[5]), Number(match[6]), 0);
    const offsetMinutes = match[8] === "Z"
      ? 0
      : (match[9] === "+" ? 1 : -1) * (Number(match[10]) * 60 + Number(match[11]));
    return { seconds: BigInt(date.getTime() / 1000 - offsetMinutes * 60), fraction: match[7] ?? "" };
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  if (!leftParts || !rightParts) return null;
  if (leftParts.seconds !== rightParts.seconds) return leftParts.seconds < rightParts.seconds ? -1 : 1;
  const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  return leftParts.fraction.padEnd(width, "0").localeCompare(rightParts.fraction.padEnd(width, "0"));
}
