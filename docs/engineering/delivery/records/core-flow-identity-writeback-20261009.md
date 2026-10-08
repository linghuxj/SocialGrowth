# 核心流程：原任务身份核验回写

日期：2026-10-09。对应[开发清单第一项](../core-flow-development-checklist.md)。候选按 `dev` 整理，尚未部署身份回写代码、晋级 `main` 或完成完整链路。

## 开发内容

- 执行端新增 `/api/runtime/onboarding/receipts/:requestId` 只读入口。仅返回原任务 `existing_only` 初始化的完整核验：准确父登录标识与平台规范账号 ID、Page／频道 ID、管理权限、原 trace、意图摘要及截图摘要。缺少父身份实测读回的旧成功布尔值不能生成新回执；截图更改或 trace／手机不匹配均拒绝。
- 后端新增 `account-preparation/identity-sync`。浏览器只提交原任务和版本，不能提供或伪造核验事实。先认证及检查分配，再在锁外读取可信执行端，最后重检当前任务、分配、凭据与资源版本，原子保存父账号、唯一发布身份、项目预留、不可改写回执及审计。
- 账号读取显示核验与管理状态；凭据轮换或登录标识不匹配后，不沿用原管理核验作为当前凭据结果。Web 新增“同步原身份核验”，读取和刷新保留原任务；没有回执时显示阻断，不派发手机操作或扩大发布权限。
- 新增迁移 `0052_account_identity_verifications.sql`，未修改已应用迁移。执行源通过现有后端执行服务配置装配，令牌不进入浏览器。
- 修复已有读取验证脚本在 React 渲染前比较卡片数量的竞态；阻断原因改为来自实际读取的身份状态，取消固定写死的“消费者未接通”结论。凭据检查纳入统一 Playwright 入口 `media-credential`。

## 可复现验证

环境：项目 Node.js 24.16.0、pnpm 8.14.0、实际 Web Chromium；数据库检查使用从本地持久开发 PostgreSQL 创建并删除的独立随机测试库。合成组件输入不作为真实手机或平台验收。

```sh
pnpm --filter @socialgrowth/product-contracts generate
pnpm --filter @socialgrowth/product-contracts build
pnpm --filter @socialgrowth/product-executor exec tsx --test src/runtime/identity-onboarding.test.ts
pnpm --filter @socialgrowth/product-backend exec tsx --test src/identity-verification-core.test.ts
pnpm exec tsx scripts/run-identity-verification-pg-checks.mts
pnpm --filter @socialgrowth/product-backend check
pnpm --filter @socialgrowth/product-executor check
pnpm --filter @socialgrowth/product-web check
```

原任务 Web 阻断验证（运营登录文件须由当前环境提供，勿在命令中填写密码）：

```sh
SG_PRODUCT_WEB_SCOPE=identity-sync \
SG_PRODUCT_CORE_PROJECT_ID=b03a3291-92ed-445a-b516-3955446fcc63 \
SG_PRODUCT_CORE_PROJECT_NAME=霸道总裁北美短剧出海 \
SG_PRODUCT_DEPLOYMENT_LOGIN_FILE=.runtime/product-local-live/operator-playwright.json \
pnpm test:playwright
```

正式入口当前状态：

```sh
SG_PRODUCT_WEB_SCOPE=existing-identity-readiness \
SG_PRODUCT_DEPLOYMENT_LOGIN_FILE=.runtime/bootstrap-b1-20261007/production-login.json \
SG_PRODUCT_IDENTITY_READINESS_OUTPUT=output/playwright/core-flow-resume \
pnpm test:playwright
```

已通过：身份执行组件 26 项、核验规则 2 项、真实 PostgreSQL 组件 5 项（原子回写／重复回执、认证及错误来源、取源期间凭据轮换、审计失败回滚、暂停手机及其他账号占用的身份）；Web 原任务同步阻断／重新读取／重载 3 项。正式入口 Web 读取、账号卡片及原手机任务展示通过，无业务写入。类型检查通过。

## 尚未完成及衔接

