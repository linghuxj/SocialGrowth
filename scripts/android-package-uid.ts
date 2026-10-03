/** Parse Android package UID formats while rejecting ambiguous dumpsys output. */
export function parseAndroidPackageUid(output: string): string | undefined {
  const values = [...output.matchAll(/\b(?:appId|userId)\s*[=:]\s*(\d+)\b/g)].map((match) => match[1]);
  if (values.length === 0) return undefined;
  const unique = new Set(values);
  if (unique.size !== 1) throw new Error("PACKAGE_UID_CONFLICT");
  return values[0];
}
