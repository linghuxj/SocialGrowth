# 正式产品本地依赖

筹备a42bc15原复核/QA完整报告均已读，严格24双有限0/各522首次过，QA新oracle0不累加；SHAe25589…/5f6d114…及所有原辅助失败/warning保留。自有两窗数据库/卷/快照精确gone，仍不签业务G1/AC/G3/父门禁或生产可用，详见WP13筹备卡。

2026-10-02 [WP13显式密钥保管接缝](../../docs/engineering/delivery/records/WP-13-stage4.md)：可信process-local MediaCredentialKeyCustodian显式owned ring/原子replace/null关闭/terminal dispose，Store兼容静态keys及每write同步snapshot。无env/file/historical secret/KMS读取或HTTP密钥管理，AppModule仍默认null；不能将此当生产key来源/轮换备份策略签署，in-flight owned snapshot不被后续rotate追改、dispose只关闭未来key请求，不代替当前动作撤权。作者10unit/正式根505及当前源12真实HTTP-PG/全product静态0；sparse/async/等待观察及startup guard首失败仍保存。BE `pnpm test:media-key-custodian-postgres`严格自有loopback DB/fullCID/cluster/solevolume guard，两代资源已清理，复现必须新真实身份，不直接用已goneJSON。OPS/TL的合法provider/TLS/保护/保留期与EX/AND当前许可/敏感界面可靠模型前保护仍真实待提供；无新Web/phone/ACG3签署。

2026-10-02 [WP13受控接口](../../docs/engineering/delivery/records/WP-13-stage3.md)：正式AppModule新增GET/POST `/api/operator/media-accounts/:accountId/credentials`，Cookie/CSRF、strict byte envelope/path关联及safe metadata；默认null key只读元数据，写经实际auth后关闭，没有production key-provider/明文GET或自动Artemis。base64是编码而非保密，生产HTTPS/请求日志保护与当前合法key来源、轮换保管必须OPS/TL落实后才能启写。作者根495与8真实loopback HTTP-PG首过（实际AppModule default及另targeted真实controller/auth/store合成keys模块，非生产接线）；命令BE `pnpm test:media-credentials-api-postgres`需reset=1、自有127.0.0.1/sg_wp13_credential_api_author、cluster/fullCID/唯一匿名volume，guard批次身份适配详见卡，不能直接复用已gone实例。无真实Web/phone/模型前保护/完整初始化承接或ACG3通过。

2026-10-01 [WP13受控凭据原语](../../docs/engineering/delivery/records/WP-13-stage2.md)：新增0023加密历史/current head/幂等命令三表，阶段二固定6555当时只有显式trusted server-only `MediaCredentialStore`、未接HTTP。独立AES/HMAC key，默认关闭/旧key重放当前metadata，历史密文/旧HMAC保留、轮换与恢复由OPS/TL确认。作者根486/5crypto/12PG、原非作者512首次过/限定新0余0完整报告已读，已交同原QA严格13，不签业务。BE `pnpm test:media-credentials-postgres`要求对应卡的reset/自有loopback DB/cluster/fullCID/唯一匿名volume，旧gone配置不复用；未读取任何历史密钥/环境文件。

2026-10-01 [WP13筹备后台](../../docs/engineering/delivery/records/WP-13.md)已接正式AppModule：运营Cookie/CSRF的POST `/api/operator/resources/identities`、POST `/api/operator/resources/reservations`，GET `/api/operator/resources/preparation`；新增0022 media_registry_commands与四strict共享schema。只登记运营声明的来源引用/初始筹备，registered_unverified/pending_initialization及两false，不读取旧媒体凭据、不调用平台或初始化/Artemis/队列。作者481产品/14实际HTTP-PG/旧资源13PG和静态通过，非UI补充，需原固定门禁；真实资源与受控凭据/R145承接producer/UI仍缺。自有PG17.10@127.0.0.1:32882/cluster7691693773417799713已核空schema/连接/upgrade库后精确CID和匿名卷清理、只读终核端口关且外来三实例不动；首辅助和产品fixture诊断保留，详见卡。未采用生产Compose/真实账号或手机联调，本次默认授权不扩大。

