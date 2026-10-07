/** Operator copy for the original phone check; these messages never authorize a retry. */
export const preflightDiagnostics: Record<string, { title: string; next: string }> = {
  identity_audit_timeout: { title: "Page 身份核验超时，发布准备尚未完成", next: "先查看手机上的 Facebook 页面能否正常加载，再查询原检查；系统不会重复启动。" },
  identity_audit_incomplete: { title: "Page 身份核验未完成", next: "核对手机上的目标 Page、登录状态及管理权限，再查询原检查；系统不会重复启动。" },
  content_preflight_timeout: { title: "切片发布准备超时", next: "查看手机上的原准备页面，再查询原检查；不要重复操作或点击发布。" },
  content_preflight_failed: { title: "切片发布准备未完成", next: "查看手机上的原准备页面及素材，再查询原检查；不要重复操作或点击发布。" },
  preflight_timeout: { title: "原发布准备检查超时", next: "查看手机上的原检查状态，再查询原检查；结果核清前不会重复启动。" },
  preflight_failed: { title: "原发布准备检查未完成", next: "查看手机上的原检查状态，再查询原检查；结果核清前不会重复启动。" },
};
