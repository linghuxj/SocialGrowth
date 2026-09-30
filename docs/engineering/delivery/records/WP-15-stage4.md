# WP-15 第四阶段：认证对象上传票据与持久核验

2026-10-01后续原非作者完整报告`artifacts/review/wp15-upload-be02bd7.md`已全文读取：固定747..be02十五文件新增0/remaining0，指定4unit/11真实联合＋新独立8、static通过；manifest首轮错误把test script算consumer的失败及初始诊断保留后仅修自身脚本。未重跑作者338/全253，旧SQL守卫未单独断言端口，实际完整实例归属另核验。已交原QA同固定增量（未来stage5完全排除），尚不作者自签双G1/父来源pending1或业务通过。

2026-10-01；基线747a9ce，feature/wp-15-authenticated-object-upload-stage4。BE/OPS实施代理Codex；原非作者/QA，WEB/EX/BIZ真人待签。[素材登记](WP-15-stage3.md)、[原存储](WP-15.md)、R-007/022～025/031/125、AC27～29及[质量手册](../quality-gates.md)。

领取先固定原project/object ID及字节SHA/长度/声明MIME/显式存储位置绑定的认证票据，再按原ID上传完整bytes与实际读回核验；事务外存储IO，前后实际operator会话/CSRF、原请求key/描述/CAS一致。失ACK/过期导致登记未完成时原票据可核实或重试同ID，不自动换ID、覆盖原字节或清理未知结果；成功保存verified_bytes不等素材准入/手机就绪/平台发布。

实际存储仅显式受控server配置和既有MaterialObjectStorage，无ambient credentials/业务输入endpoint/bucket/key/公开URL。持久verified manifest可供MaterialStorageVerifier按受保护DB lookup读取并重新验字节，不再靠临时map冒充生产resolver；无真实存储配置则记录资源需求并保持写入关闭。先完成票据/IO/持久层补充检查，后续单独接当前认证HTTP/跨端契约及UI；管理员浏览器未解除不新增页面或换入口，不能把非UI混合存储事务检查当Web业务。

RES-WP15-01～05/RES-WP14-03继续：真实素材/声明/批准、正式位置与最小权限凭据/保留恢复、大文件/分片/真机任务关联与正确选取、浏览器及对应真实验收仍缺；默认服务/Samsung授权不等实际平台发布/删除/真实资料外发。配置/人员阻断写明真实输入与补验步骤后继续独立工程，凝聚提交后原固定门禁，不自报全部开发完成。

## 实际实现及状态含义

0020新增上传票据及actor/key命令，沿用0019 material guard和不可变manifest。空schema/原0019既有manifest均实际安装：旧manifest保留，不自动猜原上传人、创造verified票据或迁移历史。prepare只接当前operator/CSRF、明确project/object UUID、SHA/长度/声明MIME；server固定location/binding及对象key，业务输入不含URL/endpoint/bucket/凭据/成功状态。内部MaterialUploadStore缺配置在connect前关闭新prepare/upload，旧read仍可读历史，不证明当前对象可用。

先实际operators/auth/session→material guard→project及票据/原key检查；释放全部事务后条件PUT及完整GET核验；随后新事务重认证/CSRF/绑定/CAS、manifest/ticket/audit/command逐写影响行数1及最终DB钟才提交。上传输入bytes在首await前复制，固定SHA/长度；同对象不能跨project、换声明、位置或同key换操作。verified_bytes只表示当次实际字节核验完成，不表示人工声明可信、编码合格、版权/未发布/批准准入、候选、手机或平台成功，两个业务许可仍false。

同key及相同资料新key读当前历史，不重复物理PUT或audit；prepare命令与upload命令分开绑定。实际bytes已存但应答未知、后置会话失效或SQL失败时票据保持pending_bytes；不删除对象，不自动换ID/覆盖，原ID按原字节条件重试与读回收敛。实际COMMIT已成功但应答丢失亦能新实例原key返回当前。历史verified重放不再下载，不宣称当前字节永不会被存储管理员改写；强DB owner可改控制，不能以trigger/FK称防篡改完成。

objectVerifier为server-only受保护DB lookup：仅同项目、完整verified票据及matching immutable manifest返回；lookup只锁material guard并在下载前释放，实际MaterialStorageVerifier重新GET/SHA/长度/声明类型核验。lookup结束后先检查取消、并复制依据才调用SDK，迟到lookup不得启动下载，callback改写不能替换固定manifest。没有临时map、caller已上传标志或自动环境凭据。尚未注册AppModule/HTTP/跨端JSON/UI、批上传队列、Task、手机文件或准入生产者；测试调用内部类不等这些消费者已实现。

## 作者实际工程验证

