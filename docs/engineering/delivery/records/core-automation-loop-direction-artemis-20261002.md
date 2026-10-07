# 接手推进：真实模型方向、持久确认与 Artemis 协作

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

日期：2026-10-02。沿用 `codex/core-automation-loop-stage1`，基线 `c01b64758729fabe33f9eeba52cef45094f21812`。固定代码候选为 `fd9e0dd3c9aa8e0ec9500cfc03578164ef62d48e`；manifest 指纹对应该提交，后续资源收尾文档另留痕；源字节、脚本与证据见 [manifest](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/candidate-manifest.json)。这是作者检查点，未代替原非作者复核或独立 QA，未合入 Developer，父 pending 保留。

用户已确认：Demo 切片及已登记 FB/YouTube 账号可使用；优先停在最终提交前，必要时允许一次测试发布。本批实际公开发布次数为 **0**。用户随后明确确认两份原件此前从未公开发布；这是用户首次使用声明，仍不等于系统核验、Page/频道身份、分成资格或当前物理许可。

## 完成的增量

| 范围 | 实际行为与边界 |
| --- | --- |
| C2 初始方向 | 正式 Web 完整目标/周期 → 明确每个身份的开通前/后声明 → 调用真实配置模型 → 核对明确范围 → “确认方向”。无该阶段身份时不要求无关阶段目标；声明不冒充实际资格。 |
| 不可变确认 | 保存模型方向、完整范围、自主推进/重新确认边界、确认人、时间及原项目/草案版本。事实改变拒绝确认旧方向；确认、项目版本与审计原子提交。没有额外启动或逐条批准步骤；当前缺少就绪条件，仍不派手机任务。 |
| 请求恢复 | 模型网络调用在数据库锁外；调用前持久占位，同键同载荷不重复请求，同键异载荷拒绝。会话撤销、过期结果及期间事实变化拒绝；GET 仅投影过期，不修改事实。确认已提交但响应丢失后，读回并沿原请求恢复同一批准。 |
| 真实模型配置 | 复用用户指出的既有 `integrations/google-artemis/.env` 与 `.venv`，经现有 `ModelFactory` 实际调用。观察配置为兼容 `openai` 通路、`gemini-3.8-flash` 名称；这不是官方 Google 端点/版本证明。默认未配置时关闭，不用模板/fake/fallback。模型适配不具备手机工具。 |
| 敏感边界 | 不写出配置 URL、密钥、原始提供方错误/日志。工作区 dotenv 加载后重新禁用 LangChain/LangSmith tracing，防止覆盖继承的关闭设置；不修改用户 `.env`。`responseId` 只是本地关联编号。 |
| C3 journal | 0025 与内部 PG port 持久保存提交前 intent、唯一 trace、unknown observation。并发仅一次 claim；提交确认丢失/重建不重新 launch；冲突 trace、伪造绑定、损坏记录拒绝。观察永远不提升为已核验发布。尚无中央 Task FK/消费者，journal 不是许可。 |
| 当前 Demo 协作 | 真实 Web 接管 → 发起只读任务 → Artemis 观察/提出澄清 → 在同一任务 Web 表单回复 → Artemis 再观察 → 最终回执。没有固定手机动作脚本、后台接口写业务或模拟业务结果。临时接管已交还。 |

## 已执行验证

环境：pnpm8.14.0 / 项目管理 Node24.16.0，`env-check.log` 记录实际路径与 SQLite。正式产品运行于自有隔离 PG17.11/固定本地 MinIO、Vite3100/backend4320；25 迁移、新合成运营与临时凭据。登录后项目、草案与确认均由实际页面操作；operator 初始化沿用正式 CLI。镜像、端口与清理见每次环境记录，不使用 Demo 库作为产品库。

