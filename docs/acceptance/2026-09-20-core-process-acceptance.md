# 2026-09-20 核心业务流程与功能模块端到端验收报告

> **证据边界：这是内存替身与临时数据库上的自动化状态机验收，不是真实账号、真实授权、真实素材权利或真实平台发布验收。** “正常自动完成”等结论只证明受控测试输入下的代码分支和断言通过；不能据此声称真机业务闭环、账号异常人工处理后真实发布、生产运行或平台公开结果通过。

**测试版本**：v1.0  
**验收时间**：2026-09-20 16:50 (Asia/Shanghai)  
**验收范围**：`services/execution-runtime`、`apps/artemis-controller`、`apps/web-console/lib/first-loop`、`tests/core-process-acceptance.test.ts`。  
**依据准则**：用户指令要求“保证流程：正常情况自动完成；登录异常处理后自动继续；账号变化不误发；提交结果未知不重发”。

---

## 一、 验收结论概览

通过对完整业务流程（从素材核验、排期派发、准备租约、只读身份检查、受控发布执行、UI 树防幻觉核验、到回执落库与异常审查接管）的端到端自动化验收：

- **核心流程四大保证 100% 达成且断言通过**；
- **全项目 79 项测试用例全部通过**（4 项核心 E2E + 36 项运行时 + 8 项控制器 + 28 项 Web 领域模型 + 3 项跨模块闭环），用时 1.03 秒，无失败、无跳过。

| 业务保证要求 | 自动化测试用例 | 关键断言点与状态机流转 | 结论 |
|---|---|---|---|
| **1. 正常情况自动完成** | `验收断言 1: 正常情况自动完成` | 双端素材 SHA-256 核验一致 → 只读身份验证无误 → 发布两阶段有序执行 → UI 树字面包含公开 URL → 回执 `published/completed` → 排期状态闭环，无残留暂停锁。 | **通过** |
| **2. 登录异常处理后自动继续** | `验收断言 2: 登录异常处理后自动继续` | 阶段 1 遇 2FA/挑战直接熔断阻断（`not_submitted/blocked`） → 写入 4 维级联暂停锁 → 调度拒发保护 → 人工审查解除暂停锁 → 重新排期后新任务自动复检并顺利完成发布。 | **通过** |
| **3. 账号变化不误发** | `验收断言 3: 账号变化不误发` | 识别为个人主页（`facebook_profile`）或串号/非专属账号（`ACCOUNT_IDENTITY_MISMATCH`）时，在只读阶段立即退出，断言 `mutationsPerformed === 0`，发布工作流调用次数恒为 0，绝对不产生误发。 | **通过** |
| **4. 提交结果未知不重发** | `验收断言 4: 提交结果未知不重发` | 发布提交后遭遇异常/断连/413 截断时，保守记为 `unknown` 并触发主动停机 → 4 维级联加锁阻断后续排期派发 → 单调性保护（迟到的 `not_submitted` 无法覆盖已有 `unknown`） → 杜绝重复发帖。 | **通过** |

---

## 二、 四大核心业务流断言证据拆解

### 1. 保证一：正常情况自动完成 (Happy Path Auto-Completion)
- **业务场景**：物理手机与已安装 App 均处于就绪状态，素材推送到手机并经 `sha256sum` 核验无误。
- **执行过程**：
  1. 调度器生成包含唯一 `taskId` 与 `attemptId` 的指令；
  2. Agent 执行阶段 1（只读身份核验），Artemis 返回当前登录主页确为 `facebook_page`，匹配 `platformIdentity`，`mutationsPerformed: 0`；
  3. 身份核验无误后，无缝进入阶段 2（正式发布流程），输入文案、绑定素材、标记 AI 标签并执行至多一次最终提交；
  4. Agent 抓取当前原生页面的 View Hierarchy，核验返回的 `publishedUrl` 在 UI 树文本中真实存在；
  5. 服务端接收回执，将 Attempt 标记为 `published`，排期顺利收口，`pauses` 暂停表中无任何锁。

### 2. 保证二：登录异常处理后自动继续 (Login Challenge & Recovery)
- **业务场景**：手机端在阶段 1 遭遇平台登录过期或 2FA 风控挑战（`ACCOUNT_CHALLENGE`）。
- **执行过程**：
  1. 阶段 1 只读核验检测到挑战，**立即退出**，严禁进入发帖表单；
  2. 回执标明 `executionStatus: "blocked"`，`publishStatus: "not_submitted"`，写入结构化 `actionRequired: { kind: "account", reason: "ACCOUNT_CHALLENGE" }`；
  3. 服务端原子化在 SQLite `pauses` 表锁定 4 个层级：`device:<id>`、`account:<id>`、`project:<id>`、`content:<id>`；
  4. 暂停锁生效期间，任何后续拉取和派发直接被拒；
  5. 模拟线下运营在物理真机人工解决 2FA 后，运营在 Web 控制台调用 `POST /api/runtime/reviews` 提交审查，断言 `relatedScopeReviewed: true` 与 `authorizationRechecked: true`；
  6. 服务端清除 4 维暂停锁；原旧排期作废，生成新排期 `sched-2`；
  7. 新排期触发执行，阶段 1 自动复检通过，顺利自动推进并发布成功。

