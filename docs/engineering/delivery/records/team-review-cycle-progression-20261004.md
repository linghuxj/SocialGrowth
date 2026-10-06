# 周期连续推进独立审查（2026-10-04）

Reviewer: `/root/adversary`。本轮为独立源码审查，不执行 build/test/容器/浏览器/模型/设备操作。受保护发布脚本未读取、差异比较、哈希或运行。

## UX 候选：changes_requested

- Base: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Head: `f222e25c48612dadf6445779cead193a79b3e71e`
- 精确范围四文件：contracts/src/project-cycle-next-config.ts；web/src/project-cycle-config-api.ts、project-cycle-config-panel.tsx；scripts/verify-product-planning-playwright.mts。
- `project-cycle-progression-read` rev1 已由 backend 与 UX 双签。GET-only 扩展保留原 POST/command receipt schema；持久 pending 的 actor、project、body/key 恢复边界未变。

### Findings

1. **CYCLE-PROGRESSION-UI-01 / P2**：verifier 点击“明确接续同一请求”走 save()，却等待仅 verifyPending() 才产生的“已核对原请求回执”文本；会在自然到期前超时。断言必须匹配实际发送路径。
2. **CYCLE-PROGRESSION-UI-02 / P2**：A applied 分支只断言历史 nextConfiguration 参数，未断言 appliedCurrent 的时区、间隔、最低数以及 endsAt 与 projectedEndsAt 一致。错误物化参数仍可能被记为通过。应断言真正当前周期事实。
3. **CYCLE-PROGRESSION-UI-03 / P2**：safe artifact 将 originalPostReceiptStayedImmutable 写死为 true，但原重放发生在周期物化之前，物化后没有核对原回执。补实际只读核对及安全比较，或明确移除未证明的声明。
4. **CYCLE-PROGRESSION-UI-04 / P2**：GET application.unresolved 复用 POST reasonText，在 calendar/runtime/DST 等失败时称“服务未保存新配置”；实际 GET 保留已确认配置，只是后继应用失败。应区分保存回执与应用事实。
5. **CYCLE-PROGRESSION-DTO-05 / P2**：此完整候选只有 DTO source 修改，未包含声明的 generated/registry 更新；生成 JSON 仍为旧 GET。需纳入 backend 已生成的精确 DTO checkpoint，再冻结新完整候选。

独立 range diff-check 通过；作者明确此 SHA 尚未运行检查/浏览器/模型。两次真实模型、自然 DB 时间到期、周期应用及沿用均是脚本计划，未通过真实验收。

## Backend 候选：changes_requested

- Base: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Head: `1fd910cf29835790ad1ae33433f0328a0199ea18`
- 精确九文件：0038 migration、app.module、cycle-config service/PG test、cycle-store、progression lifecycle、contract source/registry/generated JSON。
- 同一 rev1 双签 GET 契约；原 POST 和持久 command JSON 保持不变。

### Findings

1. **CYCLE-PROGRESSION-SWEEP-01 / P2**：sweep 的 advanceOne 抛错会退出整批，afterProjectId 仅在成功后更新。一个持续失败的 due project 将永远成为游标后的第一项，后续项目被饿死。应隔离每项目失败、推进尝试后的游标、有限日志并下轮 wrap 后重试该项目。
2. **CYCLE-PROGRESSION-SWEEP-02 / P2**：dueProjects 使用无 statement timeout 的池查询；该 pool 未设 connection timeout，shutdown 又等待 running。发现阶段锁等待可无限悬挂，违反有界生命周期。至少给发现查询明确事务级超时及可靠 rollback/release，并处理获取连接的有界性。

### 已核安全性质与证据边界

逐项读取源码：同项目固定 guards 顺序与 project lock；真实 DB clock 传入追加；每轮20项目、每项目最多一条相邻窗口；结束 intent 拒绝新周期；ICU/tz 缺失闭锁；配置一次性消费 unique/FK；后继 startsAt 等于前序 endsAt，配置模式检查预览/参数，沿用模式保留原配置、批准输入和初始 approval；原 immutable UPDATE/DELETE guard 保留。GET 不执行写入，仍校验 session 并在返回前重验期限；权限恒 false；无 Task、quota、指标或执行写入。日志仅固定 event，动态 SQL 表名均固定内部枚举。