| 验证 | 结果和证据 |
| --- | --- |
| 正式方向真实页面与真实模型 | [ui-scoped-final](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/ui-scoped-final/direction/result.json)：两个实际模型请求；第二窗口改变目标后旧确认拒绝；重新生成/确认；真实确认 POST 已落库后仅中断浏览器响应，读回/原键恢复；重载保存同一人/时间/范围，390px 只读无溢出。数据库仅1项目、2方向、1批准，没有手机任务/发布。 |
| 最终真实模型回归 | `ui-telemetry-final/` 两次约16.5/12.5秒严格schema失败保留。收紧三字段输出提示并增加固定字段的安全形状诊断后，`ui-originals-browser-read-final/` 两次真实模型生成16.953/14.992秒通过，同样覆盖旧方向拒绝/不可变确认/丢响应恢复/重载/390px；2项目、2方向、1批准、2实际文件票据、0素材声明。 |
| 获准真实原件 | `ui-originals-human-declaration-final/` 两份原件从真实Web选择/上传，页面字节校验反馈通过；同一浏览器只读原票据的SHA/字节与本地逐字节摘要一致。按最新用户声明填写来源说明及首次使用勾选，但缺少真实业务/来源/证明引用仍阻止保存；0声明POST、0素材版本、2verified票据。重载没有捏造素材条目。上传通道共享有界64MiB，存储可更严格；未改全局配置。 |
| 真 PG 补充 | [sql-readonly-final](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/sql-readonly-final/direction-postgres.log) 17/17：11方向事务/并发/会话/过期/回滚/阶段范围与6 journal 并发/ACK丢失/重建/伪造/损坏。fixture 模型不是实际模型或手机证据。 |
| C1/C2a 当前候选回归 | `ui-candidate-baseline-final/` 通过真实页面素材与规划流程；2项目、2素材版本、1未批准草案、0方向。素材输入仍为明确合成，不能据此证明合法来源/首次未发布。 |
| 工程补充 | `product-test-candidate.log` 543/543（66 TS契约、38 Python、339 BE、14 EX、86 Web）；check/lint/build 通过，2旧 BE warning 保留。GET 只读修改后另跑 BE check/build 与339/339，真实 PG/页面覆盖最新行为。 |
| 模型边界补充 | `model-boundary-final.log` 6/6：dotenv tracing覆盖后关闭、describe无请求、fake拒绝、phone操作拒绝、错误正文/库输出保护、超时无fallback。仅内部 stub 边界测试。 |
| Demo 页面 | [readiness](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/demo-readiness/browser-readiness.json)：5入口及390px通过。只证明页面/服务连接。 |
| 当前真机协作 | [回执](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/demo-observation-r4/result.json)：任务 `cab0a2ad-243e-4444-b4dd-8d61aa90be65`，Artemis trace `320f0f7a-dffc-4b4e-bb72-73168a22ca02`；OBSERVATION_COMPLETED、登录提交0、finalSubmitClicked=false。原请求 verified，真实事件含 operator_responded → revalidated → result_reported。这是 Codex 操作者在 Web 提交观察反馈的协作验证，不是独立人员验收。 |

作者已查看本轮正式方向桌面/手机及两份原件上传截图。真机截图显示 Facebook 首页资讯流，没有完整姓名/ID，反馈如实说明不能判定指定身份通过。私有手机原图、Demo 全页文本/截图及历史带签名 URL 不进候选提交；可审查的本次单任务 Web 回执保留。

### 失败与可靠性边界

