# WP-27 第四阶段：受控加密备份文件存储

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-01最新：原QA完整63行`artifacts/acceptance/product/B5/20261001T102448Z-wp27-file-store-525a/acceptance-report.md`已全文读取，SHA abee7a2a6a1b4d3f423a042f5d03a606337026fd5ff09787e02fcc015c5563f1，限定new0/remaining0，与原非作者有限双工程闭合。原8/复用6/真实OS EACCES1/原PG12/最小PG1分别首次过，QA新oracle0、未运行根422，3自有lint warning和启动诊断/旧零断言导出诊断分开保留；旧报告/首红及指纹不动。自有02c8a4 PG32878/b4d01d卷/cluster7691644460347068454与快照/目录按完整身份精确清理。非生产灾备、真实Web或真机签收；下方待验是历史状态。原QA现接第五阶段新固定4e18。

2026-10-01；基线c147ef8a8e52def2fbe94d0c30a25927698626e9，feature/wp-27-encrypted-file-store-stage4；OPS/BE实施代理Codex；原非作者/QA固定复验，正式OPS/TL真人待签。[v2](WP-27-stage3.md)、[继承整改](WP-27-inheritance-remediation.md)、[质量手册](../quality-gates.md)。

## 本次真实能力与信任范围

新增 server maintenance `EncryptedDatabaseBackupFileStore`，显式配置已有canonical绝对目录，配置null/无效默认关闭；只支持当前UID独占0700目录和0600普通单链接文件，需POSIX的O_NOFOLLOW/O_DIRECTORY、hardlink及目录fsync支持。维护owner必须控制目录及祖先，不宣称Node路径检查具有openat安全性或能抵抗恶意同UID/管理员改路径。服务不自动mkdir/chmod/chown、不扫描/清理旧文件；无HTTP/CLI/scheduler/pg_dump/pg_restore/Worker/真实生产部署。

save先clone并由原strict v2/GCM实际认证，临时解密dump及时fill(0)，不写明文dump/key；只序列化完整认证加密包，manifest仍明文敏感元数据，不能当加密清单。私有key copy跨异步持有后finally清零，不改caller。规范排序JSON实现属性顺序无关的原包重放，文件名只用规范化backup UUID，不接受调用者路径。180MiB JSON/读取为技术护栏，原128MiB dump上界不变，不是容量/频率/retention/RPO-RTO目标。

真实写入：随机唯一.pending以O_EXCL/NOFOLLOW及0600创建→写入并file.sync→核inode/权限/大小及目录身份→hardlink到原backupId.sgbackup.json（不使用覆盖rename）→只unlink本调用的原staging inode→目录sync后返回stored。原ID现有包必须通过完整读取/GCM/ID核对且规范字节SHA相同才already_stored；同ID新nonce/不同包冲突，不覆盖/删原文件。并发短窗口中正在发布或不安全文件可返回固定失败，不能假称重放已成功。

link成功后晚期错误，以及不能确认落地的I/O错误只DATABASE_BACKUP_FILE_UNKNOWN；保留原ID重新load/核对，禁止据错误生成新备份或覆盖。原最终文件永不错误清理，失败时只尝试清本调用staging inode；若权限/目录不可靠，可能留orphan，须维护人员另行核对，本组件不扫描自动删。最终所有错误只固定code/message，无cause/path/key/原JSON。当前未实际注入link后fsync错误或机器断电，UNKNOWN路径是源码处理，不冒称已通过真实灾备。

load使用NOFOLLOW/NONBLOCK真实FD，先fstat普通文件/owner0600/单链接及size，再固定size+1缓冲显式有界读取；复核前后inode/size/mtime/ctime/权限及目录身份，严格UTF8/JSON、v2/GCM及文件名backupId核对后只返回加密包和SHA。密文读缓冲finally清零；无原行/key/dump返回或日志。不是当前暂停/授权/SQL来源核对；stored只是当前文件/目录sync调用成功，不保证所有设备缓存/文件系统在断电后的持久性。

