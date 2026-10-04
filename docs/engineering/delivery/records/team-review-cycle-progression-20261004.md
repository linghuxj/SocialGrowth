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