作者报告 Node24.16/SQLite、contracts build/generate-check、backend check、改文件 lint 通过；隔离 PG 最终7/7，首轮6/7旧 receipt 断言失败历史保留，容器已清理。本审查核对相关 PG 源断言并独立 range diff-check，通过不扩大为定时生命周期或真实自然到期 UI 验收。PG append helper直接传入边界时间，是补充工程验证，不是实际时钟到期验证。源码发现的两项生命周期问题必须修复后按新 exact head 重审。

## Gate

当前两个 head 均不批准 PR。不得用既有 integration4、next-config 或局部 DTO 批准覆盖本范围。SEC-CYCLE-PROGRESSION 保持 in_progress，等待修复后的作者完整候选；root 后续完整组合还需独立审查。

## Backend 复审 ff526：changes_requested

- Base: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Head: `ff526abbcb4df42095350094997b064942fcaa80`
- 完整十文件，新增 lifecycle 单元测试；其余原始生产范围全部纳入本次复审。
- **SWEEP-01 closed**：逐项目 catch/finally，失败也更新游标；下轮 wrap 重试，其他项目可继续。
- **SWEEP-02 partially fixed, still open**：25 秒共享截止时间、每条 pg query_timeout、服务端 LOCAL statement/lock timeout、未关闭事务/过期 client 销毁已解决获取连接后的等待。已核对本地实际 pg 8.23.0 / pg-pool 3.14.0 实现，Query read timeout 后 release(error) 会从 pool 移除。
- 剩余具体问题：connectBounded 的 Promise.race 只解除 caller 等待，并不取消 pool.connect。AppModule 创建共享 Pool 未设置 connectionTimeoutMillis。TCP 已连接而 PostgreSQL 握手不回包时，connecting client 持续占据 pool；晚到 release 的回调不会触发。周期调用可积累被放弃的 connecting clients，现有 DatabaseLifecycle 的 pool.end 又等待 _clients 清空，因此应用 shutdown 可无限等待。应以驱动真实 acquisition/connect timeout 或可取消的自有获取机制关闭此边界，不能只依赖 Promise.race。

作者报告 focused lifecycle 2/2、隔离 progression PG8/8、Plan PG11/11、生成契约/backend check/lint 通过，首轮 selector7/8失败已保留，容器清理。独立 range diff-check 通过，reviewer未运行测试/服务/网络故障注入。客户端逻辑测试替身不证明真实握手挂起清理；本 head 不批准 PR。

## Backend final full review: approved

- Reviewer: `/root/adversary`
- Base: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Head: `e1baeaa8b30cc89f7ded8b06719fbd5dbc21fe2c`
- Verdict: **approved** for the complete ten-file backend progression, migration, GET contracts/generated registry, lifecycle and test scope. This does not approve the pending UX or root integration candidate.

**SWEEP-01 closed:** each project failure is isolated; the attempted project advances the keyset in finally. A wrap retries failed projects without starving later projects. The pass retains a twenty-project limit and a shared 25-second wait budget.

**SWEEP-02 closed:** the actual AppModule Pool now has `connectionTimeoutMillis: 5_000`. Inspection of installed pg 8.23.0 / pg-pool 3.14.0 confirms that this limits queued acquisition and new connection/handshake waits and removes failed connecting clients. Late acquisition is released. Acquired queries have remaining-budget client query_timeout and server LOCAL timeouts; client timeout immediately releases with error, and open/expired transactions are discarded in finally. Shutdown stops new scheduling and awaits the bounded pass.

The shared five-second cap changes connection-acquisition failure timing, not all running-query deadlines. Congestion or abnormal network conditions may report unavailable sooner. It adds no automatic write retry or authority and is an acceptable bounded scope change. The pass budget assumes a responsive event loop; it is not an OS-level hard-real-time guarantee or proof that every unrelated application shutdown path is bounded.

The added loopback TCP fixture accepts a socket without replying to the PostgreSQL handshake. Author reports lifecycle 3/3: acquisition rejects, totalCount becomes zero, and pool.end returns. Precisely, acquisition has a one-second racing guard; shutdown has an elapsed-time assertion after the await, not a separate racing guard. Do not describe this as complete production outage recovery.

