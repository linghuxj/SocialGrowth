# 团队首批集成核验 — 2026-10-04

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本记录仅交接首批 H1/H2/H3 工程与真实 Web 页面切片，不是全部产品开发、生产上线或最终业务验收。

## 固定候选与范围

- 基线：`f583f184891bd3d0406c43821cb3d36e2eb1233a`。
- 本记录之前的集成代码/报告候选：`c9014406a77e9b6de80df3497067b6f190cf3180`。
- 来源：主窗需求扫描 `24c1539`、backend `fc28ad0`、ux `d8f1697`；各自精确 SHA 已独立批准，完整来源见相邻 `team-review-*` 记录。adversary 对组合的 17 个 Git blob 逐一比对，无冲突改写或未审代码。
- 草稿 [PR #9](https://github.com/linghuxj/SocialGrowth/pull/9) 固定 backend head `fc28ad0691f2250a8880c1c6c42a3e9efe0ca2bf`；[PR #10](https://github.com/linghuxj/SocialGrowth/pull/10) 固定 ux head `d8f169785c6adf3db7294158cbe7ed4925df2a1f`。目标都是当前推进分支，未将整个历史产品分支送入 main。
- 用户未提交的需求、Android 对齐、设计、ADR、历史审查及受保护发布脚本未进入本批提交。

## 通过

- 主窗 `pnpm check:product` 通过；文档结构核验 158 需求、30 工作包、61 验收组、10 正式契约、13 风险、290 本地链接通过，仅证明结构。
- 集成候选真实根 Playwright：素材上传/人工信息保存、周期未批准草案、真实已配置模型的方向生成/确认，三个流程均通过。页面写入只发生在本次隔离 PG/对象存储，业务输入为合成资料。
- 只读最终事实：projects=3、material revisions=2、unapproved drafts=2、direction proposals=2、direction approvals=1、verified byte tickets=1。方向确认不计为 Task 派发、手机执行或公开发布。
- 手机失败恢复后的真实 `device-live` 根 Playwright 通过：非空提供者与已关联 Samsung 仍可见，accessReady=false，未把关联改称准入。
- 实际 Samsung `install -r` 成功且 UID=10377 保持；失败后主包和测试包分别恢复成功，未 clear/uninstall 主包、未发送参与命令。
- 隔离重试最终 cleanup 确认自有服务退出、两个自有容器及临时凭据清理；现有 3100/4320、Demo 与外来对象存储未被停止。

## 失败及临时解决

- 首次集成运行在 PG readiness 截止时失败，尚未执行页面业务。源码未改，第一次自有资源已完整清理；新建隔离资源重试后通过。首次具体启动原因未证实，不称已修复数据库缺陷。
- 手机 11 项 HTTPS 补充协议未通过：官方当前 WhoIs 的 Samsung Online=false，独立核验入口拒绝启动。首轮 USB probe 在入口未就绪时开始，最终失败并恢复；后续顺序要求先确认可信节点在线、入口启动成功，再进行安装/probe，本轮未再安装重试。
- 手机证据输出已支持唯一目录，旧 20261003 历史报告在另存本轮失败后原样恢复。

## 阻断与未验证

- H4-H5：真实 Tailnet 写配置、强制受限路径及实际修订闭环；当前手机 Tailnet 离线也归此唯一条目。USB 在线不代替 Tailnet 在线，不恢复此前退出的参与。
- RES-03、RES-04/11、RES-06/08/10、原 SEC/WP10 固定门禁继续保留，详见 `team-rescan-20261004.md` 与共享 tasks.json，不复制另一套滚动进度。
- PR #9 当前精确 head 的 GitHub Actions runs=0；CI 仍未验证。PR 已创建与本地检查不计为 CI 通过。
- 原生 11 页面组、素材真正候选准入、方向至 plan/Task/名额、当前控制执行、联合恢复、真实平台发布/反馈/分佣/规模验收仍由原任务继续推进。本批不关闭这些缺口。
- 只读旧队列核对：1 条 unknown 任务、6 条身份任务，未消费、未重试或写入。

## 复现与证据

```sh
SG_PRODUCT_CORE_BROWSER_ADMITTED=1 SG_PRODUCT_CORE_SCOPES=materials,planning,direction \
SG_PRODUCT_CORE_ARTEMIS_ROOT=/Users/linghuxj/Documents/myproject/project/SocialGrowth/integrations/google-artemis \
SG_PRODUCT_CORE_WEB_PORT=3400 SG_PRODUCT_CORE_BACKEND_PORT=4520 \
SG_PRODUCT_CORE_OUTPUT=artifacts/acceptance/team-lead-20261004/integrated-core-retry \
pnpm exec node scripts/verify-product-core-loop-local.mjs

SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=device-live \
SG_PRODUCT_REAL_DEVICE_SCOPE=authorized SG_PRODUCT_DEVICE_PHASE=verify \
SOCIALGROWTH_VERIFICATION_OUTPUT=artifacts/acceptance/team-lead-20261004/post-phone-restore-web \
pnpm test:playwright
```

复跑必须使用新的证据目录，并确认端口空闲、服务边界与真实模型配置仍有效。主窗证据保存在 `artifacts/acceptance/team-lead-20261004/`；初次 PG readiness 失败及清理保存在 `artifacts/acceptance/product/B3/core-local-1791047493674/`。日志与截图留本地，本提交仅含脱敏结果 JSON，不提交模型配置、密码、会话、私有 APK 或原始诊断。
