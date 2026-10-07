import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

const maxKeyFileBytes = 4096;
const keyIdPattern = /^[0-9a-f]{64}$/;
const pemHeader = Buffer.from("-----BEGIN PRIVATE KEY-----\n", "ascii");
const pemFooter = Buffer.from("-----END PRIVATE KEY-----\n", "ascii");

export interface MediaInputGrantSigningKey {
  readonly keyId: string;
  readonly privateKey: KeyObject;
}

export class MediaInputGrantKeyFileError extends Error {
  constructor() { super("MEDIA_INPUT_GRANT_KEY_UNAVAILABLE"); }
}

function fail(): never { throw new MediaInputGrantKeyFileError(); }

function sameInode(a: { dev: number | bigint; ino: number | bigint }, b: { dev: number | bigint; ino: number | bigint }): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function exactMode(stat: { mode: number | bigint }, expected: number): boolean {
  return (Number(stat.mode) & 0o7777) === expected;
}

function serviceUid(): number {
  const uid = process.getuid?.();
  if (!Number.isInteger(uid) || uid! < 0) return fail();
  return uid!;
}

function validatePemFrame(bytes: Buffer): void {
  if (bytes.length <= pemHeader.length + pemFooter.length
    || !bytes.subarray(0, pemHeader.length).equals(pemHeader)
    || !bytes.subarray(bytes.length - pemFooter.length).equals(pemFooter)) fail();

  const bodyEnd = bytes.length - pemFooter.length;
  let column = 0;
  let lines = 0;
  for (let i = pemHeader.length; i < bodyEnd; i++) {
    const byte = bytes[i]!;
    if (byte === 0x0a) {
      if (column < 1 || column > 64 || (i + 1 < bodyEnd && column !== 64)) fail();
      lines++;
      column = 0;
    } else {
      if (!((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
        || (byte >= 0x30 && byte <= 0x39) || byte === 0x2b || byte === 0x2f || byte === 0x3d)) fail();
      column++;
      if (column > 64) fail();
    }
  }
  if (column !== 0 || lines < 1) fail();
}

function validParent(stat: Awaited<ReturnType<typeof lstat>>, uid: number): boolean {
  return stat.isDirectory() && stat.uid === uid && exactMode(stat, 0o700);
}

function validKeyFile(stat: Awaited<ReturnType<typeof lstat>>, uid: number): boolean {
  return stat.isFile() && stat.uid === uid && exactMode(stat, 0o600) && stat.nlink === 1
    && stat.size > 0 && stat.size <= maxKeyFileBytes;
}

function loadPrivateKey(bytes: Buffer): KeyObject {
  validatePemFrame(bytes);
  const key = createPrivateKey({ key: bytes, format: "pem", type: "pkcs8" });
  if (key.type !== "private" || key.asymmetricKeyType !== "ec"
    || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") fail();
  return key;
}

function derivedKeyId(privateKey: KeyObject): string {
  const publicKey = createPublicKey(privateKey);
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") fail();
  const spki = publicKey.export({ type: "spki", format: "der" });
  if (!Buffer.isBuffer(spki) || spki.length === 0) fail();
  return createHash("sha256").update(spki).digest("hex");
}

/**
 * Loads one already-deployed signing key. This function never creates a key,
 * rotates a key, consults environment/CLI input, or falls back to randomness.
 * The key ID is SHA256(canonical P-256 SPKI DER), and the caller must already
 * have selected that ID from its current trusted keyset.
 */
export async function loadMediaInputGrantSigningKey(
  absolutePath: string,
  expectedKeyId: string,
): Promise<MediaInputGrantSigningKey> {
  let directory;
  let file;
  let pem: Buffer | undefined;
  try {
    if (typeof absolutePath !== "string" || !isAbsolute(absolutePath) || resolve(absolutePath) !== absolutePath
      || typeof expectedKeyId !== "string" || !keyIdPattern.test(expectedKeyId)) fail();
    const uid = serviceUid();
    const parentPath = dirname(absolutePath);
    if (await realpath(parentPath) !== parentPath) fail();

    const parentPathStat = await lstat(parentPath);
    if (!validParent(parentPathStat, uid)) fail();
    directory = await open(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const parentFdStat = await directory.stat();
    if (!validParent(parentFdStat, uid) || !sameInode(parentPathStat, parentFdStat)) fail();

    const filePathStat = await lstat(absolutePath);
    if (!validKeyFile(filePathStat, uid)) fail();
    file = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const fileFdStat = await file.stat();
    if (!validKeyFile(fileFdStat, uid) || !sameInode(filePathStat, fileFdStat)) fail();

    // Read one byte beyond the format bound so concurrent growth cannot turn a
    // bounded key file into an unbounded allocation.
    pem = Buffer.alloc(maxKeyFileBytes + 1);
    const { bytesRead } = await file.read(pem, 0, pem.length, 0);
    if (bytesRead !== fileFdStat.size || bytesRead > maxKeyFileBytes) fail();
    pem = pem.subarray(0, bytesRead);

    const fileAfter = await file.stat();
    const pathAfter = await lstat(absolutePath);
    const parentAfter = await directory.stat();
    const parentPathAfter = await lstat(parentPath);
    if (!validKeyFile(fileAfter, uid) || fileAfter.size !== bytesRead || !sameInode(fileFdStat, fileAfter)
      || !validKeyFile(pathAfter, uid) || !sameInode(fileFdStat, pathAfter)
      || !validParent(parentAfter, uid) || !sameInode(parentFdStat, parentAfter)
      || !validParent(parentPathAfter, uid) || !sameInode(parentFdStat, parentPathAfter)) fail();

    const privateKey = loadPrivateKey(pem);
    if (derivedKeyId(privateKey) !== expectedKeyId) fail();
    return Object.freeze({ keyId: expectedKeyId, privateKey });
  } catch {
    throw new MediaInputGrantKeyFileError();
  } finally {
    pem?.fill(0);
    await Promise.allSettled([file?.close(), directory?.close()].filter((v): v is Promise<void> => v !== undefined));
  }
}
