# 自动化闭环接线与新项目验证（2026-10-05）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

## 本轮用户确认与范围

用户要求按建议继续实施，并确认使用本地切片新建测试项目；效果复盘延期，等待真实观察数据。后续确认暂缺制作／来源／目标账号资料，允许按大概情况编写。因此本轮文案仅作为明确标注的内部测试草案，不能转成真实来源证明、已确认语言或公开发布许可。

新项目通过实际 Web 创建：`55fa34ae-71e8-4079-b870-985c88635382`，名称 `获准原文件字节验收-1791208369573`。采用 `/Users/linghuxj/Downloads/切片/将门逆子/将门逆子-8.13-chh (2).mp4`。草案标题“将门逆子｜剧情片段测试”；描述“短剧切片测试内容，仅供内部流程验证。制作方、语言、集序和来源资料待补充，暂不公开发布。”语言、集序、制作方、目标发布身份、来源证明均保留未知。不生成已登记证明 UUID 来绕过准入。

## 工程接线

- 项目任务执行与复核视图读取当前计划、任务、准确素材修订和文件清单、逻辑预约、真实执行 operation、提交状态及可信结果；区分服务接口未连接与业务条件未就绪。
- 逻辑 `pending_current_checks` 不代表设备已开始。未知提交保留原操作，优先核验原结果，不创建第二次提交。
- 只有已持久绑定的 task-attempt 与 assistance-todo 显示关联；不能以同一手机或全局待办推断项目归属。
- 人工“已处理”仅产生系统复核请求。消费者持久领取原请求后，只有真实可信复核端口可给出恢复结论；缺少端口写入 unknown，不恢复手机参与、不释放未知操作、不派发动作。
- 上传记录独立于素材资料保存。资料不完整或刷新页面后，仍可通过真实 Web 读取原上传票据、字节摘要及本地校验时间，并沿用该文件继续填写资料，不重复上传；不代填来源、语言与首次使用确认。字节校验不授予候选或发布资格。
- 统一启动入口可读取明确安装的私有 `material-storage.json`，验证权限、属主和配置后传入实际服务；缺失保持不可用，存在但非法则失败。不发现外部桶、不回退环境中的 AWS 凭据。
- 修复任务台账大 JSON 管道读写时持锁等待 stdin/stdout 的死锁；输入验证和输出离开持锁区，CAS 比较与原子写仍在原锁下。隔离临时仓库验证大管道及并发 CAS，不改写真实共享台账来模拟成功。

## 环境与证据边界

项目 Node `v24.16.0`、pnpm `8.14.0`，`pnpm env:check` SQLite 通过。原后端 `127.0.0.1:4320` 保留。自有 Web `3100`、独立候选后端 `44320` 与本地私有对象存储 `45900` 用于本轮验证，凭据与完整服务日志留 `.runtime` 私有目录，不写入交付材料。

首次真实上传失败：原后端未配置素材存储，准备票据 POST 503，读核确认该项目上传票据为 0。保留 `output/playwright/closed-loop-20261005/original-upload/` 失败证据。配置自有对象存储后再验证，不能覆盖该首失败或宣称其成功。

USB Android `RFCW40MYYCV` 实测为 `device`；仅检查目标及当前前台元数据，没有用固定点击脚本代替 Artemis、输入平台凭据或公开发布。连接存在不证明正式网络准入、可信停止、holder 或所有执行路径封闭。

## 尚未完成的真正执行闭环

正式 Artemis 业务任务入口与受控动作接口、全部观察／驱动路径隔离、当前网络／停止／holder 可信事实消费仍未全部接通；只读 SDK context 不是业务 dispatcher。受控登录还缺工具注入、观察隔离与可信 CLEAR 回执，见 `r159-artemis-controlled-login-blocker-20261005.md`。因此执行器／可信发布核验端口保持未连接，不把接口、迁移、单元测试或原文件上传通过称作真实发布闭环通过。