最新原两窗完整报告已全文读：票据双46/工程0、字节双55/工程0、批量非作者78/工程0，辅助首诊断与warning保留，已交同原QA批量固定18b7。均不能关闭真实HTTP/S3/页面/权利/手机验收或父pending1；发送不是验收完成。

首轮heartbeat新增WP15 stage15批量客户端，仅逐项原key/body/session与100KiB UTF8技术护栏、未知结果显式原包、strict部分反馈；作者最终9/root472/静态过，首lint1warning日志保留后改等价if。未新增后台配置或启服务/PG/UI/手机，不称真实批量保存。原stage12 QA/13复核完整报告已全文读/限定工程0，当前原QA票据430、非作者字节c8f；真实资源和父/安全/管理员门禁不变。详见[阶段交付](../../docs/engineering/delivery/records/WP-15-stage15.md)。

最新原两窗报告已完整读取/汇报：素材GET stage11原QA8/10/旧11首过、限定双工程0；声明保存stage12非作者原11/新12/旧19首过、0。取证首timeout/警告/早读保留，精确自有快照清理不影响服务。已实际交同QA保存49f strict12、同非作者票据430 strict8，字节c8f strict12已提交作者7/root463通过；真实HTTP/S3/Browser/File/手机/生产配置及业务验收未据此关闭。无需为上述非UI批次启动服务，默认隔离服务/指定Samsung授权仅在必要范围使用，不扩大到正式发布。

WP15 stage14原字节PUT客户端作者7/root463/静态首过（Node真实hash/Blob，fetch端口非UI）；没有真实HTTP/S3/Browser/File picker/手机验收或发布，16MiB/ASCII trace是现有传输护栏。采集c397原QA已全文读限定双清零，素材读取7f复核全文读/new0已交QA、原复核接保存49f，票据430已提交，字节随后原固定门禁；真实资源与父/UI门禁不关闭，详见[字节接线](../../docs/engineering/delivery/records/WP-15-stage14.md)。

WP15 stage13仅上传票据prepare/read客户端，作者6/根456/静态首过，沿用16MiB现有HTTP技术限制；没有bytes上传、存储配置、真实服务/UI/媒体准入交付。49f保存客户端已阶段提交待原读取之后固定门禁，当前原非作者7f/原QA c397；保护原证据与父/真人资源缺口，详见[票据客户端](../../docs/engineering/delivery/records/WP-15-stage13.md)。

最新stage6原非作者50行完整报告已全文读/new0/remaining0，实际原PG4/独立最小PG4首过、ownPG32880/卷全身份精确清理，已交原QA固定c397；同原非作者接素材读取7f，保存接线stage12待下一固定门禁。不是生产部署或真实业务签收，父/管理员/真人资源不关闭。

2026-10-01接续：WP15 stage12仅原会话/原请求的声明POST客户端，最终11/根450/静态过，首10/449及自查运营路径加固前证据保留，未开服务/执行真实HTTP或增加UI；不是生产写或素材准入。WP27 stage5已全文读原QA限定双清零，stage6原复核收尾、尚待完整读取再交QA。真实存储/合法对象/管理员UI/生产维护资源与父门禁仍开放，详见[保存客户端交付](../../docs/engineering/delivery/records/WP-15-stage12.md)。

2026-10-01：WP15 stage11仅Web内部素材四GET读取基础，作者8/根439/静态通过；不启动服务/加载真实配置/实现UI，管理员browser与新UI设计门禁未解除，不能作为正式Web/手机验收。WP27 stage4已读原QA全文有限双清零，stage5已读原复核全文清零交原QA，stage6固定c397交原非作者；所有生产key/维护源/RPO-RTO/fence/真实存储等资源及父门禁仍开放，详情见[交付记录](../../docs/engineering/delivery/records/WP-15-stage11.md)。

本目录只服务 `product/` 正式实现，不读取 Demo 的 SQLite、运行时队列或对象存储。

1. 将 `.env.product.example` 复制为被 Git 忽略的 `.env.product`，替换示例密码。
2. 执行 `docker compose --env-file product/deploy/.env.product -f product/deploy/compose.product.yml config` 检查配置。
3. 仅在开发者授权启动常驻依赖后，执行相同参数并追加 `up`。

