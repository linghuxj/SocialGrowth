// Binary files stay outside JSON state; references and digests are audited.
export async function storeAsset(file: File) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const response = await fetch('/api/runtime/assets', {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-Content-Sha256': sha256 },
    body: file,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error('素材未保存到执行服务，请检查文件格式与连接');
  return (await response.json()) as { sha256: string; fileRef: string };
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
  if (/^runtime-asset:[a-f0-9]{64}$/.test(ref))
    return `/api/runtime/assets/${ref.slice(14)}`;
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