真实来源与目标账号尚缺，用户允许编写测试草案不构成真实来源和外部账号身份。数据复盘按用户确认延期。

## 人工参与边界

按当前需求基线 R-121、R-158、R-159，正常日常任务在已批准范围内不逐条人工审批。本轮不添加额外审批流。需要人工提供或处理的是：真实素材业务／来源事实与权利依据；首次项目目标及方向范围、账号和手机分配；验证码、双重验证、账号限制或身份不符；超窗、授权变化、换机及自动恢复超过既定限额等异常。未知发布首先核对原提交，不要求人工通过重发来“解决”。

当前仍存在的执行库与可信核验接线属于工程工作，不能包装成人工日常操作来宣称 AI 自动闭环已完成。尚未安装可信 scope producer，因此定时排期自动创建 attempt 与真正派发未上线；新增 provenance 字段及内部 store/consumer 不代表自动运行已生效。人工处理后的原任务接续接口可持久消费请求，但真实 trusted recovery port 未安装，不能宣称复核已恢复。

## 非核心后续项：仅记录，暂不开发

按用户 2026-10-05 最新确认，本轮只收尾现有核心接线与实际操作验证。以下事项待出现明确使用需要时再处理，不新增框架、接口或迁移：

| 后续事项 | 重新考虑的条件 |
| --- | --- |
| 来源／业务目录选择、上传文件与成品组的批量复用 | 真实来源资料已齐备，逐项录入成为实际瓶颈 |
| 更多筛选、统计图表、批量运营工具及界面美化 | 当前操作流程通过，并有明确运营反馈 |
| 新提醒渠道、统一调度框架及更多执行适配器 | 现有核心执行接通，并出现实际新渠道或多执行器需求 |
| 效果复盘及优化扩展 | 到达真实观察窗口，存在可用效果数据；沿用用户延期决定 |

真实 Artemis 执行与可信结果核验仍是核心未完成项，按上文记录具体接线阻断，不能归入非核心或用人工代操作宣称完成。

## 验证结果

真实原件上传：`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=real-material-bytes pnpm test:playwright` 沿用已创建项目，在本轮独立后端与私有对象存储完成 prepare 201、实际 PUT 200、重新 GET 200。原件 41,927,996 字节；SHA-256 `6564ad3fd4573e103b66e32ace7455dac41ee8ca4f00c640f129a4a97db347ac`，object `443193fb-5c6f-4346-bac2-6e03edc2842d`。刷新后同一文件标识与摘要仍在。0 次素材声明保存，未制造来源资格。

证据：`output/playwright/closed-loop-20261005/original-upload-retry/result.json` 和 `persisted-upload-receipts.png`；内部假设草案 `output/playwright/closed-loop-20261005/test-brief.json`。这些是实际本地证据，未上传到外部平台。

初轮后端全量补充测试为 422/423：已有凭据保管测试请求缺少必填 `loginIdentifier`，在输入校验处终止，未覆盖它本意测试的认证先行。补齐 synthetic fixture 的必填字段，保留拒绝认证和不触碰密钥的断言；未改生产凭据逻辑。修正后相关凭据测试 11/11 通过；本次最终针对恢复消费、协助说明与凭据保管的补充检查共 15/15 通过，未将它改报为全量 423/423 通过。

### 本次核心收尾的实际结果