端口、卷名和数据库名均使用 product 专属前缀。示例值不得用于共享或正式环境。

## 备份恢复工程边界

`product/backend/src/database-restore-maintenance.ts`提供受信任维护调用方可复用的最小组合：`captureAndStoreMaintenanceBackup`把已有同快照加密采集与加密文件存储串接；文件写入回执不明时返回**原备份ID和原加密包**供原包核对，不重新采集/换nonce。该返回包含明文认证metadata，维护调用方不得写普通日志或开放HTTP。

`inspectMaintenanceRestore`要求调用方传入原认证备份包中的清单，只读比较隔离目标与备份schema/行摘要、当前库与恢复库的会话/安装/关联/参与撤销、控制日志、outbox及对象引用，并逐个用现有S3对象存储校验目标引用的完整字节。它不执行`pg_restore`，不暂停或启动队列、不发放许可、不释放holder；`consumersStopped`和`physicalFence`固定为`unknown`，所有允许标志及`holderReleaseAllowed`固定false。会话/控制记录有差异、对象清单有差异、对象未核验或存储读取失败均须人工核实；当前adapter不区分对象404与存储不可用，只能报告未核验，不能伪称确认缺失。该检查也不能证明外部Page权限、Artemis/设备在途操作已停止。

Inventory仅接受内部identity依赖明确关联到同一schema的identity sequence，并摘要其定义与所属表/列；`sameSchemaAndRows`不比较`last_value/is_called`当前序列运行状态。新隔离演练单独验证其合成identity fixture经`pg_dump`/`pg_restore`后下一值继续递增，这只证明该样本包的恢复行为，不能把它当成inventory普遍验证序列运行状态。

[采集接线](../../docs/engineering/delivery/records/WP-27-stage6.md)使用自持只读快照，在有效期把snapshot交显式trusted archive回调，只读COMMIT回执成功后返回原v2加密包，成功转交dump最终清零；异步前固定metadata/key。维护caller须保证真实源/同snapshot/SQL可信及回调失败前的内部buffer清理；函数不核生产migration provenance或批准。文件保存另调原包，UNKNOWN不能自动重dump新nonce；无生产CLI/HTTP/scheduler/restore/consumer。合成PG4/431不是生产RPO-RTO/联合灾备或真实Web验收。

[故障接续阶段](../../docs/engineering/delivery/records/WP-27-stage5.md)实际验证文件落地后丢响应/部分写/权限失效/自己的pending未能清理等场景，UNKNOWN保留原ID和原包核对，不创建替代ID或自动信任两链接文件。IO端口仅trusted服务端代码、缺省真实fs，不能从HTTP/config提供；不实现自动orphan清理/chmod。作者fs14为真实合成文件故障补充，不是本轮PG/断电/生产灾备/当前批准/真实Web或真机验收。

当前仅有server维护加密包组件与独占合成PG的实际导出/恢复演练，见[WP-27阶段记录](../../docs/engineering/delivery/records/WP-27.md)。不是自动生产备份、生产恢复CLI或联合对象/队列/密钥备份方案；不得将示例Compose配置或加密包的false字段当已部署恢复fence。

正式OPS须先落实维护权限、离线密钥保管与轮换、保留/频率/RPO/RTO及实际容量；恢复前停止消费，只接受受信任来源SQL并核对目标/完整备份/当前设备及外部事实。数据库恢复成功后先核对最新暂停、撤权、分配、在途/提交未知、对象与队列，不能直接重放历史消息。没有正式联合恢复、Android签名升级与回滚证据时，AC-52/53/60和B5保持未验收。

## Android正式构建输入门禁

现有 `assembleDebug` 命令不变，继续使用本地调试端点默认值。`assembleRelease`、`bundleRelease` 以及会生成release变体的聚合 `assemble`/`build`/`bundle` 必须显式提供以下环境变量；release没有demo/调试签名回退：

