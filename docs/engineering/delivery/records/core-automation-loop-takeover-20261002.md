# 核心主线接手：C1 整改与 C2a 真实页面补验

日期：2026-10-02。实施者：Codex 主窗口。用户指令：按盘点顺序接手推进。基线 `52767d8`，继续现有 `codex/core-automation-loop-stage1`；不另造阶段分支。候选为本记录所属提交，源码字节及脚本见 [候选 manifest](../../../../artifacts/acceptance/product/B3/core-loop-takeover-c1/candidate-manifest.json)。当前结果是作者验证，原非作者与独立 QA 尚未对本次候选签结论。

## 本批实际变更

| 项目 | 实施与结果 | 仍待确认 |
| --- | --- | --- |
| C1-READ-01 / P2 | 每个素材独立读取序号；旧成功/旧错误不覆盖最新观察，采用基线同步作废在途读取，保留本人输入 | 原复核固定提交复验，作者不清零独立 finding |
| C1-DOC-01 / P3 | tracker 删除对未提交 WP-11 第三阶段文件的交付链接，改为本地未提交事实说明 | 原复核固定提交检查；没有代替外来文件提交 |
| C1 表单可访问名称 | 为 select/textarea 提供与可见文案一致的固定名称，修复保存后 textarea 名称混入值导致无法稳定定位 | 本轮真实页面已验证；全量辅助技术未验 |
| C2a 持续加载 | StrictMode effect cleanup 重置 loadingRef，同时保留 sequence 失效保护；重放允许新读取，旧响应仍丢弃 | 已真实浏览器红→绿；不关闭 StrictMode |
| C2a 样式遗漏 | textarea 复用素材表单既有字体/边框/焦点样式；checkbox 限定 18px，不被通用 input 100% 拉开 | 本轮桌面/手机截图已作者核对；全页面独立视觉未签 |
| 可复现环境 | 自有 PG17.11/固定本地 MinIO 镜像、空库 23 迁移、新合成运营、临时凭据、统一 Playwright 入口 | 非生产部署；不消费设备队列 |

未更改后端业务规则、权限或模型连接。未读取/比较/执行/暂存用户保护的发布脚本；既有外来修改保留。WP-11 第三阶段、ADR-0012 与外来复核报告不纳入本次提交。ADR-0012 的确认来源与范围待单独核对，不把未提交文档自动当成本批实现约束。

## 真实页面与环境

先核对已有监听及服务；复用既有临时隔离服务授权（WP-06 记录），本轮只启动自有测试实例。IAB 实际访问 `http://127.0.0.1:3100/` 显示正式登录页，因此历史安全校验不可用本轮未复现；没有以备用入口绕过拒绝。随后按仓库要求运行真实 Playwright。

环境为 pnpm 8.14.0 / 项目管理 Node 24.16.0、正式 Web Vite、正式 backend build、新 PostgreSQL17.11 与本地 MinIO。每次环境 image ID、端口、迁移、资源所有权及清理见各目录 `environment.json`、`cleanup.json`。首运营使用现有正式 CLI 初始化；项目、文件、资料及规划草案均经 Web 表单创建/保存，没有直接 API 写业务对象、数据库预置成功或 Mock 成功结果。文件为本轮生成的合成 PNG，声明/UUID 明确是合成输入，不证明真实来源权利。

| 验证 | 实际断言 | 证据 |
| --- | --- | --- |
| C1 真实 UI | 登录→创建筹备项目→选择 File/字节上传→首次声明漏勾被拒→人工补资料并保存待检查；两窗口真实 v1/v2 保存与乱序只读回执；采用后晚到回执不重开，未保存草稿仍在；重载 v2、390px 只读且无横向溢出 | [通过日志](../../../../artifacts/acceptance/product/B3/core-loop-takeover-c1/ui-third/materials-playwright.log)，同目录 `materials/` 三张实际截图 |
| C2a 真实 UI | 读取空草案→明确填写目标/形式/时区→整数 01 被拒且输入保留→7天与最低数 0 保存→导航/刷新不丢本人输入→放弃输入→重载草案 v1、形式与 0 持久→390px 禁写且无横向溢出 | [最终通过日志](../../../../artifacts/acceptance/product/B3/core-loop-takeover-c1/planning-visual-fixed/planning-playwright.log)，同目录 `planning/` 桌面/手机截图 |
| 源函数并发补充 | 旧成功不降级、不同素材独立、采用作废在途、卸载/全局代次失效、旧401不清新观察/不退出会话 | [5/5日志](../../../../artifacts/acceptance/product/B3/core-loop-takeover-c1/read-after-fixed.log)；AST 提取实际源函数，非 DOM 验收 |
| 最终工程补充 | Web 82/82；Web 类型/lint/build；两实际 UI 脚本严格 TS；三个脚本 lint | `final-web-*`、`final-scripts-*` 日志在候选证据目录；不重复扩验后端/真机 |

