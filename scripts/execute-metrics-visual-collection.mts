// Retired: the former script inserted hard-coded zeros directly into the
// business database and described a screenshot as successful collection.
// Preserve the entry point so existing commands fail before any side effect.
console.error("METRIC_COLLECTION_DISABLED: 原脚本没有真实采集来源，禁止写入预设指标。请从 Web 核对可信来源报告；缺失数据不能填零。");
process.exitCode = 1;