- 模型曾多次真实超时。最初外层30秒不足以覆盖 Python import 加网络25秒；调整为子进程40秒/网络30秒、服务45秒/持久结果60秒，并限制输出后通过。`ui-recovery` 仍保留两次约37秒真实超时，不能宣称模型稳定性或 SLA 已通过。页面只在明确不可用、读回后允许一次新的显式生成；未知结果不自动重试。
- `sql-final` 15PASS/1FAIL：新范围 refine 原来映射 INTERNAL_ERROR，修正为 INPUT_INVALID；最终17通过。首次构建/检查因契约未重建失败，明确先构建契约后通过，不改全局 Node 或安装新依赖。
- Demo observation 首3轮脚本在启动任务前因入口位置、异步状态及 region 定位不正确失败，保留目录；第4轮经实际 `connections` 表单及 `receipts` 人工反馈通过。没有把页面能打开当协作通过。
- 原件上传首轮暴露底层 operator 字节封装仍限制16MiB，已改为同一共享64MiB常量。随后两轮仅补充证据读取因Chromium大请求Inspector缓存及APIRequest对本地Secure Cookie行为失败；真实PUT200及页面反馈保留，改由同一浏览器只读原票据，没有再发字节或模拟成功。最终两份原件及最新首次使用声明页面检查均通过。脚本从根目录引用contracts包首报模块解析错误，改为明确构建后的相对入口后严格TS通过。
- 最新脚本严格 TS 首报 href 可空，修正为明确字符串断言；最终脚本类型/lint另有日志。后来增强 finally 记录清理结果，未为这一脚本清理改动重复消耗手机任务。

## 真实资源核对与未完成内容

当前 `.runtime/runtime.sqlite`：3账号但仅1个真实 FB 设备绑定（RFCW40MYYCV、个人 Profile61550800776808，有效至2026-10-20）；没有 YouTube 账号/频道绑定。这个 Profile 不等于产品要求的 Facebook Page，名称相同不证明 Page 管理权。已向用户询问之前已连接的 YouTube/另有 Page 的记录位置，未要求再授权或提供凭据。

下载目录 `/Users/linghuxj/Downloads/切片` 有112份MP4、112个不同指纹。两份与Demo现有23个别名slice记录一致：`将门逆子-8.13-chh (2).mp4`（41,927,996字节，SHA256 `6564ad3fd4573e103b66e32ace7455dac41ee8ca4f00c640f129a4a97db347ac`）与 `将门逆子-pxy-8.15-二创 (7).mp4`（17,066,476字节，`2b426251ca5b1547612fd80309bcd3f449bdd17aa0319004b54020ef4eaf2168`）。用户已明确声明两份均从未公开发布。目录未找到相邻制作来源文档，文件名不推定制作主体、集序、语言或业务关系；私人完整盘点留本地，不将112份一并视为已授权/已准入。

28内容记录、实际文件指纹及历史多次未提交回执可复用。但原任务 `d634e4c6-4266-4cc7-a784-3a31a1737cac` 保留 unknown 和4关联暂停；原 ledger 已确认接收回执。对应 trace 已 completed，结果正文为空；笔记含成功/未提交陈述，但完整结构化结果缺失，不能仅凭笔记改成成功或平台明确拒绝。当前只读协作没有解除该暂停、重跑原任务或消耗旧批准。

仍未完成：

1. C2b 真实制作主体/业务关系及来源记录引用、重复历史核对和候选准入 producer。两份原件的使用授权、位置与用户首次未发布声明已获得，实际上传已验；未把声明当系统核验、文件位置当制作证明，或捏造业务/来源UUID。
2. C2c/d 持续业务 AI 的权威事实 producer、计划/Task/名额/outbox 原子生效、当前复制事实校验。此次真实模型接入的是初始方向；原 BusinessModelCoordinator 仍是内部协调器，pending recheck 仍不是可执行 Task。
3. C3 中央 Task 消费、实时现行归属/网络/控制/身份和每次实际动作的物理 fence、实际文件准备及独立平台回执。新的 journal 可供接线；现 Demo 有限 guard 不能冒充正式产品所有动作均受保护。
4. C4 核心任务未知结果核实、暂停/更正/撤回/人工后恢复全链路。方向未知恢复和本次真机人工协作已验，不扩大为发布未知恢复通过。
5. 原非作者/QA固定候选复验、WP-10原13补验与 Developer 父 pending。作者不清零原 finding 或自签门禁。真实短信、第二手机及部署/备份/回滚按此前确认延期/后置。