- 已通过：`pnpm env:check`、contracts build/generate-check、后端与 Web 类型检查。此前 Web 补充测试 89/89、构建通过；构建的 bundle 体积提醒及既有 lint 提醒未作为本轮扩展任务。
- 已通过：`pnpm --filter @socialgrowth/product-backend exec tsx --test src/device-assistance-recheck-consumer.test.ts src/device-assistance-notes-service.test.ts src/media-credential-key-custodian.test.ts`，15/15。日志位于 `output/playwright/closed-loop-20261005/checks/backend-focused.log`。
- 已通过：已有工作流与恢复修复分别由作者在隔离 PostgreSQL 17.11 验证 4/4、2/2；复用原证据，不重建运行库来模拟任务。源码审查精确候选为 core `ad544435a6b79dae53db65d54aa791bd674f4d83`、recovery `89af8b300fb5aa2183c7b520142b2d5f1348bc3b`，发现均已关闭。审查报告分别在独立审查分支提交 `78ee341`、`c46aa63`，不等于真实手机执行验收。
- 已通过：备份既有本地运行库后，`pnpm exec tsx scripts/product-local-live.mts prepare` 应用已有 0041、0042 迁移；无业务种子或数据库重置。读核 tasks、attempts、workflow jobs、recheck links 均为 0。
- 已通过：`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=closed-loop SG_PRODUCT_CLOSED_LOOP_PROJECT_NAME='获准原文件字节验收-1791208369573' pnpm test:playwright`。实际 Web 登录、打开新项目与页面操作，6 项断言通过，业务写请求为 0。覆盖真实状态、GET 中断保留历史标识及重试、任务页导航、刷新后上传票据、沿用原 object 填写内部草稿、980/700/390px 只读与无整页横向溢出。GET 故障通过中断请求验证，未 Mock 业务结果。截图已人工查看。

页面证据：`output/playwright/closed-loop-20261005/workbench/result.json`、`workflow-current.png`、`continue-original-test-draft.png`、`workflow-390.png`。源码从实际 Web 发起，无直接业务 API 写入或预置成功状态。

未验证／阻断：运行库没有真实排期任务及关联复核请求，因此非空任务列表、人工处理→可信复核→原任务真机接续仍未完成真实 Web／手机验收。执行器与可信核验接口当前为空，页面明确显示未连接；未进行模型调用、手机业务动作、公开发布或效果复盘。

本次没有新增非核心功能、通用调度或执行适配器。用户允许按大概情况编写的内容保留为明确标注的测试草稿，未转为正式来源、身份或授权。

本轮自有 Web 3100、候选后端 44320 和对象存储容器均已关闭；原后端 4320（PID 2285）与既有 PostgreSQL 保留。已上传文件、数据库备份和私有存储配置保留。

## 2026-10-06：核心接线前的真实素材、资源及计划验证

限定当前本地切片、新测试项目与既有 Facebook 账号、手机、Page；用户允许按大概情况编写测试目标。本轮测试范围明确不公开发布，来源与集序保持未知，效果复盘延期。

- 实际切片分析：从本项目已校验原件读取字节，ffprobe 获取时长/尺寸，ffmpeg 均匀抽取 6 帧，沿用 Artemis 现有模型配置生成语言、剧情摘要、标题和配文草稿。UI 明示未分析音频、抽样不覆盖完整剧情；点击应用与保存是分别的操作。真实请求发现模型 JSON 围栏、语言大小写问题，已最小兼容，仍做严格字段校验。
- 已通过真实 Web：原 object `443193fb-5c6f-4346-bac2-6e03edc2842d` 提取、应用、保存（来源 NULL、首次发布 unknown）；账号 `7587ac3f-9a9d-4e16-b8aa-ddb57c075d8b`、手机 `0fef3177-636c-4b82-8209-1af38134e00f`、Page identity `3bde76d2-76b4-42df-9b26-d7ed73a1ac09` 移用到项目 `55fa34ae-71e8-4079-b870-985c88635382`。没有另建账号，移用只适用于未派发的筹备资源，在途和未知操作保留阻断。
- 发现并修复实际数据库冲突：历史效果记录不能引用唯一的当前资源占用；0047 将其保留为不可变账号/身份/原项目实体关系。旧项目的 3 条 history 和 6 个 report heads 原归属保留，写入依然校验当前精确绑定。
- 真实模型方向与范围确认、素材按范围核对以及排期通过 Web 完成，产生 task `7b049382-749e-4f05-961d-616997b5e40a`，准备候选 material rev2。测试假设 US/zh-hans、1 日窗口、每日上界 1；规则明确只检查准备，不点击最终发布。排期不等于执行。
- UI：来源、证明及关联编号收起为选填；桌面与 390px 截图已检查，窄屏只读且无整页横向溢出。刷新后仍可读取保存素材和原账号占用。机械 UI 检查未报问题。
- 补充检查：隔离目录后端构建、contracts 构建及生成检查、Web 类型检查通过；素材/上传/指标核心测试 17/17。独立源码复审 base `96242bb` / head `3920696` 通过，范围仅本轮素材和资源改动，不覆盖尚未集成执行桥。

