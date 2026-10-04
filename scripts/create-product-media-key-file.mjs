// Explicit offline custodian setup. Never run automatically at service startup.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

async function checkTrustedDirectoryChain(directory) {
  for (let cursor = directory; ; cursor = dirname(cursor)) {
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink() || ![0, process.getuid()].includes(entry.uid)
        || ((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0)) {
      throw new Error("custodian_ancestor_invalid");
    }
    if (dirname(cursor) === cursor) return;
  }
}

let file;
let directoryFile;
let fileBytes;
const encryptionKey = randomBytes(32);
const digestKey = randomBytes(32);
try {
  const args = process.argv.slice(2);
  const grantSigning = args.length === 2 && args[0] === "--grant-signing";
  const target = grantSigning ? args[1] : args[0];
  if ((!grantSigning && args.length !== 1) || !isAbsolute(target) || typeof process.getuid !== "function") {
    throw new Error("input_invalid");
  }
  const path = resolve(target);
  const directory = dirname(path);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) {
    throw new Error("custodian_directory_invalid");
  }
  await checkTrustedDirectoryChain(directory);
  if (encryptionKey.equals(digestKey)) throw new Error("independent_keys_required");
  directoryFile = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const openedDirectory = await directoryFile.stat();
  if (openedDirectory.dev !== stat.dev || openedDirectory.ino !== stat.ino) throw new Error("custodian_directory_changed");
  file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const opened = await file.stat();
  if (!opened.isFile() || opened.uid !== process.getuid() || (opened.mode & 0o777) !== 0o600) {
    throw new Error("custodian_file_invalid");
  }
  // O_NOFOLLOW protects the leaf only. Recheck the path against the pinned
  // directory and file descriptors before writing any key bytes.
  const parentNow = await lstat(directory);
  const fileNow = await lstat(path);
  if (!parentNow.isDirectory() || parentNow.isSymbolicLink() || await realpath(directory) !== directory
      || parentNow.dev !== openedDirectory.dev || parentNow.ino !== openedDirectory.ino
      || !fileNow.isFile() || fileNow.isSymbolicLink() || fileNow.dev !== opened.dev || fileNow.ino !== opened.ino) {
    throw new Error("custodian_path_changed");
  }
  await checkTrustedDirectoryChain(directory);
  let publicGrantKeyId;
  if (grantSigning) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    fileBytes = Buffer.from(privateKey.export({ format: "pem", type: "pkcs8" }), "utf8");
    publicGrantKeyId = createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
  } else {
    const encryptionId = `encryption-${randomUUID()}`;
    const digestId = `digest-${randomUUID()}`;
    fileBytes = Buffer.from(JSON.stringify({
      encryption: { keyId: encryptionId, keyBase64: encryptionKey.toString("base64") },
      currentDigestKeyId: digestId,
      digestKeys: [{ keyId: digestId, keyBase64: digestKey.toString("base64") }],
    }) + "\n", "utf8");
  }
  await file.writeFile(fileBytes);
  await file.sync();
  await directoryFile.sync();
  console.log(publicGrantKeyId
    ? "Created persistent media grant signing key file (0600)."
    : "Created persistent media credential key file (0600). Preserve it with the encrypted database backup.");
  if (publicGrantKeyId) console.log(JSON.stringify({ publicGrantKeyId }));
} catch {
  console.error("Media credential key setup failed. Require a new absolute file path inside an owned, real 0700 directory with trusted parents; existing files are never replaced.");
  process.exitCode = 1;
} finally {
  encryptionKey.fill(0);
  digestKey.fill(0);
  fileBytes?.fill(0);
  await file?.close();
  await directoryFile?.close();
}
