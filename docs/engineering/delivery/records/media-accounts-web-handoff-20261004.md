# 媒体账号资产与凭据管理 Web 端开发交接文档

- **交接日期**：2026-10-04 22:15（北京时间）
- **当前 Git 分支**：`codex/core-automation-loop-stage1`
- **基线提交**：`5b3ec89f2f3d00b32696fec64ece663f697d2c16`（INTEGRATE-5 完成切片）
- **前置任务状态**：真机 Artemis 探针、Facebook 登录态识别、粉丝专页检测、注册流程向导自动化编排均已在 Samsung 真机（`RFCW40MYYCV`）上实测跑通。

---

## 一、需求背景与目标

为支撑真机自动化调度以及多社交媒体账号的企业级资产化运营，系统要求在正式产品线（`product/web`）中建立独立的全局**“媒体账号资产（Media Accounts）”管理模块**。

该模块负责：
1. 统一维护全量社交媒体主账号资产池（平台、账号标识名、人设档案、登录邮箱/账号、登录密码）；
2. 密码必须通过后端已有 AES 加密信封（`media_credentials`）持久化存储，前端界面与接口严禁明文回显；
3. 与具体项目解耦：全局维护账号池，项目详情的“发布身份初始化”仅做账号选择与项目预留（`project_account_reservations`）；
4. 为真机 Artemis 自动化执行提供可信、安全的凭据提取通路，替代人工每次蹲守填密。

---

## 二、既有系统资产与参考代码

接手开发人员应充分复用现有已实现的资产，避免重复设计或破坏架构一致性：

| 模块 | 现有实现文件 | 说明与复用方式 |
| :--- | :--- | :--- |
| **参考 UI（Demo）** | `apps/web-console/components/operations/registry.tsx`（L346-430 `Accounts`） | 一期参考实现：包含账号显示名、平台、归属方、内容定位、真机设备登记。可参考其布局与字段，升级为生产级规范。 |
| **参考初始化交互** | `apps/web-console/components/operations/identity-onboarding.tsx` | 一期身份初始化面板，包含手机初始化、Page 创建与身份核验。 |
| **后端凭据数据库** | `product/backend/migrations/0009_resource_reservations.sql` | `socialgrowth_product.media_accounts` 基础表，定义不可变 `(account_id, platform, canonical_account_ref)`。 |
| **加密信封数据库** | `product/backend/migrations/0023_media_credentials.sql` | `socialgrowth_product.media_credentials` 及修订表，实现基于 AES-GCM 的加密信封存储。 |
| **加密凭据接口** | `product/backend/src/media-credentials.controller.ts` | 已就绪的 `POST /api/operator/media-accounts/:accountId/credentials`，支持 `operation: "put"` 接收 Base64 凭据并安全落盘。 |
| **加密凭据底层存储** | `product/backend/src/media-credential-store.ts` | 凭据加密信封编解码、密钥保管人（`MediaCredentialKeyCustodian`）与内存清零擦除（`payload.fill(0)`）。 |
| **项目发布身份面板** | `product/web/src/account-preparation-panel.tsx` | 项目详情内的初始化面板，当前已有“项目账号”下拉框（读取 `view.accounts`），待打通项目预留选择。 |

---

## 三、待接手开发的具体工作清单

### 1. 契约层扩展（`product/contracts`）
- 在 `product/contracts/src/` 中增加或完善媒体账号管理相关契约：
  - `mediaAccountSchema`：包含 `accountId`、`platform`（`facebook` / `youtube`）、`canonicalAccountRef`、`loginIdentifier`（邮箱/手机）、`persona`（姓名、生日、性别，可结构化或 JSON 扩展）；
  - `createMediaAccountRequestSchema` 与 `createMediaAccountResponseSchema`；
  - `listMediaAccountsResponseSchema`；
- 执行 `pnpm --filter @socialgrowth/product-contracts build && generate:check`，确保 JSON Schema 和 TS 类型同步。

### 2. 后端接口层（`product/backend`）
- **数据库增量（如需持久化扩展人设字段）**：
  - 新建迁移 `0039_media_account_persona.sql`，在 `media_accounts` 上扩展 `login_identifier`、`persona_name`、`persona_birthday`、`persona_gender` 等字段及非空/格式约束；
  - 更新 `DATABASE_INVENTORY`，保持恢复演练一致。