可复现命令：`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=core-materials ... pnpm test:playwright`（项目/原件参数见脚本）；`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=core-preparation ... pnpm test:playwright`。环境为项目 Node 24.16.0、Web 3100 / 隔离后端 44320，复用原本地 PostgreSQL 和对象存储。证据保存在 `output/playwright/core-materials-20261006/`（首失败和后续验证均保留）及 `output/playwright/core-preparation-20261006/`。

执行桥、当前 Page 真实核验及原操作恢复仍在本轮实现中；上述结果不能冒充手机执行或公开发布已完成。原 Artemis 创建 Page 和 Page 发帖既有证据继续有效，详见 `artifacts/acceptance/product/page-preparation/06-item1-page-audit-report.json` 与 `artifacts/acceptance/product/ai-strategy/03-page-publish-report.json`；本轮未读取其他 Chat。

非核心项仅记录：全量音频/对白分析；来源资料后补的编辑方式；进一步压缩重复的资格/状态说明；推广与效果数据来源接入。当前不开发这些扩展。

### 同步运营界面检查（2026-10-06）

本轮按用户确认，页面改动同时检查运营人员是否能理解状态与下一步操作。真实 Playwright 进入现有项目的排期与任务页，桌面和 390px 验证通过（`SG_PRODUCT_WEB_SCOPE=core-execution`，未开启手机动作）。任务/原尝试编号收在详情中；窄屏隐藏启动动作并保持只读，无整页横向溢出。页面明确准备检查会操作手机并停在最终发布前。截图：`output/playwright/core-execution-20261006/ui-retry/`。

发现并收敛处理：准备按钮与“执行许可关闭”、正式发布阻断提示混杂，必须区分准备检查和公开发布条件。只修当前流程的文案与状态，不重做布局。首个执行桥候选 `f12e334` 独立审查为 changes_requested：精确 Page 身份绑定、媒体推送前复核、与旧执行会话分流三项；在修正前未启用该桥进行手机业务执行。

已有 Runtime 的旧排期 `schedule-60c3e7f1-443c-4f56-81ab-805bb1c6a5f6` 通过原 Web 取消。请求后服务短暂不可用，首次最终提示断言未完成，保留失败证据；服务恢复后实际 Web 显示原 task `f985bf20-260d-414a-a2dd-cd49f0ac43b9` 为 cancelled、排期“已取消”，只读状态补充核对一致。历史 unknown `d634e4c6-4266-4cc7-a784-3a31a1737cac` 保留，未重发、未删除。

### 原操作核对与核心执行配置（2026-10-06，继续验证中）

执行桥候选 base `96242bb4238a28ae74517ae358f54b1c89321f7c` / head `5a5c4c971ad3107b25a9629a4ad6d9ac2f337284` 已通过独立源码复审，根分支集成提交 `12e9080`。仅支持已分配 Facebook 视频的本地 USB 发布准备：先核对原登录身份及唯一管理 Page，取得确切 Page ID/URL，再核对同一切片并停在最终发布前。原尝试与操作关联、证据归属、共享设备占用及逐动作复核均保留；源码通过尚不表示本次手机流程通过。

