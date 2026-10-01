# 正式产品本地依赖

本目录只服务 `product/` 正式实现，不读取 Demo 的 SQLite、运行时队列或对象存储。

1. 将 `.env.product.example` 复制为被 Git 忽略的 `.env.product`，替换示例密码。
2. 执行 `docker compose --env-file product/deploy/.env.product -f product/deploy/compose.product.yml config` 检查配置。
3. 仅在开发者授权启动常驻依赖后，执行相同参数并追加 `up`。

端口、卷名和数据库名均使用 product 专属前缀。示例值不得用于共享或正式环境。

## 备份恢复工程边界

当前仅有server维护加密包组件与独占合成PG的实际导出/恢复演练，见[WP-27阶段记录](../../docs/engineering/delivery/records/WP-27.md)。不是自动生产备份、生产恢复CLI或联合对象/队列/密钥备份方案；不得将示例Compose配置或加密包的false字段当已部署恢复fence。

正式OPS须先落实维护权限、离线密钥保管与轮换、保留/频率/RPO/RTO及实际容量；恢复前停止消费，只接受受信任来源SQL并核对目标/完整备份/当前设备及外部事实。数据库恢复成功后先核对最新暂停、撤权、分配、在途/提交未知、对象与队列，不能直接重放历史消息。没有正式联合恢复、Android签名升级与回滚证据时，AC-52/53/60和B5保持未验收。

[只读恢复清单阶段](../../docs/engineering/delivery/records/WP-27-stage2.md)提供维护端一致快照与同snapshot dump回调、受限schema/行指纹比较；不会调用生产pg_restore/写文件/开Worker。技术行/字节上限和SQL/idle超时不是生产容量/RTO，sameSchemaAndRows也不是可重新执行；未知关系/类型/RLS不可读关闭。清单摘要仅维护端敏感元数据，不通过HTTP或日志公开，正式backup清单绑定、跨cluster/globals/ACL及联合当前事实/恢复fence仍须另验。

[v2认证清单组件](../../docs/engineering/delivery/records/WP-27-stage3.md)将inventory与真实dump同一AAD认证，仍只显式trusted维护caller、无自动生产runner。manifest清单是明文认证元数据，含敏感表名/行数/hash，须受控文件权限/密钥保管，不公开。认证不证明caller用了同一snapshot或SQL可信；实际producer/恢复验证/current事实/fence和正式OPS灾备验收仍需落实，不自动接受v1未认证sidecar作为v2。