## 复现与接续

先确认临时服务授权、实际 Web 访问准入、端口与在途，明确构建契约与 backend。每次使用新的自有输出目录：

```sh
pnpm env:check
pnpm --filter @socialgrowth/product-contracts build
pnpm --filter @socialgrowth/product-backend build
SG_PRODUCT_CORE_BROWSER_ADMITTED=1 SG_PRODUCT_CORE_SCOPES=direction \
SG_PRODUCT_CORE_ARTEMIS_ROOT=<既有获准Artemis绝对目录> \
SG_PRODUCT_CORE_OUTPUT=<新输出目录> pnpm exec node scripts/verify-product-core-loop-local.mjs
```

只跑17项 PG 补充可设置 `SG_PRODUCT_CORE_SQL_ONLY=1 SG_PRODUCT_CORE_SCOPES=direction`；这不请求模型、不启动手机、不能当 Web 验收。正常 runner 内部通过根 `pnpm test:playwright`。

Demo 复现使用现有配置与已启动的 `pnpm dev`；检查原未知任务/占用，**不启动 worker**。本次只读任务命令：

该历史操作命令已失效并从说明中移除。原候选和结果保留；现行入口见[当前实现](../../../current-implementation.md)。

脚本在真实 Artemis 澄清出现后保存本任务私有截图与 waiting.json。操作者核对原图后，在同目录写入含精确 taskId/requestId/text 的 operator-feedback.json；脚本从真实 Web 表单提交，仅该原任务收取回复。不得填写凭据、虚构已处理/已核验，原脚本 finally 通过 Web 停止仍在运行的本次任务并只交还本人新增的接管。真实资源仍不足时明确记录阻断，不用合成许可补齐。

四态：通过＝上述限定真实页面/真实模型/真机协作与工程检查；失败＝保留首红、真实提供方超时，最终断言见每次目录；阻断＝当前实际 Page/频道、真实业务/来源引用及旧未知结果；未完成/未验证＝上列 C2d/C3/C4生产链和独立验收。此记录不宣称整个接手目标全部完成。

获准原件复现（只读票据补充不代替页面操作；首次使用标志必须有对应成品的真实用户声明）：

```sh
SG_PRODUCT_CORE_BROWSER_ADMITTED=1 SG_PRODUCT_CORE_SCOPES=real-material-bytes \
SG_PRODUCT_CORE_REAL_MATERIAL_AUTHORIZED=1 SG_PRODUCT_CORE_REAL_MATERIAL_FIRST_USE_CONFIRMED=1 \
SG_PRODUCT_CORE_REAL_MATERIAL_FILES='<两份获准原件绝对路径的JSON数组>' \
SG_PRODUCT_CORE_OUTPUT=<新输出目录> pnpm exec node scripts/verify-product-core-loop-local.mjs
```

资源收尾补充：详见 [资源核对](../../../../artifacts/acceptance/product/B3/core-loop-stage3-takeover/takeover-resource-closure.json)。自有 Demo 3000/4318 与正式临时3100/4320均关闭，运行任务0、本人接管0，原unknown1及4暂停保留；临时浏览器标签已关闭。关闭后普通只读SQLite查询出现CANTOPEN；确认无WAL、用不可变只读快照后quick_check=ok并核对上述数量，没有改库。原unknown关联SHA `2b426…2168` 的二创原件，用户首次未发布声明不自动替代该原任务的结构化核实。Demo旧语言声明zh/zh-CN、rights/source标签可作追溯线索，未查到真实制作/业务证明文档；不能以这些字符串建立外部证明或伪造UUID。已向用户请求制作／提供方、业务资料及已登记YT/Page记录位置。后续C2b→C2d→C3→C4保持，未把这一检查点写成全链完成。