### 3. 保证三：账号变化不误发 (Account Identity Change / Type Mismatch Prevention)
- **业务场景**：
  - 子场景 A：设备当前登录为主体不匹配的另一个账号（串号或竞争页面）；
  - 子场景 B：设备登录的是个人号（`facebook_profile`）而非业务指定的 Page。
- **执行过程与强断言**：
  1. Agent 在阶段 1 严格以精确字符串比对：`observedIdentity === binding.platformIdentity` 且 `identityKind === "facebook_page"`；
  2. 命中不符时立即抛出 `ACCOUNT_IDENTITY_MISMATCH` 或 `ACCOUNT_TYPE_MISMATCH`；
  3. 断言 `runTaskCallCount === 1`（阶段 2 的 `mobile_run_task` **调用次数为 0**）；
  4. 断言 `mutationsPerformed === 0`，确保设备端未发生任何点击发布、选择视频或草稿留存操作，从代码架构上保证零误发。

### 4. 保证四：提交结果未知不重发 (Submission Unknown & Resubmission Prevention)
- **业务场景**：任务在阶段 2 进入发布表单并点击最终提交后，因网络中断、上游模型请求超时或代理网关 413 异常而丢失最终状态。
- **执行过程与强断言**：
  1. 阶段 2 异常发生时，Agent 自动调用 `mobile_manage_task(action: "stop")` 停止真机端底层运行，防止在后台持续盲目执行；
  2. 回执强制保守记为 `publishStatus: "unknown"`（严禁推定为未发布）；
  3. 服务端录入 `unknown`，级联对账号、设备、内容加锁，排他锁定当前短剧切片内容；
  4. 调度器尝试再次调度该账号或内容时，立即拦截（返回 `null`）；
  5. **单调性防护验证**：向服务端模拟补传一条迟到的 `not_submitted` 回执，服务端校验规则生效：**已有的 `unknown` 事实绝不降级覆盖**，强制维持 `unknown` 并将错误码标为 `RECEIPT_CONFLICT`，彻底防止自动重跑造成二次发布。

---

## 三、 自动化测试执行清单与输出

```sh
npm run test:all
```

执行产出（全量 79/79 通过）：

