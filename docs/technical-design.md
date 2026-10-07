# 正式工程技术说明

更新：2026-10-06。依据当前 `dev` 正式源码，配置名和默认行为以代码为准。本文替换开发前的部署建议、接入草案和旧工程适配安排。有效业务要求见[需求基线](current-requirements-summary.md)，当前实现和证据边界见[实现说明](current-implementation.md)。

## 1. 进程与入口

| 部分 | 实现 | 默认边界 |
| --- | --- | --- |
| Web | `product/web`，React／TypeScript／Vite | 3100；同一运营工作台，开发代理见 [Vite 配置](../product/web/vite.config.ts) |
| Backend | `product/backend`，NestJS／Node.js | 4320；[AppModule](../product/backend/src/app.module.ts)装配实际控制器与服务 |
| Executor | `product/executor`，Node.js 和既有 Python Artemis | 配置的 4318；同一 SQLite 任务账本；worker 单独启动 |
| Android | Kotlin 原生 Activity 与服务 | 本人管理和本机身份分别验证，系统授权由本人完成 |
| 本地依赖 | PostgreSQL、Redis、S3／MinIO | [Compose](../product/deploy/compose.product.yml)只描述依赖，不部署业务服务或证明就绪 |

根 [package.json](../package.json)及 [workspace](../pnpm-workspace.yaml)仅包含正式包。统一启动见 [product-local-live](../scripts/product-local-live.mts)。`GET /health/live` 只证明后端进程响应，不检查依赖或业务可用性。

## 2. 数据与契约

中心 PostgreSQL 保存账号、设备、项目、资源、Task、工作流、回执及审计事实。执行器 SQLite 保存原执行、人工协助、证据与未决状态。手机用安全存储保存管理会话、安装身份和待确认操作。数据职责不同，不表示存在两套产品。

数据库迁移在 [migrations](../product/backend/migrations)，必须按文件编号顺序应用。直接启动后端不自动迁移；本地服务组按其自有环境准备数据库，不清空原数据。身份和关联关系见[权威模型](../product/backend/docs/identity-device-er.md)。

[Zod 契约源](../product/contracts/src/index.ts)生成 JSON Schema 和 Kotlin 规格，Python 参考消费者严格校验。`generate:check` 防止已提交生成物漂移；生成成功不等于接口或客户端业务验收。

## 3. 权限与真实事实

运营 Cookie 会话的写操作须 CSRF。提供者只管理本人当前归属设备；安装身份只访问本机范围。请求体中的账号、设备和项目 ID 不授予权限。原请求键、版本、控制代次和持有者分别校验；未知提交先查询原请求，不换键重发。

账号登记、Page／频道验证、资源独占、连接、参与、动作许可、平台提交和最终核验分别记录。平台完成回执必须核对指定身份、内容及来源；不能将上传结束或模型文本记成发布成功。

## 4. 业务与执行接线

[AppModule](../product/backend/src/app.module.ts)先以空端口构造工作流消费器。执行配置完整时，[BusinessPlanExecutionRuntime](../product/backend/src/business-plan-execution-runtime.ts)安装当前事实、准备、动作和证明端口。缺少任一要求时保持关闭；连接 USB 不增加业务许可。

关键执行配置由代码读取：`SG_PRODUCT_EXECUTION_RUNTIME_URL`、`SG_PRODUCT_EXECUTION_RUNTIME_TOKEN`、`SG_PRODUCT_EXECUTION_RUNTIME_BINDING_ID`、`SG_PRODUCT_EXECUTION_SERIAL`、`SG_PRODUCT_EXECUTION_DEVICE_ID`、`SG_PRODUCT_EXECUTION_IDENTITY_ID`、`SG_PRODUCT_EXECUTION_CANONICAL_REF`、`SG_PRODUCT_EXECUTION_ACCOUNT_ID`、`SG_PRODUCT_EXECUTION_PAGE_NAME`。不得将实际令牌或私人身份填入公共文档。

正式 Web 的执行控制通过 [ExecutorConsoleService](../product/backend/src/executor-console-service.ts)的固定认证路由访问。截图及人工协助复用原操作编号。凭据不进入普通日志、模型或页面草稿。受控登录仍须解决[准确接线边界](engineering/delivery/records/r159-artemis-controlled-login-blocker-20261005.md)。

## 5. Android 与网络

[MainActivity](../product/android/app/src/main/java/com/socialgrowth/product/MainActivity.kt)包含同手机管理／执行入口、本机关联、准备引导、系统页面返回检查和本机控制。[AutomaticConnectionMonitor](../product/android/app/src/main/java/com/socialgrowth/product/AutomaticConnectionMonitor.kt)与 [EndpointReportingService](../product/android/app/src/main/java/com/socialgrowth/product/EndpointReportingService.kt)检查连接、发现和上报；用户主动暂停自动连接后保留选择。

内测接线使用 `NetworkSetupApi`、`PilotDeviceNetworkAuthority`、`DeviceConnectionApi` 和中心 ADB。正式 `NetworkAdmissionApi` 的 runtime 当前仍为 `null`。`pilot_verified` 不等于正式准入或任务许可；自动联网不恢复业务任务。当前操作与配置见[Android 接入说明](android-pilot-onboarding.md)。首次安装、首次本人授权、首次配对和零准备异地接入分别验收。

## 6. 文件、凭据与模型

素材存储由 [readMaterialRuntimeConfig](../product/backend/src/material-runtime.ts)读取显式 `SG_PRODUCT_MATERIAL_*` 配置；默认 `unavailable`。S3 对象、哈希、元数据、业务版本及手机文件准备分别核对。

业务模型设置 `SG_PRODUCT_BUSINESS_MODEL_MODE=artemis_configured` 和 `SG_PRODUCT_ARTEMIS_ROOT` 后使用已有合法 `.env`、`.venv/bin/python`；不重新初始化、打印凭据或用模板替代失败。这个模型请求不自动操作手机。

社媒账号密钥由 `SG_PRODUCT_MEDIA_CREDENTIAL_KEY_FILE` 指向受保护文件。受控输入签名的四项配置必须完整：`SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_FILE`、`SG_PRODUCT_MEDIA_INPUT_GRANT_KEY_ID`、`SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_BEFORE_MILLIS`、`SG_PRODUCT_MEDIA_INPUT_GRANT_NOT_AFTER_MILLIS`。缺失关闭，非法或部分配置拒绝启动。具体文件格式、工具和密钥边界见[后端说明](../product/backend/README.md)。

## 7. 效果、引流与恢复

`PageMetricSource` 在执行服务 URL／令牌配置时装配；是否能够取得真实来源还须核对当前 Page 映射、原操作和统计口径。累计值不相加，缺失不补零。最近实测边界见[效果复核](engineering/delivery/records/slice-page-feedback-revalidation-20261006.md)。

`TrackingLinkService` 当前默认真实目标策略为 `null`，不能据短链模型宣称公开跳转已启用。基础分佣读取和内部核对不证明到账或付款。

备份恢复保留原请求、撤权、未知结果及占用。恢复数据库不自动获得执行许可，不重放未知提交。部署、迁移、签名和恢复边界见[部署说明](../product/deploy/README.md)。

## 8. 检查与版本

命令见[当前实现](current-implementation.md#可使用的验证入口)。Playwright 从实际 Web 操作并核对结果；单元、数据库、构建及原生检查只证明各自范围。当前目录和配置不是生产部署证据。`main` 仅接收满足相应检查和业务验收的固定候选；文档整理不晋级版本。
