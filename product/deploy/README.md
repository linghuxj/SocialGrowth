# 正式产品本地依赖

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