- **控制器与服务**：
  - 新建 `media-accounts.controller.ts` 与 `media-accounts-service.ts`；
  - 提供 `GET /api/operator/media-accounts`（支持按平台筛选，密码不返回，登录邮箱脱敏或完整展示依据运营角色）；
  - 提供 `POST /api/operator/media-accounts`（事务内创建账号记录，并联动调用已有 `MediaCredentialStore.write` 加密存入密码，禁止任何明文密码留痕）。

### 3. 前端界面层（`product/web`）
- **新建组件**：`product/web/src/media-accounts-panel.tsx`
  - 挂载至 `product/web/src/app.tsx`，作为与“项目”、“待办”同级的一级导航标签；
  - **账号列表视图**：展示已有账号、平台徽标、标识名、人设姓名、登录标识、关联项目与真机绑定状态；
  - **新增账号表单**：
    - 平台选择：Facebook / YouTube；
    - 账号标识名（`canonicalAccountRef`，英文字母/数字/下划线）；
    - 登录账号/邮箱（`loginIdentifier`）；
    - 登录密码（`password`，密码框，前端提交后立即销毁内存变量）；
    - 人设档案（姓名/展示名、生日、性别）；
  - **交互纪律**：遵循现有系统规范，表单具备防重复提交（Idempotency Key）、加载中状态禁用按钮、错误反馈提示，不支持明文反查密码（仅支持覆盖轮换）。
- **联动项目设置**：
  - 检查 `product/web/src/account-preparation-panel.tsx` 中的“项目账号”下拉框，使其能直接展示未分配的可用账号，并在提交初始化需求时完成项目预留绑定。

---

## 四、真机现状与 Artemis 已验证基线

接手人员无须重新从零验证底层真机驱动，前序阶段已在物理设备上获得以下扎实证据：

1. **真机环境**：Samsung SM-S9110（`RFCW40MYYCV`），Android 16，USB 物理连接，开发者模式开启；
2. **Facebook App 就绪度**：官方客户端 `com.facebook.katana` 版本 `581.0.0.45.58` 已安装，并已收录于 `catalog.json` 受信任版本名单；
3. **前台界面状态**：Facebook App 当前已安全退出登录，**停留在未登录主欢迎页**，界面包含“使用其他個人檔案（Log into another account）”与“建立新帳號（Create new account）”入口；
4. **Artemis 视觉与执行能力**：
   - 已实测证明 Artemis 可通过视觉模型准确识别主账号名称与登录态；
   - 已实测证明 Artemis 可自主从主页导航至专页管理，识别 Page 是否存在与创建按钮；
   - 已实测证明 Artemis 可自动推进注册向导（填姓名、生日、性别），并在遇到联系方式输入时安全挂起提报 `human_required`。

> **后续联动**：当本 Web 录入功能开发完成后，即可从数据库安全解密提取该账号的登录邮箱与密码，由受控通道派发给 Artemis，执行 Facebook 登录页的“自动填入邮箱 ➜ 自动填入密码 ➜ 提交登录 ➜ 验证登录结果”闭环！

---

## 五、验收标准与测试规范（强制）

根据 [CLAUDE.md](../../../CLAUDE.md) 与 [AGENTS.md](../../../AGENTS.md)：
1. **禁止 Mock 业务结果**：不得通过伪造成功状态绕过页面验收；
2. **Playwright 真实浏览器验收**：
   - 编写 `scripts/verify-product-media-accounts-playwright.mts`；
   - 启动隔离产品服务环境，执行完整流程：真实登录管理台 ➜ 点击“媒体账号”一级导航 ➜ 填写表单录入一个全新 Facebook 账号与密码 ➜ 断言列表回显成功且无密码明文 ➜ 进入筹备项目设置页面 ➜ 验证在项目账号下拉框中能够看到并选定该账号；
3. **静态与类型质量**：
   - `pnpm env:check`（Node v24.16.0）；
   - `pnpm check:product` 0 错误；
   - `pnpm lint:product` 0 错误；
4. **清理与安全纪律**：
   - 测试完毕自动销毁临时数据库与端口，不得残留常驻后台服务；
   - 绝不向普通日志打印密码明文。