- 本候选实现了回执消费，不代表正式账号准备消费者已经派发执行。后续须从中央原任务生成对应的 `requestId` 和 `preparationIntentDigest`，接通当前真实权限、手机独占及 Artemis 执行；不能仅向旧执行账本注册项目或账号绕过权限检查。此前旧任务不包含完整父身份读回，不能补写成功。
- 正式入口本次读取：账号 1 个、发布身份 0 个；手机已连接，但保留 `phone-initialization` 占用与 5 个 `UNCONFIRMED` 原回执。手机 USB 在线不代替原停止核验，不解除占用。
- 此前直连 `ssh root@mh` 被服务器关闭；用户补充 `ssh -J root@chenqm root@mh` 后，跳板连接和正式服务只读检查通过。2026-10-09 本次核对期间手机初始化部署已由 `f47f0a0` 更新至 `9b4a859501fc7d56ae3aec9fddf9f5bf6f8f2ff8`，复用该版本；本身份回写候选仍未部署。
- 唯一已有 Page／频道、真实管理权限、实际发布、内容与账号数据采集、三天观察、七天复盘及后续安排仍待真实完整链路验证。清单第一项及其后所有未完成事项保持未勾选。
- 下一项实施条件：先核对原任务停止及当前权限，接通账号准备的正式派发，并用 Web → Artemis → 原回执同步完成第一项；然后串联现有素材与业务任务，逐项补齐正式发布、采集和复盘。

运行原件位于受控 `output/playwright/identity-sync/`、`output/playwright/core-flow-resume/`，不提交 Git；截图只截取已清空凭据的区域。

## 跳板连接恢复后的补验与开发

- 管理连接已恢复：`ssh -J root@chenqm root@mh`。正式 Web 再次通过实际登录、账号页、原手机任务页和项目页读取，业务写入 0；仍为账号 1、发布身份 0、5 个 `UNCONFIRMED` 原回执与初始化占用。原件在受控 `output/playwright/core-flow-jump-ssh/`，不能将 SSH 或页面读取通过计作身份绑定通过。
- 修复发布准备适配器漏查原未决任务的问题：同一目标的 `queued`、`running`、`unknown`、`blocked` 均阻断；统一核对产品手机 UUID、执行设备标识与 ADB serial 的占用、暂停和人工待办；待执行人工反馈仍阻断。任务的预留手机或身份不匹配当前适配器时，在资产读取和派发前拒绝；执行器状态缺项时保持不可执行。
- 5 项隔离适配器组件检查覆盖上述互斥、其他手机不受影响、任务目标不匹配及状态缺项；它们使用合成状态，仅作为代码检查，不作为真实手机验收。可复现命令：`pnpm --filter @socialgrowth/product-backend exec tsx --test src/business-plan-execution-runtime.test.ts`。
- 本地实际 Web 原任务同步、重读及重载 3 项再次通过（`output/playwright/core-flow-jump-ssh-identity/`），业务验收仍为 blocked。后端类型检查和构建通过；目标 lint 无错误，保留该文件原有 2 项警告；文档结构检查通过。
- `core-chain-status` 本次本地检查失败于素材步骤：原项目显示 0 条上传票据，等待“原文件字节已校验”超时。保存失败回执及脱敏截图于 `output/playwright/core-flow-jump-ssh-local/`，没有伪造素材、补写成功或继续宣称发布／效果页已验收。后续须使用获准的真实切片从 Web 上传；上游工具仓库的录屏测试文件不作为业务素材。

## 指令讨论归档与线上素材验证（2026-10-09）

用户要求将指令存储讨论放入文档，稳定后再调整，已保存为[讨论记录](../../../specs/2026-10-09-artemis-instruction-templates-discussion.md)。本轮不实现数据库模板或运行中指令修改。

用户确认沿用此前本地切片。[原授权记录](core-automation-loop-direction-artemis-20261002.md)中的两份“将门逆子”原件均存在，重新计算大小与 SHA-256 后与历史记录一致；不将同目录其他文件自动视为获准素材。

