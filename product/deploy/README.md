# 正式产品本地依赖

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

[采集接线](../../docs/engineering/delivery/records/WP-27-stage6.md)使用自持只读快照，在有效期把snapshot交显式trusted archive回调，只读COMMIT回执成功后返回原v2加密包，成功转交dump最终清零；异步前固定metadata/key。维护caller须保证真实源/同snapshot/SQL可信及回调失败前的内部buffer清理；函数不核生产migration provenance或批准。文件保存另调原包，UNKNOWN不能自动重dump新nonce；无生产CLI/HTTP/scheduler/restore/consumer。合成PG4/431不是生产RPO-RTO/联合灾备或真实Web验收。

[故障接续阶段](../../docs/engineering/delivery/records/WP-27-stage5.md)实际验证文件落地后丢响应/部分写/权限失效/自己的pending未能清理等场景，UNKNOWN保留原ID和原包核对，不创建替代ID或自动信任两链接文件。IO端口仅trusted服务端代码、缺省真实fs，不能从HTTP/config提供；不实现自动orphan清理/chmod。作者fs14为真实合成文件故障补充，不是本轮PG/断电/生产灾备/当前批准/真实Web或真机验收。

当前仅有server维护加密包组件与独占合成PG的实际导出/恢复演练，见[WP-27阶段记录](../../docs/engineering/delivery/records/WP-27.md)。不是自动生产备份、生产恢复CLI或联合对象/队列/密钥备份方案；不得将示例Compose配置或加密包的false字段当已部署恢复fence。

正式OPS须先落实维护权限、离线密钥保管与轮换、保留/频率/RPO/RTO及实际容量；恢复前停止消费，只接受受信任来源SQL并核对目标/完整备份/当前设备及外部事实。数据库恢复成功后先核对最新暂停、撤权、分配、在途/提交未知、对象与队列，不能直接重放历史消息。没有正式联合恢复、Android签名升级与回滚证据时，AC-52/53/60和B5保持未验收。

[只读恢复清单阶段](../../docs/engineering/delivery/records/WP-27-stage2.md)提供维护端一致快照与同snapshot dump回调、受限schema/行指纹比较；不会调用生产pg_restore/写文件/开Worker。技术行/字节上限和SQL/idle超时不是生产容量/RTO，sameSchemaAndRows也不是可重新执行；未知关系/类型/RLS不可读关闭。清单摘要仅维护端敏感元数据，不通过HTTP或日志公开，正式backup清单绑定、跨cluster/globals/ACL及联合当前事实/恢复fence仍须另验。

[v2认证清单组件](../../docs/engineering/delivery/records/WP-27-stage3.md)将inventory与真实dump同一AAD认证，仍只显式trusted维护caller、无自动生产runner。manifest清单是明文认证元数据，含敏感表名/行数/hash，须受控文件权限/密钥保管，不公开。认证不证明caller用了同一snapshot或SQL可信；实际producer/恢复验证/current事实/fence和正式OPS灾备验收仍需落实，不自动接受v1未认证sidecar作为v2。

[文件存储阶段](../../docs/engineering/delivery/records/WP-27-stage4.md)提供显式配置/默认关闭的server-only维护接口：canonical绝对路径、当前UID独占0700目录/0600文件，先认证v2，再真实exclusive staging/file sync/不覆盖hardlink/目录sync；原ID相同包可核对重放，不同包冲突。只落加密包（manifest仍敏感明文），不落dump明文/key，不自动建目录/修权限/保留清理/生产restore。load有界真实FD/NOFOLLOW/UTF8及GCM/ID校验，UNKNOWN保留原ID重新核对。只支持受信任POSIX维护owner独占目录及祖先，不抵抗恶意同UID路径交换；fsync成功不是断电或生产联合灾备证据，默认服务授权不等于批准生产目录/密钥/保留/SQL来源。
