// Explicit offline custodian setup. Never run automatically at service startup.
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

let file;
let directoryFile;
const encryptionKey = randomBytes(32);
const digestKey = randomBytes(32);
try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !isAbsolute(args[0]) || typeof process.getuid !== "function") {
    throw new Error("input_invalid");
  }
  const path = resolve(args[0]);
  const directory = dirname(path);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(directory) !== directory) {
    throw new Error("custodian_directory_invalid");
  }
  if (encryptionKey.equals(digestKey)) throw new Error("independent_keys_required");
  directoryFile = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const openedDirectory = await directoryFile.stat();
  if (openedDirectory.dev !== stat.dev || openedDirectory.ino !== stat.ino) throw new Error("custodian_directory_changed");
  file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const opened = await file.stat();
  if (!opened.isFile() || opened.uid !== process.getuid() || (opened.mode & 0o777) !== 0o600) {
    throw new Error("custodian_file_invalid");
  }
  const encryptionId = `encryption-${randomUUID()}`;
  const digestId = `digest-${randomUUID()}`;
  await file.writeFile(JSON.stringify({
    encryption: { keyId: encryptionId, keyBase64: encryptionKey.toString("base64") },
    currentDigestKeyId: digestId,
    digestKeys: [{ keyId: digestId, keyBase64: digestKey.toString("base64") }],
  }) + "\n", "utf8");
  await file.sync();
  await directoryFile.sync();
  console.log("Created persistent media credential key file (0600). Preserve it with the encrypted database backup.");
} catch {
  console.error("Media credential key setup failed. Require a new absolute file path inside an owned, real 0700 directory; existing files are never replaced.");
  process.exitCode = 1;
} finally {
  encryptionKey.fill(0);
  digestKey.fill(0);
  await file?.close();
  await directoryFile?.close();
}