| 变量 | 用途 |
| --- | --- |
| `SG_PRODUCT_ANDROID_VERSION_CODE` | 本候选正整数版本码 |
| `SG_PRODUCT_ANDROID_VERSION_NAME` | 简短版本名 |
| `SG_PRODUCT_ANDROID_PREVIOUS_VERSION_CODE` | 明确提供的上一版版本码；候选必须更大，门禁不猜生产版本 |
| `SG_PRODUCT_ANDROID_API_BASE_URL` | 真实服务 HTTPS URL，拒绝保留示例/本机域名 |
| `SG_PRODUCT_ANDROID_SIGNING_KEYSTORE` | 外部提供的正式 keystore 路径 |
| `SG_PRODUCT_ANDROID_SIGNING_KEY_ALIAS` | 正式签名 alias |
| `SG_PRODUCT_ANDROID_SIGNING_STORE_PASSWORD` / `SG_PRODUCT_ANDROID_SIGNING_KEY_PASSWORD` | 构建进程环境中的签名凭据 |
| `SG_PRODUCT_ANDROID_SIGNING_CERT_SHA256` | 预先可信的公开证书 SHA-256 指纹，可带冒号 |

Gradle只在正式变体路径取这些provider值；构建时校验版本单调、HTTPS host、keystore可用签名条目及证书指纹。仓库和CI不保存签名秘密或正式证书。本仓库的CI继续构建debug，并用缺项、占位endpoint、非递增版本的负例及临时生成的合成测试证书指纹不匹配确认release fail closed；不会使用该合成证书签包或保存它。它不会生成/签署正式包。不要把Gradle构建日志、环境诊断或公开metadata用于输出签名密码/keystore内容。

这只是正式构建配置门禁，不证明真实发布签名、升级后安装身份/本地状态保留、旧客户端兼容、回滚/前向修复、设备安装或用户验收；上述AC-53/60证据仍需真实受控候选和运营资源。

`pnpm --filter @socialgrowth/product-backend exec tsx --test --test-concurrency=1 src/database-maintenance-recovery.pg-test.ts`在自有回环PG17/MinIO容器上实际联验同包采集、provider/install撤权与installation/association/participation变化、未解决holder/outbox、对象删除后未核验和默认关闭许可。该演练只应用其文件列出的维护依赖migration子集与测试identity fixture；不是完整产品schema恢复、消费者停止、物理fence、生产灾备或业务验收证据。

[只读恢复清单阶段](../../docs/engineering/delivery/records/WP-27-stage2.md)提供维护端一致快照与同snapshot dump回调、受限schema/行指纹比较；不会调用生产pg_restore/写文件/开Worker。技术行/字节上限和SQL/idle超时不是生产容量/RTO，sameSchemaAndRows也不是可重新执行；未知关系/类型/RLS不可读关闭。清单摘要仅维护端敏感元数据，不通过HTTP或日志公开，正式backup清单绑定、跨cluster/globals/ACL及联合当前事实/恢复fence仍须另验。

[v2认证清单组件](../../docs/engineering/delivery/records/WP-27-stage3.md)将inventory与真实dump同一AAD认证，仍只显式trusted维护caller、无自动生产runner。manifest清单是明文认证元数据，含敏感表名/行数/hash，须受控文件权限/密钥保管，不公开。认证不证明caller用了同一snapshot或SQL可信；实际producer/恢复验证/current事实/fence和正式OPS灾备验收仍需落实，不自动接受v1未认证sidecar作为v2。

[文件存储阶段](../../docs/engineering/delivery/records/WP-27-stage4.md)提供显式配置/默认关闭的server-only维护接口：canonical绝对路径、当前UID独占0700目录/0600文件，先认证v2，再真实exclusive staging/file sync/不覆盖hardlink/目录sync；原ID相同包可核对重放，不同包冲突。只落加密包（manifest仍敏感明文），不落dump明文/key，不自动建目录/修权限/保留清理/生产restore。load有界真实FD/NOFOLLOW/UTF8及GCM/ID校验，UNKNOWN保留原ID重新核对。只支持受信任POSIX维护owner独占目录及祖先，不抵抗恶意同UID路径交换；fsync成功不是断电或生产联合灾备证据，默认服务授权不等于批准生产目录/密钥/保留/SQL来源。
