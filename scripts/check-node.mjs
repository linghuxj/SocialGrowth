// Keep this dependency-free so environment problems are actionable before startup.
const [major, minor] = process.versions.node.split('.').map(Number);
try {
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error('需要 Node.js >=22.13.0');
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.prepare('SELECT 1').get();
  } finally {
    db.close();
  }
  console.log(`[environment] Node ${process.version} | ${process.execPath} | SQLite OK`);
} catch (error) {
  console.error(`[environment] 启动检查失败：${error.message}`);
  console.error(`当前 Node：${process.version} (${process.execPath})`);
  console.error('请从仓库根目录使用 pnpm install --frozen-lockfile，再执行 pnpm env:check / pnpm dev。');
  console.error('项目 .npmrc 自动选择 Node 24.16.0；首次使用需要联网下载。不要用全局 node 直接启动服务。');
  process.exitCode = 1;
}