依据[Node24文件API](https://nodejs.org/docs/latest-v24.x/api/fs.html)的exclusive/no-follow/link/fsync机制，实际项目Node24.16.0测试，不用官网当前24.21当本机证据；公开POSIX link资料读取失败仅文档辅助诊断，原fs机制由实际本机文件系统验证。没有绕管理员浏览器控制做Web验收。

## 作者实际检查与清理

证据`artifacts/acceptance/product/B5/wp27-stage4-author`：新8组真实私有文件系统测试首次通过：保存/新client读回和0600/无明文dump-key；规范重放/同ID冲突保留原包；真实并发两不同包只一胜；缺省/非法配置-key-shape及认证失败无写；目录symlink/750不自动修权限；final symlink保留victim/hardlink/mode拒绝；实际180MiB+稀疏file及坏UTF8/JSON/manifest/跨ID关闭；orphan与无关文件保留不消费。fixture dump只PGDMP合成字节，不能证明SQL合法或业务恢复；每个自有mkdtemp目录身份/UID/非symlink核验后精确清理，不删除仓库/服务数据。

原真实PG12仅第一组增添实际加密file store/save→新维护client/load→原open→own empty target pg_restore，其他11组断言正文不变；实际12首次全PASS/skip0。仍保持原同snapshot源先变更再dump/恢复66表七摘要与旧snapshot相等而非当前源，篡改关闭/RLS/结构/容量/继承等原反例。只在自有mkdtemp目录写加密JSON，key/dump不写盘；每次删除目录前核dev/ino/UID/非symlink，只清本组新建目录。新client不是PG服务器重启或正式恢复资格。

env/check/lint/test/build exit0，根产品422=59TS+33Python+308BE+4EX+18Web，8组已含在根，实际PG12单列不累加业务覆盖；没有SQL/93schema/依赖/根lock/Android/Web/executor或旧v1/v2 crypto/清单SQL变化。原父13/旧全PG/Playwright/真机未重跑，不代验。首8/PG12/根首次无业务失败，原作者/原窗口旧RED与指纹不覆盖。

全新own PG CID80f637d29c242a61e331a3f7b71bb2422397fa9308f21ab7ce8109a7fdd10d25，/sg-wp27-inventory-pg@32878/loopback，image93aa，--rm/label wp27-restore-inventory/无hostmount，cluster7691633029027745825，唯一匿名卷96aefac1c32afba989d0511d8979aa4c6bf3bce58c4de5203043f1f105403965。启动前端口空闲；每reset/restore/DDL/after完整选定Docker身份/独占卷及双库TCP DB-user-cluster核验，不读外来Env/数据。不借他窗已删资源或重启9000/nestar。cleanup复制自己旧工具到新路径并apply_patch新CID/卷/cluster，旧源/日志不动；双库含external schema/他连接/deadlocks/临时role0|0|0|0后精确stopCID，容器卷消失/32878关闭。合成库及新fixture目录不可恢复但源码可重建，证据保留。

复现 `pnpm --filter @socialgrowth/product-backend exec tsx --test src/database-backup-file-store.test.ts`；实际PG另需新own同名/label/32878资源及完整归属，设置原SG_PRODUCT_TEST_INVENTORY_CONTAINER_ID/ALLOW_RESET后`test:database-inventory`单次退出、自己的守卫与精确清理。正式目录/离线key/config不由测试自动提供。

## 其他窗口完整报告汇总与接续

原两窗口职责保持开发/只读非作者/真实环境QA；只读既有报告不重发。backup546原QA报告SHA2be157ddb6c42928ce7fec6a8072d6368209d238176a43ee876d1a4b66b3c35b、calendar-a761原QA SHA cf6afeaebb1e81ee00edd548b7ecb939bf4f06d337611d29e11019df5a3a5444全文已读，有限双new0/remaining0，日历原P3同oracle双清零；原RED/所有指纹保持，自有资源/快照已精确清理。不是Web/真机/业务AC。

原继承A完整复核SHA484160e4f0a726f8aedfeb092421b529dfd5a8a3c5e3176d8f701c2d4d907bee及原QA SHA c4213e49000f563b27d88a83a8154595ef6b1d8fb93c612bc072f01ee66bf54b已全文读，3/4/11/4/1分别通过/QA新oracle0，原P2双实际清零。原63继承RED、旧22023预期错组、复核A首before42P04零业务错误及另存正确11源码全部保留，不把首红写绿。

原B完整非作者 `wp27-v2-1921.md` SHA4f2dbfe012b1d8d7e804eb2ec3e46dd71133782b4ada615b553c7440050557ae全文已读：原1921固定crypto新0但清单依赖历史remaining1；同oracle原4=3PASS1RED→最小两文件组合4PASS/PG12，组合new0/remaining0；新crypto5/真实declaration1等分组，认证正确也可能声明错，真实恢复后只读比较能检出。不将原9通过当原固定无缺陷。原QA已接A→B固定新批，A已完整结束，B当前执行中，不凭进度签最终组合双过。

本阶段完成凝聚提交交同原非作者新固定，再按完整报告提原QA；主窗口继续未受阻工程并汇报其他窗口真实结论，不以交接/发送作为完成或等待用户催促的节点。父WP10来源pending1/Developeraf14、browser管理员/SEC/RES-WP27-01～03仍保持，不重试受限父13/换入口绕过；真人密钥/部署/保留/RPO-RTO/当前facts/fence/联合恢复/Android签名等记录真实输入与解除条件，不阻独立文件工程。

四态：**通过**本作者8/PG12/422；**失败**本阶段无业务失败，旧首红保留；**阻断**生产维护/父/浏览器对应范围；**未验证**本新stage4非作者/QA、断电与晚期I/O故障、生产runner/retention/RPO-RTO/完整恢复fence/联合外部恢复、Web/真机/所有开发/AC/G3。需要人工的是配置与真实验收，不是文件代码已经完备的签收凭证。