标准产品启动入口读取现有私有 Runtime 与绑定配置，包含分别的产品账号和原 Runtime 账号编号。Runtime 启动配置也保存相同绑定及回写地址，沿用 Artemis 安装和模型配置。凭据不进入交付记录。独立候选验证使用 Web 3100 / 后端 44320；原 4320 服务保留，不宣称其旧进程已加载新配置。

原 task `d634e4c6-4266-4cc7-a784-3a31a1737cac` 经真实旧 Web 3000 核对为 `confirmed_not_published`，只提交一次。证据为同任务原 trace `c41af179-58fd-4628-a227-20e777f6db70` 的实际最终 PNG、`notes/final_report.md` 与最终检查 ledger；原结果传输正文为空及历史失败继续保留。截图和报告支持停在发布前、未点击最终发布，不支持“平台拒绝”，也不能代替新 Page 核验。修正文案为“已核验本次未发布且没有在途操作”。证据 `output/playwright/core-execution-20261006/original-review/`；首次表单未打开的定位超时未发生写入，随后真实表单提交通过。

原内容暂停解除后，设备/账号/项目暂停仍因 6 条旧身份接入未知记录保留。5 条原 Artemis trace 已为 cancelled/failed；另 1 条缺原 trace 终态，但存在精确关联的原监督停止、安装失败和会话关闭记录。不能把这些记录标成身份或安装成功。现有“处理后重新核验”提示缺少历史核验结束入口，是本轮必须补齐的恢复问题；仅结束已停止的非创建核验，保留原原因和证据，之后由已有暂停核对规则重新审查，不直接抹除暂停。

当前页面验证：`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=core-execution SG_PRODUCT_CORE_PROJECT_NAME='获准原文件字节验收-1791208369573' SG_PRODUCT_CORE_OUTPUT=output/playwright/core-execution-20261006/ui-current pnpm test:playwright`，桌面/390px 两项通过，0 次启动与原尝试创建。明确显示“尚未检查”、准备检查会操作手机、公开发布未开启；正式发布条件与准备结果分开。当前没有开启公开发布或效果复盘。

### 核心恢复入口与首次真实派发（2026-10-06）

最小恢复候选 base `5a5c4c9` / head `44e932e` 源码复审通过，根分支集成至 `2cf3da2`。没有保留额外归档文件读取路径，直接复用 `mobile_manage_task(action=status)`；原工具诊断曾误用不存在的接口，已更正，不能把该诊断失败说成引擎无法读取旧任务。五条旧核验的精确 trace/serial 终态通过原接口确认；第六条终态未返回，依据原同 job/session/serial 监督停止及会话关闭记录撤销后续核验，仍保留原 unknown 和安装失败，不标成功、不改绑定。

实际 Web 恢复：`SG_WEB_TARGET=demo SG_DEMO_WEB_SCOPE=core-recovery SG_RUNTIME_CORE_PROJECT_ID=project-1bdd610a-8505-489e-b7cd-dacc3925405f SG_RUNTIME_CORE_ACCOUNT_ID=account-4ee9e05f-77cd-44a3-8f7c-0f6b451ab145 pnpm test:playwright`。首轮从页面结束六条旧核验；其后复核入口定位失败，未提交暂停复核。通过现有任务中心入口与任务选择继续同一流程，0 次重复结束、1 次原任务复核，最终两项断言通过。只读 Runtime 状态确认 pauses/holds/在途任务/协助为空；绑定 ID 与原账号保留。失败定位证据与后续结果均在 `output/playwright/core-execution-20261006/identity-recovery/`。

新流程真实请求暴露并修复 SQL 42702：任务表与预留表通过 ON 关联后，发布身份再用 USING 会因左侧 identity_id 重复而失败。只将该关联改成三字段显式 ON。同时把原记录 queued 文案改为“等待检查”，恢复启动原尝试按钮；claim/operation 防重与 unknown 只查询约束不变。候选 base `b603fc8` / head `cf8ce44` 独立源码复审通过，后端构建与 Web 类型检查通过。首个原尝试 `52296ff8-e64a-47bf-b4b9-6e4e48cc218b` 保留，SQL 失败尚未派发手机，未另建尝试。

