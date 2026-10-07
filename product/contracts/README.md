# 正式共享契约

[src/index.ts](src/index.ts)导出当前 Zod 运行时校验源。[generated](generated)保存 JSON Schema；同一生成步骤更新 Android 的首批身份、准入和参与规格。Python 参考消费者在 [python](python)。静态类型或生成常量不授予业务权限。

契约覆盖身份、邀请、关联、网络、参与、控制、资源、项目、素材、工作流、协助、效果、分佣与执行控制。实际 HTTP 装配见[后端 AppModule](../backend/src/app.module.ts)，Android 消费见[客户端说明](../android/README.md)。协议版本在各 schema 中显式定义，不将所有独立协议写成同一版本。

请求携带原 requestId／幂等键及要求的版本。重放须再次通过当前权限校验；同键不同内容拒绝，未知提交不换键创建。strict 响应增加字段也可能导致旧消费端拒绝，变更时必须验证对应 Kotlin、Python 和 Web 组合。

```sh
pnpm --filter @socialgrowth/product-contracts check
pnpm --filter @socialgrowth/product-contracts test
pnpm --filter @socialgrowth/product-contracts build
```

`generate` 显式更新产物。`generate:check` 比较字节，发现漂移失败，不重写文件。跨语言检查不证明真实短信、扫码、手机执行或平台发布。具体实现与未完成范围见[当前实现](../../docs/current-implementation.md)。
