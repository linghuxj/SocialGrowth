# WP-11 阶段二：持久调用与停止日志

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

更新：2026-09-30。基线`018169e`，执行分支`feature/wp-11-control-journal-stage2`。EX/BE由Codex阶段代理实施；原非作者复核／原QA独立检查，AND后续本机控制事实，OPS受控执行包，TL/QA物理停止判据待定。沿用[WP-11任务及资源](WP-11.md)、CT-06和六条交错序列；本阶段无页面，未改变设计参考图或原prompt。

## 实际边界

- `0006_phone_control_journal.sql`和内部`PhoneControlJournal`保存单设备控制记录、幂等命令与审计。设备→journal固定锁序，锁内重读当前记录、版本和数据库墙钟；快照、命令摘要和最小审计同事务，故障整体回滚。
- 新建记录默认`stop_requested`、无持有者／停止证据，不推断已停止、在线或可执行。没有控制持有者取得、重新启用、HTTP、Nest注册、队列或实际ADB路径；正常产品路径尚不能进入enabled。测试中的enabled和true资格只是非UI夹具。
- 不同调用竞争只有一条写入在途；同键同载荷重问返回**当前状态＋replayed**，不返回再次动作许可，更新后的暂停也保留。相同键不同载荷／原expectedVersion拒绝。进程重启不会清未知调用或旧持有者。
- 暂停可在运行中登记，递增控制代次但保留调用；未知不释放，旧结束只补历史。结束回执强制携带deviceId并匹配记录，调用身份须在可信适配实际派发时固化，禁止从收件路由补填目标。停止确认仍要求当前停止请求、持有者／目标／代次、在途已结束和最新路径fence／交还／实际静止证据；这些只供可信内部适配，不接受HTTP自报成功。
- **不是完整原子动作许可服务。** `trustedFacts`只为内部核心调用参数，阶段二未实现数据库内实时读取项目／授权／网络／本机意愿等全部权威事实；没有HTTP调用方或实际动作消费者。未来broker必须先统一权威写入锁序、鉴权、当前事实快照及物理调用fence，不能在锁前取得facts后依赖本journal称已关闭竞态，也不能从`replayed=false`直接操作手机。
- 单行5秒锁等待、10秒SQL语句上限仅工程防挂保护，不是整事务／真机在途上限。所有数据库错误固定码，秘密不写命令或审计；审计仅版本、代次、处置和在途计数。

## 补充检查

本阶段`pnpm check:product`、`lint:product`、`test:product`117/117（31TS＋10Python＋58BE＋4EX＋14Web）、`build:product`和`env:check`通过；实际项目Node24.16.0、SQLite OK。独立生成边界未漂移，Android产物不变。

用户默认临时服务授权下先核对仅既有`qm-dev-postgres`55432和`minio-test`9000/9001，无本轮端口占用；创建`sg-wp11-journal-pg`回环32836、夹具库`sg_wp11`，PostgreSQL17.11／镜像digest`sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f`。仅将专用URL与重建开关传给非UI补充测试，没有接触其他库。

```sh
SG_PRODUCT_TEST_DATABASE_URL=<本轮独立可销毁库> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:postgres
```

初轮PG69/69通过；根据原复核反馈补设备绑定、精度／溢出后最终全套PG72/72（原56＋日志16）通过，失败／跳过0：默认阻断初始化、两连接／两个真实OS进程竞争唯一调用、丢响应后暂停状态接续、同键异载荷拒绝、在途暂停及迟到历史、未知／重启不释放、旧停止证据失效、审计失败全回滚及脱敏、非法边界／坏快照保留、锁等待后租约到期拒绝、另一设备独立进展、相同三元组跨设备误投保持原占用、超过JS安全整数的代次无损、版本／代次溢出无部分写。**直接写enabled/资格或损坏记录仅为事务夹具，不是设备或业务验收。** 本阶段没有业务入口，不以补充PG/进程测试代替Playwright及Artemis真机停止验证。

结束只读确认测试schema数量0，核对精确容器ID/端口后仅停止该`--rm`容器，夹具数据自动删除；原两容器保留，无新增后台消费者／业务服务。固定源码可重建临时数据。

## 前阶段门禁与后续

WP-08阶段四`ab3d6bf`原复核清零，原QA[完整报告](../../../../artifacts/acceptance/product/B2/20260930T050217Z-wp08-stage4-ab3d6bf/acceptance-report.md)已读取：100/100、PG56/56、原六组和新四组探针通过，G1建议合入；核对祖先及Developer未被其他worktree检出，以旧tip7f95e5e作CAS快进到Developer@ab3d6bf。保留用户脏脚本及当前日志切片。

WP-11阶段一`018169e`原非作者报告`artifacts/review/wp11-stage1-018169e.md`已完整读取：115/115及八组独立规则通过，但1项P2／remaining=1，G1不通过；结束回执未绑定设备，在A/B复用holder/action/generation后可错放另一机。已在本凝聚切片强制deviceId并在改历史前匹配，缺字段／错设备拒绝，增加同三元组跨设备单元与PG回归。自检修复不是非作者清零；待新固定提交同窗复核及原QA独立检查，未合入WP11。

RES-WP11-01～03、真正权威加载／持有者仲裁、本机持久意愿、全路径Artemis适配、真实停止证据与多机验收仍待；不称WP-11或B2完成，执行器仍关闭。人工/资源缺口记录真实输入和解除条件，继续可独立工程，不伪造停止或恢复。

后续闭合：固定d8d9bcf原非作者报告完整读取，原P2独立确认关闭／remaining=0，两阶段工程G1通过；117/117、PG72/72、原八组＋设备隔离以及六组持久探针全部通过。原QA[独立报告](../../../../artifacts/acceptance/product/B2/20260930T054826Z-wp11-stage2-d8d9bcf/acceptance-report.md)完整读取，同范围117/72及探针通过，G1建议合入，临时库清理。核对Developer未被其他worktree检出及祖先后以ab3d6bf旧tip的CAS快进到d8d9bcf，保留后继WP16与用户脚本。真实停止及整体G3仍未通过。