根目录标准 `SG_PRODUCT_BACKEND_PORT=44320 pnpm dev` 已实际启动新候选；原 4320 服务保留。标准 `pnpm runtime:start` 沿用私有执行配置，测试只覆盖回写端口为 44320。经真实新 Web 再发起一次，POST 201，随后故意中断浏览器响应；页面查询原操作，原 workflow 已 running，operation `0ef94113-c6de-4171-b873-fd0c2bf62b53` / Artemis audit trace `ff006725-3a68-470c-80b3-3b914d901505`。当前仍在核验 Page，尚无最终准备回执，不能宣称执行完成或发布成功。证据在 `output/playwright/core-execution-20261006/live-after-query-fix/`。

### 原核验超时与运营反馈收尾（2026-10-06）

本节更新上文“正在核验”的最终事实：原 operation `0ef94113-c6de-4171-b873-fd0c2bf62b53` 的身份 audit trace `ff006725-3a68-470c-80b3-3b914d901505` 运行到 15 分钟限时，失败原因 `EXECUTION_TIMEOUT`。原 Artemis 查询确认同 USB `RFCW40MYYCV` 的 trace 已 cancelled，设备执行锁无 owner；最终真实 PNG 显示已进入“Tongm Mhuo 短剧精选”Page。Artemis 原备注记载管理入口可见，但个人身份及 Page 详情加载超时，精确 Page ID／网址未确认。模型请求返回 200，不属于模型凭据缺失。备注及截图不能替代完整身份核验，因此发布准备验收仍失败，未进行新公开发布。原结果和设备占用继续保留为 unknown，未重发。

实际失败暴露并修复两处核心问题：bridge 在 audit 非成功时丢弃了失败回执，现保留原失败回执、trace 与证据引用；结果写回 SQL 的 `$6` 同时被推断为 text 和 timestamptz，现显式使用 timestamptz。对本次已经丢失回执的原操作，只读校验同 operation 的证据摘要、trace、attempt、task 与 serial 后提供安全超时诊断，不补造成功回执，不释放未知占用。旧记录缺少持久阶段字段时，诊断阶段保持 unknown，不用当前身份映射倒推历史。

运营界面沿用已有任务页与状态：失败原因和下一步就近可见；未知时只显示“查询原核查状态”，查询中显示“正在查询原检查”，不会误称启动手机。任务编号继续收起，正式发布条件与准备结果分别说明，390px 保持只读。重复的 Facebook 标签、复核详情中的长编号及进一步合并说明仅记入后续改善，不在本轮扩展布局或功能。

- 已通过：自有临时隔离 PostgreSQL 的工作流补充测试 5/5。覆盖原操作查询只写入诊断、仍 unknown、0 次派发、无新 claim、不因重复查询增长事件，以及同 verificationEventId 改摘要必须 EVENT_CONFLICT；测试数据库已删除，未重置业务库。fixture 应用已有 0046 迁移，没有新增迁移。
- 已通过：根后端构建、Web 类型检查、标准启动的 Node 24.16.0／SQLite、contracts 构建和生成校验。bridge 作者 Runtime 类型构建通过。
- 已通过：生产失败反馈源码候选 base `f13479cfa4d2520d15c04cbbde869e8bbbde81ce` / head `defd8d2afc9c93aacb6adfcb2771597b378de2d9` 独立复审；bridge base `44e932efae8502205fafdc06c27791a8542626e3` / head `c76f4f76ac65e4a209d2381768ccb9ceeca7372d` 独立复审。分别关闭事件摘要冲突检查及历史阶段推断问题。根集成至 `67c62e5`，后续仅修查询忙碌文案和测试的刷新导航，提交 `2c4b57c`。
- 已通过真实 Web：`SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=core-execution SG_PRODUCT_CORE_PROJECT_NAME='获准原文件字节验收-1791208369573' SG_PRODUCT_CORE_OUTPUT=output/playwright/core-execution-20261006/original-timeout-feedback-final SG_PRODUCT_CORE_EXPECT_UNKNOWN=1 pnpm test:playwright`。3 项断言通过；从真实页面查询原操作、刷新后重新打开同项目，超时提示仍在；桌面/390px 已查看截图，0 次新尝试、0 次启动 POST、没有整页横向溢出。测试没有直接业务 API 写入、数据库预置或 Mock 结果。
- 失败保留：`live-after-query-fix/` 的真实准备等待失败；`original-timeout-startup-failure/` 在 Web 尚未监听时失败；`original-timeout-locator-failure/` 查询成功后，脚本错误假设刷新保留打开项目而定位失败。修正脚本按真实入口重新打开同项目。首次通过截图发现查询忙碌文案不准确，修正后的最终结果在 `original-timeout-feedback-final/`，不覆盖此前失败记录。