乱序验证只延迟实际浏览器 GET 的真实服务回执，保持 body 不变；另一窗口的 v2 由实际 UI 保存。不以改名或固定手机动作替代 Artemis。

### 保留失败与修复链

- 源函数回归在旧实现真实出现 1PASS/1FAIL（v2 覆盖 v3），见 `read-before-business.log`；最终 5PASS。测试 helper 导出/schema/错误构造器与类型修正的首诊断亦保留，不混为产品失败。
- `ui-first` 的业务类型定位失败、`ui-second` 的保存后 textarea 定位失败，促成固定 accessible name；`ui-third` C1 通过、C2a 失败，不能将整次运行称全绿。
- `planning-diagnostic` 的实际页面一直“正在读取规划事实”，保留失败日志及无敏感值的 panel 截图/文本；StrictMode 修复后 `planning-fixed` 通过，样式修复及形式持久断言后 `planning-visual-fixed` 通过。
- 根目录无独立 tsc，脚本类型检查改用 Web 工作区现有 TypeScript 后通过，没有装全局依赖。

### 可复现命令

明确已授权临时自有服务，并先实际确认浏览器访问准入；检查本地 PG17.11 与固定 MinIO 镜像存在，3100/4320 空闲。已有授权不需重复申请。runner 仅接受本地合成页面范围；每次用新的输出目录：

```sh
pnpm env:check
pnpm --filter @socialgrowth/product-backend build
SG_PRODUCT_CORE_BROWSER_ADMITTED=1 SG_PRODUCT_CORE_OUTPUT=artifacts/acceptance/product/B3/core-local-review pnpm exec node scripts/verify-product-core-loop-local.mjs
```

按需 `SG_PRODUCT_CORE_SCOPES=materials` 或 `planning`。runner 通过 `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=materials|planning pnpm test:playwright` 进入统一入口；账号/凭据生成于私有临时目录，输出脱敏，finally 核对自有容器 ID/label 后清理。未使用历史 `.env` 凭据；原有其他项目 PG/MinIO 未停止。全部本轮环境已退出/删除，最后监听/容器只读检查见 `final-resource-check.log`。

## 四态与后续接续

通过：上述合成输入真实页面流程、作者有限截图核对与工程检查。失败：首轮缺陷/脚本诊断已留痕，最终必需断言无失败。阻断：本轮浏览器访问已成功；C2 真实模型配置仍缺，尚未向模型发送业务数据。未验证：原独立复核与 QA、本轮之外的原请求未知结果/部分失败/多素材/真实素材准入，以及批准/真实 AI/持久任务/Artemis 全链路。

后续保持原工作包与 tracker，不另建滚动进度系统：

1. 原窗口复核本次 C1 两 finding 整改及新 C2a 缺陷修复，独立 QA 复验相同固定提交。本记录没有自签 G1/G3，也未合入 Developer。
2. C2b：连接真实来源/素材资格判定与不可变方向批准；草案不能用作批准。现 `ProjectPlanningService` 仅 preparing/unapproved_draft。
3. C2c：获准模型服务、版本及受控配置位置确定后，接 `BusinessModelCoordinator` 的真实模型端口和实时事实生产者；现在默认 port/policy 缺失，不注入 allow-all 或静态模板。
4. C2d：可校验输出原子持久为计划、Task、名额与 outbox，并发/事实变更复查。现在 pending recheck 不等于可执行 Task。
5. C3 接任务消费、实时物理许可、持久 journal、文件准备、Artemis 模型动作及独立回执；C4 再验证重复/暂停/人工/未知恢复。保留提交前停点，未授权最终公开发布。

真实模型配置问题已向用户提出，待服务名、版本与配置路径（不要发送密钥）。真实短信与第二手机继续按此前确认延期；部署/备份/回滚后置。WP-10 原13补验及父 pending、C3a 原10作者工程边界不因本轮 Web 通过解除。