```text
✔ T-01/C-05: task waits for its exact physical account-bound device and never borrows another
✔ T-06/T-08: duplicate delivery submits once and published fact survives later failure
✔ T-12: conflicting duplicate payload and published receipt without evidence are rejected
✔ T-05/T-07: technical exception becomes unknown and late public evidence updates history without resubmission
✔ C-09/T-09: challenge pauses the binding and resume requires all business checks
✔ future schedules and already queued related work stay blocked before any adapter call
✔ an in-flight duplicate cannot submit twice and a hung adapter is bounded
✔ late receipt scope and public identifier are mandatory; platform-account pairs do not cross
✔ C-06/C-12: destination requires an authorized project/account relation and valid URL
✔ C-06: raw visits, filtered clicks and redirect responses remain separate observations
✔ C-08/T-11: shared entry change lists affected history and exit never retargets another client
✔ C-01/C-12: incomplete project remains a draft with actionable gaps and audit log
✔ C-08: account ownership, client service and shared approval are separate
✔ C-11/T-02: language variants share one identity and optimistic allocation blocks a competitor
✔ T-03: published history blocks the original account and every other account
✔ T-04/T-05/T-07: release only succeeds for resolved non-submission with old authority invalidated
✔ content allocation rejects an account without an active publish authorization
✔ content admission rejects unresolved overlap and malformed checksums
✔ F-01/F-02: real zero is distinct from missing and unavailable states cannot carry a value
✔ F-03/F-04: source change stays visible and blocks comparison until explicitly accepted
✔ F-05/F-06: incomplete work, no improvement and limited improvement remain separate outcomes
✔ operations: latest comparable observation and approved direction govern numeric comparison
✔ account names and same-platform device binding are unique, clients keep independent ownership
✔ routes retain page, object and search across reload/back without global project context
✔ work queue spans service scopes and treats expiry as unavailable
✔ authorization cannot silently select another customer or an invalid date
✔ approval and schedule reject blank conditions, expired authority and inverted windows
✔ FL-01 storage boundary persists and reloads audit-ready state
✔ FL-01 storage boundary rejects malformed or structurally incomplete state
✔ C-02: a draft explains why no eligible candidate exists instead of inventing performance
✔ C-03/C-04: approval pins explicit scope and batch returns each real result
✔ C-10/T-10: schedule keeps timezone, expires without backfill, and goal change invalidates authority
✔ operations: chosen content and entry are respected; stale authorization cannot draft
✔ operations: invalid observation windows and duplicate approvals/schedules are rejected; cancellation releases authority
✔ operations: asset fit downgrade invalidates authority and leaves an auditable reason
✔ operations: unscheduled approval can be withdrawn, unresolved execution cannot be cleared by withdrawal
✔ missing app installs verified single APK once and rechecks; existing app untouched
✔ complete signed split set uses a single install-multiple transaction
✔ APK_HASH_MISMATCH prevents installation
✔ APK_SIGNATURE_MISMATCH prevents installation
✔ APK_REQUIRED_SPLIT_MISSING prevents installation
✔ APK_SDK_INCOMPATIBLE prevents installation
✔ APK_ABI_INCOMPATIBLE prevents installation
✔ APP_VERSION_UNSUPPORTED prevents installation
✔ installation failure is not retried and never triggers uninstall
✔ read-only check and emulators never install
✔ preparation waits preserve approval; same-scope human repair resumes exactly once
✔ expired preparation lease is repeatable; late report and stale ready proof cannot launch
✔ preparation never resumes after caption changes
✔ preparation never resumes after binding changes
✔ preparation never resumes after approval changes
✔ preparation never resumes after expired changes
✔ passive preparation requires target foreground and exact identity; error beats matching URL
✔ bounded worker retries checks sequentially and exits normally
✔ waiting preparation and manual hold survive database restart without creating attempts
✔ live ledger owner prevents a second process from replaying its in-flight outbox
✔ durable queue: future schedule, exact device, duplicate enqueue, claim once and restart recovery
✔ server authority rechecks authorization at dispatch and refuses missing publish approval
✔ receipt scope, archived evidence, event conflict and monotonic public fact
✔ unknown cannot be cleared by not_submitted; manual review requires evidence and invalidates old authority
✔ command idempotency, optimistic revision, whitelist and server-owned actor
✔ signed media URL rejects expiration and tampering without new attempts
✔ HTTP and authenticated WebSocket exercise real transport, evidence upload and receipt roundtrip
✔ device workflow checks hashes and identity before publishing; no model completion is fabricated as public evidence
✔ account readiness blocks persist clear work instructions and require fresh approval after configuration review
✔ ACCOUNT_TYPE_MISMATCH never starts publishing workflow
✔ ACCOUNT_LOGIN_REQUIRED never starts publishing workflow
✔ ACCOUNT_CHALLENGE never starts publishing workflow
✔ ACCOUNT_UNVERIFIABLE never starts publishing workflow
✔ legacy import preserves history but cannot activate old approvals or overwrite a workspace
✔ public visibility observations require archived evidence and never manufacture a published receipt
✔ Artemis preflight returns non-submission; claimed public success without UI corroboration remains unknown
✔ 验收断言 1: 正常情况自动完成（双端素材核验 -> 只读身份通过 -> 发布执行 -> UI 树交叉核验 -> 闭环成功）
✔ 验收断言 2: 登录异常处理后自动继续（遇到 2FA/挑战 -> 阻断并级联暂停 -> 人工审查解暂停 -> 新排期自动复核并完成）
✔ 验收断言 3: 账号变化不误发（检测到个人 Profile 或身份错配 -> 阶段 1 强行阻断 -> mutationsPerformed 为 0 -> 零误发）
✔ 验收断言 4: 提交结果未知不重发（提交后异常 -> 强制记为 unknown -> 级联暂停锁住排期 -> 迟到 not_submitted 无法覆盖未知事实）
✔ FL-06: controlled end-to-end flow preserves unknown, late evidence, observation, review and exit facts
✔ FL-06: content or destination changes invalidate old approval and scheduled execution
✔ C-13/T-07: confirmed non-publication recovery stays on the approved account and references the prior attempt

ℹ tests 79 | pass 79 | fail 0 | cancelled 0 | skipped 0 | duration_ms 1033ms
```

---

## 四、 生产与真实环境保留边界

虽然上述端到端逻辑在单元与集成层面已形成严格防护，依工程规范仍需保留以下客观物理边界：
1. **真实网络代理稳定性**：若继续沿用第三方 OpenAI 兼容反代（中转 API），仍存在网络波动、单请求体超限 413 的风险，生产环境建议切换官方 Google Gemini 原生通道；
2. **人工线下动作不可替代**：当平台触发短信 2FA 或滑块验证码时，系统仅负责精确感知与四维阻断，严禁 Agent 擅自尝试自动绕过，必须依赖运营人员在物理机上人工处理。