Full source conclusions remain: the old POST/command receipt schema and stored JSON are unchanged; migration constraints enforce one-time configuration consumption, adjacent windows, preserved initial approval/input history, and explicit application/carry origins. Database recordedAt remains separate from boundaries. End intent and missing calendar facts fail closed. GET stays a projection with session checks and false execution/publication permissions; there is no Task, metric or strategy execution.

Independent full-range diff-check passed. Author final-delta backend check, changed-file lint and lifecycle 3/3 passed. The unchanged database implementation/test files retain ff526's PG 8/8 and Plan 11/11 evidence; these suites were not rerun on e1bae. Earlier 6/7 receipt-confusion and 7/8 expired-current fixture failures remain historical, and the author reports isolated-container cleanup. Reviewer performed source-only checks. Natural-boundary real UI, two real model calls and final integration are unverified. SEC-CYCLE-PROGRESSION remains in_progress pending the revised complete UX candidate.

## Merged UX and backend full-source review: approved

- Reviewer: `/root/adversary`
- Base: `e27564d6a2aca4f00e9177f784935b5063fcfee5`
- Head: `e2673b825b93f8f070f0b2b7baa314b7a979794e`
- Verdict: **approved** for the full thirteen-file candidate. Contract `project-cycle-progression-read` revision 1 remains accepted by backend and UX.

Independent Git comparisons confirm that all ten backend/contract files are byte-identical to approved e1bae. The remaining three files are the reviewed Web API, panel and planning verifier. Full-range diff-check passes. No protected publication-script contents were inspected.

All five UX findings close: UI-01 now waits for save()'s actual retry status; UI-02 verifies materialized current timezone/interval/minimum and end equals the confirmed preview; UI-03 now performs a post-progression actor-scoped command GET, strictly parses the original receipt and compares immutable fields with original POST/replay before setting the evidence boolean; UI-04 uses distinct application wording preserving the confirmed configuration; DTO-05 is closed by the exact approved generated/registry source.

The API keeps project/session binding and the original actor-scoped pending command/body/key recovery. Historical applied configuration need not reference the latest current cycle, while a pending configuration still binds its current predecessor. The panel distinguishes original confirmation, application facts, boundary instants and database recordedAt, without claiming review/metrics/Task/execution success. The verifier creates two synthetic projects and obtains model proposals/approval through actual Web controls, waits for natural boundaries, and reads visible current facts; it does not seed DB cycles, alter clocks or mock a successful business response. A uses confirmed configuration once; B checks carry-forward origin, exact adjacency and settings. The supplementary same-actor command GET is read-only and does not replace the primary visible flow. Original key/body/receipt comparisons remain in memory; persisted success/failure projections contain selected facts or booleans. Existing runner discards raw Playwright output; no failure screenshot containing a frozen request key is taken.

Author exact merged-source evidence: env check, contracts build/generate-check, Web typecheck, changed-file lint, strict standalone verifier TypeScript and diff-check passed. Backend evidence remains tied to the reviewed backend sources as described above. Reviewer did not rerun checks, browser, model, services or devices. Two model calls, natural A/B successor materialization, actual replay/readback, screenshots and cleanup on this exact merged head remain **unverified** until the assigned real UI run. This source approval permits the exact candidate gate only; it is not runtime acceptance or approval of a later root head. Original failed heads and findings remain in this report and ledger history.

## Runtime import follow-up: approved

- Reviewer: `/root/adversary`
- Base: `e2673b825b93f8f070f0b2b7baa314b7a979794e`
- Head: `1faaad9b52c15ee1badb22de5db33a2c0dc7097c`
- Verdict: **approved**, no findings, exact one-line runtime import delta only.

The planning verifier now imports the two runtime receipt schemas from `../product/contracts/dist/index.js` instead of the unresolved root workspace package alias. The package exports map identifies this exact built entry as its runtime entry; no schema, action, assertion, permission or evidence behavior changes. Type-only imports remain erased at runtime. The existing runner builds contracts before invoking the verifier; this does not permit stale or absent dist to count as successful acceptance.

Author evidence preserves prior ERR_MODULE_NOT_FOUND and reports successful import/export presence from the built path, strict standalone TypeScript, lint and diff-check. Independent source/range diff-check passed; no reviewer runtime execution. No browser/model/service/fixture rerun occurred. The full e275-to-e267 approval remains historical and this separately approved delta does not establish pending UI acceptance or approve a later root combined head.
