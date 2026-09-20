// Binary files stay outside JSON state; references and digests are audited.
export async function storeAsset(file: File) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const db = await assetDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(file, sha256);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  return { sha256, fileRef: `local-asset:${sha256}` };
}
function assetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('socialgrowth-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function assetUrl(ref: string) {
  if (!ref.startsWith('local-asset:'))
    return /^https?:\/\//.test(ref) ? ref : undefined;
  const db = await assetDb();
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const req = db
        .transaction('files')
        .objectStore('files')
        .get(ref.slice(12));
      req.onsuccess = () =>
        resolve(
          req.result instanceof Blob
            ? URL.createObjectURL(req.result)
            : undefined,
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