- 正式 Web 实际登录、项目列表读取确认原来没有项目，随后通过页面创建“霸道总裁北美短剧出海”，项目 ID `273547d2-a1c4-421d-ae3d-6b8aa0cea444`，仅为筹备项目，没有批准发布。
- `将门逆子-pxy-8.15-二创 (7).mp4` 通过正式 Web 上传并刷新核对：17,066,476 字节，SHA-256 `2b426251ca5b1547612fd80309bcd3f449bdd17aa0319004b54020ef4eaf2168`，原对象 `0f6922a1-7821-467e-90f4-9584491da4d4`，状态 `verified_bytes`。页面反馈、保存后的摘要和浏览器重载均通过；没有素材登记、候选资格或发布许可。
- `将门逆子-8.13-chh (2).mp4` 的正式 Web 上传验证未通过；原票据 `983b0cca-31dd-4a0f-8aba-38c11f3fa292`、41,927,996 字节、SHA-256 `6564ad3fd4573e103b66e32ace7455dac41ee8ca4f00c640f129a4a97db347ac` 保留为 `pending_bytes`。本轮没有捕获第一次失败响应的准确原因，因此不将其写成已证实的超时或云配置故障。重新打开 Web 核对原票据，不另建相同文件票据；云端只读 HEAD 返回 404，没有写入或补造成功。
- 隔离候选连接原本地业务库进行上传，第一份文件返回 HTTP 503，仍未获得字节核验；该结果与线上第二份成功分别记录，不能将线上结果套用到本地项目。后续恢复须核对原上传请求、票据、对象和存储通路，不能重新上传到新 UUID 规避未知结果。
- 隔离候选的 38 项组件检查、三端类型检查、后端／Web 构建以及真实 Web 身份同步阻断／重读／重载 3 项通过；目标 lint 无错误，保留适配器原有两项警告。组件输入不作为真实账号管理核验。
- 2026-10-09 07:40:38（北京时间）的正式 Web 读取确认最新初始化 `6cb2dd24-fafd-463b-b25c-b9d300e2185d` 已结束为 `UNCONFIRMED`，原初始化占用保留，发布身份仍为 0。当前手机初始化还在单独修订和重测，不能切换旧候选覆盖它；本轮不解除占用、不重发手机任务、不点击公开发布。

可复现 Web 入口新增 `SG_PRODUCT_WEB_SCOPE=core-material-upload`，复用 `pnpm test:playwright`。登录由 `SG_PRODUCT_DEPLOYMENT_LOGIN_FILE` 保护文件提供，文件路径由 `SG_PRODUCT_REAL_MATERIAL_FILES` JSON 数组提供；指定原项目名及 `SG_PRODUCT_REAL_MATERIAL_AUTHORIZED=1`。`SG_PRODUCT_REAL_MATERIAL_INSPECT_INVENTORY=1` 只读原票据；默认遇到已有待校验票据会停止，不重传。只有明确选择 `SG_PRODUCT_REAL_MATERIAL_CREATE_IF_MISSING=1` 才创建缺失筹备项目。

受控证据：`output/playwright/core-flow-fixed-candidate-identity/`、`core-flow-deploy-original-final/`、`core-material-online-originals/`、`core-material-online-reconcile/`、`core-material-online-second/`、`core-material-local-fixed-candidate/`。均不提交 Git。线上已有真实字节记录解决了“线上无真实上传记录”的问题；本地上传、正式准备派发与核验身份仍阻断完整链路，部署健康不能替代这些业务结果。

## 固定候选归档

身份回写、同机互斥、讨论文档及本轮 Web 脚本已单独提交到 `dev`：`e42051d0d4e2b8d894357e889da0796d15a62049`。保留其他任务的工作区修改，没有批量提交账号运营、素材 AI 或其他未提交变更。提交树与隔离检查候选 `02198cfa7aae722a2ceb89fc2e2a155c0098c280` 完全一致；它保留已提交的手机初始化修订 `40e8b5a`。38 项检查在该候选的前一固定树通过，随后合入停止回执的可选错误字段修订，再补查执行器类型及 26 项身份组件，均通过。真实 Web 身份同步阻断／重读／重载 3 项在 `054fd00` 基线的隔离候选通过，原件 `output/playwright/core-flow-db97b00-identity/`；不是成功绑定验收。

源码通过 Git 固定提交归档，已传至服务器 `/opt/socialgrowth/candidates/core-flow/e42051d0d4e2b8d894357e889da0796d15a62049/source.tar.gz`，同目录保存保护权限的 manifest。服务器与本地 SHA-256 均为 `f5ce3a828a61ec2cdff9df17ca747ca15af39b2da27b2e7a8f7fc54113ec8f03`。归档不含运行目录、账号秘密、素材或截图。

本轮**仅准备源码候选，没有构建该候选的线上镜像、执行线上 0052 迁移或切换服务**。归档后正式服务仍为手机初始化候选 `054fd002083cf32b5c294a924008dd4b8095ff3d`，它在本轮期间由另一项手机初始化工作切换；不是本身份回写候选的上线结果。`main`、发布标签和远端推送未改动。部署后须独立核对迁移、版本、原占用、真实身份派发和原回执，不能把本次源码归档或既有素材上传当作上线验收。正式 Web 07:48:21 的只读补验仍为发布身份 0、原初始化占用及 6 条 `UNCONFIRMED` 回执，业务写入 0。

本轮自有临时 Web／后端均已退出，3100／4320 无监听；原业务数据库与手机执行服务保留。