**未完成／阻断：** 本次 Page 精确身份核验未通过，因此后续切片准备及其可信 prepared 回写未获得实际业务通过；原 unknown 的可信最终恢复也未通过，不以工程接线或旧任务恢复代替。下一步是恢复既有 Facebook 身份详情的可读条件并核对原操作，仍沿用现有账号和 Page，不需要另找账号；尚未出现新验证码、密码或其他人工协助请求。效果观察继续按用户决定延期。没有新增恢复框架或非核心功能。

本轮自有产品 Web 3100／后端 44320、Runtime 4318、旧 Web 3000 与对象存储测试容器已关闭；原 4320（PID 19852）、PostgreSQL、原件、原未知操作／设备占用及全部证据保留。独立验证 worktree 的输出已合并保留，移除本轮自有 Artemis 链接后请求归档；没有删除原 Artemis 安装。当前结论是“核心配置已连接、失败反馈可用，真实发布准备仍阻断”，不是完整 AI 业务闭环通过。

### Facebook Page ID 真机提取确认与执行库标准化（2026-10-06 补充）

- **真机实测提取事实**：通过真机（`RFCW40MYYCV`）实测排查，在 Facebook App 的 Page 主页管理界面（“粉絲專頁設定”），通过“分享”（Share）菜单下的“分享粉絲專頁”->“複製連結”（或“粉絲專頁連結”），成功复制出完整主页链接。通过中转验证无障碍 UI Dump 确切提取出完整 URL：`https://www.facebook.com/profile.php?id=61595032504951&mibextid=ZbWKwL`。
- **精确 Page 身份核验**：
  - 稳定数字 Page ID：`61595032504951`；
  - 规范 HTTPS URL：`https://www.facebook.com/profile.php?id=61595032504951`（清洗掉追踪参数）；
  - 对应绑定的父账号（个人 Profile）ID 为 `61550800776808`（`https://www.facebook.com/profile.php?id=61550800776808`）；
  - 确认为不同的实体身份（`61595032504951 !== 61550800776808`），满足执行桥及审计门禁对 New Pages Experience 架构的强校验规则。
- **执行库标准化沉淀**：
  - 修改 `services/execution-runtime/src/device-executor.ts`，在 `identityAuditOnly` 任务提示词中显式补齐“进入 Page profile，打开 Page settings (...) -> Share -> Copy Link to Page 提取规范 HTTPS URL 及纯数字 ID”的标准化操作路径，消除此前通用视觉 Agent 在空白流中反复寻找文本 ID 导致的 15 分钟探索超时；
  - 在 `device-executor.ts` 中增加规范化清洗逻辑，自动剥离 Facebook 客户端分享链接携带的 `mibextid` 等统计追踪参数，确保写入 `business_plan_page_identity_mappings` 与断言比对时使用规范纯净的 HTTPS URL；
  - 运行时构建检查 `tsc --noEmit`、contracts 构建检查通过。