证据 `artifacts/acceptance/product/B3/wp15-stage4-author`。环境Node24.16.0项目路径/SQLite OK，pnpm8.14.0；根env/check/lint/test/build均exit0，**338/338**＝45TS＋19Python＋252BE＋4EX＋18Web。全隔离PG **253/253**，fail/cancelled/skipped0；这是原registry等全PG补充检查，不将新联合检查重复加计。新增upload core2及verifier2 unit实际通过；最后扩展后backend check/lint仍exit0。

独立自有真实PG＋MinIO联合补充检查初轮9/9、第二轮9/9、最终**11/11**，fail/cancelled/skipped0。包括空/0019前向保留、真正认证prepare→实际条件PUT/完整读回→新实例DB resolver→registry仍pending、真实存储管理员坏字节拒绝、旧/新key零重复IO、跨project/描述/key/操作/绑定拒绝、实际两并发只推进一次且物理IO期间guard可独立取得、真实存储写成功失ACK原ID恢复、CSRF预拒绝及实际IO后session到期不提交、manifest INSERT/ticket UPDATE/command INSERT/audit INSERT逐一抑制全部回滚、prepare三处INSERT抑制全回滚、read/旧key最后查询后实际到期回滚、真实COMMIT成功失ACK恢复与SQL禁止重绑/删除。SQL故障和会话更改均明确合成夹具，非Web绕过或真实业务验收。

复现：根`pnpm env:check`、`check:product`、`lint:product`、`test:product`、`build:product`；unit为backend `tsx --test src/material-upload-core.test.ts src/material-storage-verifier.test.ts`；明确自有隔离reset URL全`test:postgres`；联合使用`pnpm --filter @socialgrowth/product-backend test:upload-storage`，必须同时专用`127.0.0.1:32868/sg_upload_fixture`、ALLOW_RESET=1、storage `http://127.0.0.1:32902`/ISOLATED=1及显式合成凭据。守卫不会指向生产/原9000，重建自有服务后才复跑；非UI补充测试不是替代Playwright的另套项目验收。

## 资源、四态及后续分工

自有PG实际17.10 Alpine，镜像sha256:93aa428db0aeeb71d24dcad1491bef6e1396a4255697e4bfc4c725bfeb981b74，完整ID e6f8538a356ce9e7afda6cf87261ccdff99707a1b18fc9fd0b206747d99d37b8/sg-wp15-upload-pg，回环32868/sg_upload_fixture，唯一匿名卷0fbf0ad3942792715b758d50b8f03c2c76001af21164fd2cb582c0b48af0e818。自有MinIO实际RELEASE.2025-09-07T16-13-09Z/commit07c3a429bfed433e49018cb0f78a52145d4bedeb，镜像sha256:69b2ec208575b69597784255eec6fa6a2985ee9e1a47f4411a51f7f5fdd193a9，完整ID f48afd583187ab3c02fdeb4016b9f76e7822266032967fc024f2a693c0bbf494/sg-wp15-upload-storage，回环32902，唯一匿名卷3eda4216da2d0db757021d2055363c78bf33b901521f838a1b88383ad1ece24e。两实例无宿主挂载，仅合成fixture，不使用其他实例秘密。最终PG schema/其他连接/deadlocks=0|0|0；精确身份/卷独占后自有容器及卷清理结果以services-stop/remove/after日志为准，源代码与首次/最终日志保留。

通过：上述作者工程检查；失败：本阶段实际工程检查无失败，主动故障断言为预期拒绝非未记失败；阻断：RES-WP14-03浏览器、父WP10来源pending1及正式资料/配置/人签；未实现或未验证：当前认证HTTP/共享契约/页面、正式存储最小权限与保留恢复、实际媒体准入、Task/下载到手机/Artemis正确选取、公开发布及全AC/G3。原窗口固定门禁尚未执行，不自签G1或合父Developer。

资源清理实际完成：两完整容器ID及上述两个唯一卷的after日志均0字节，停止/删除日志保留；只移除了可重建合成对象和测试数据库，不可恢复但可按脚本重建，其他服务及原9000未动。

BE下一阶段显式server配置、实际认证HTTP及跨端契约；WEB在管理员恢复浏览器后按原materials-batch/preview/bulk-dialog图及prompt实现并Playwright真实操作；OPS提供正式location/endpoint/私有bucket、最小权限受保护凭据及恢复策略（不得贴入代码/日志）；BIZ提供真实素材、原source身份与声明/批准边界；EX提供原Task关联、实际文件传送与Artemis决策证据；原非作者固定审阅→原QA独立工程及随后真实流程验收。以上是职责分工，不代表真人已领取/签字，缺输入记录后继续可独立编码。
