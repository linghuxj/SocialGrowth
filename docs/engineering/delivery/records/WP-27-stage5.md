# WP-27 第五阶段：真实文件晚期故障与原 ID 接续

2026-10-01原QA完整63行`artifacts/acceptance/product/B5/20261001T105718Z-wp27-file-fault-4e18/acceptance-report.md`已全文读取，SHAa2ffbfa552376d7aec49fff0aec9e91c767202857926bd3b77456d7b03817a4a，限定new0/remaining0，双方有限工程闭合。原14/复用6/真实EACCES1/已更正port7分别过，QA新oracle0，错误首7仍6PASS1FAIL；自有证据首误计后来35为历史34与过早只读日志诊断另存，仅补path-status计数校验，原业务断言不改。39来源before/after保持，35新目录和私有snapshot精确身份清理，无服务/PG/根428本轮。下方QA中为历史；未签生产灾备/Web真机/全部开发，原复核现检查stage6，主窗口继续素材客户端。

2026-10-01最新完整43行原非作者报告`artifacts/review/wp27-file-fault-4e18.md`已全文读，SHA2c34628c82e59d5b0b94db770c58aa0972b14a50bc24bcf455ebb10dedd8c111，新增0/阶段remaining0。原14/复用6/真实OS EACCES1过，新port7首6PASS1FAIL为自有save错误预期UNAVAILABLE、既有策略为intent后UNKNOWN；另存只更正一个预期后7PASS，首源5ee957…/日志118f47…保持，load仍UNAVAILABLE；不是产品finding，也不把首次写全绿。默认实现逆剥离port逐字525、原8正文不改，156旧BE/21SQL/93schema保持；34own/12author及旧169指纹保持，35个新私有目录及固定snapshot按身份清理，无PG/service本轮。已向原QA发新固定525→4e18严格10复验，当前只待该门禁，不自签QA/生产/AC；下方前次执行中为历史。

2026-10-01接续：4e1827e十文件凝聚提交已交原非作者新固定复核。原stage4完整报告9ccff673f852f3a18bf1852628b20e4bcf9abf938c49d29d3e989cc0cc87ca10全文读/新0/剩余0后交原QA新固定525；两窗当前执行，非重发既有读取。主窗口继续[同快照采集接线](WP-27-stage6.md)实际新3/PG4/root431，通过仅作者范围，下方此前stage4执行中保持历史。

2026-10-01；基线 `525a0628cf58106d3edc05278841b6273ba167c3`，`feature/wp-27-file-store-fault-recovery-stage5`。OPS/BE 实施代理 Codex；原非作者固定复核后交原 QA 独立工程复验，正式 OPS/TL 真人待签。[文件存储阶段](WP-27-stage4.md)、[分工](../work-packages.md)、[质量手册](../quality-gates.md)。

## 实现与真实故障检查

既有 server-only 组件增加窄 `DatabaseBackupFileIO` 端口，缺省仍实际 Node fs/promises 的 open/lstat/realpath/link/unlink；构造时复制并冻结函数引用。端口只能由受信任服务端代码提供，不能从 HTTP/JSON 配置接收，不证明恶意实现的真实性。原默认关闭、规范路径与 UID/0700/0600、单链接、有界读、GCM/ID 认证、原 ID 不覆盖、固定错误及双 false 不放宽；无生产 runner、恢复、消费者、自动 chmod/orphan 清理。

原 8 组测试正文保持；新增 6 组在真实自有私有目录/FD 注入故障，不预置业务成功状态：

| 实际副作用/故障 | 断言与接续 |
| --- | --- |
| 原生 hardlink 成功后丢 ACK | UNKNOWN，最终包保留；缺省维护 client 认证读回，相同原 ID/原包重放 already_stored，无新备份 |
| 原生目录 sync 成功后丢响应 | UNKNOWN，不假回成功；最终包保留并按原 ID 核对 |
| 原生 staging 写入半包后报错 | UNKNOWN，仅可核对本次 staging 清理；load 不可用，原 ID/原包可重试，不认部分文件为完成 |
| 真实发布后注入 unlink 拒绝 | final+pending 两链接，load INVALID；测试 owner 核 UID/dev/ino 后显式清自己的 pending，随后原包可读/重放，组件没有自动恢复 |
| 原生 link 后真实目录 chmod 0750 | UNKNOWN、load UNAVAILABLE，不自动修权限；测试 owner 显式恢复0700/核 inode清自己的pending后读回；调用者改 port 函数不改变构造时固定引用 |
| 原生 staging open 创建并 close 后丢 ACK | UNKNOWN，零字节 pending 保留，不扫描/消费；同原 ID/原包重新保存后最终包和 orphan 同时存在 |

unlink 拒绝为受控异常注入，非真实 OS 权限错误；另一组另有真实 chmod。sync 后丢响应不是 sync 失败或断电。合成 PGDMP 字节不证明 SQL/实际恢复/生产灾备/NFS/跨文件系统/掉电持久性/当前授权。manifest 仍敏感明文，key/plain dump 不落盘；仅自有新建目录最终按 inode/UID/非 symlink 精确清理，可由源码重建，日志保留。

## 作者实际证据与首轮诊断

证据 `artifacts/acceptance/product/B5/wp27-stage5-author`。首轮 13/13 业务组通过，但 check-first TS2322：仅 throw 的 async 推断 Promise<never>，不能再赋值原生 Promise<void> link。保留 first13-source.ts/unit-first.log/check-first.log；仅明确 DatabaseBackupFileIO 类型并由其上下文推断参数，没有改首13业务断言。再补 open ACK 丢失组后最终14/14 PASS、fail/skip0。

env:check 实际 Node24.16.0/项目管理路径/SQLite OK；check/lint/test/build exit0。根428=59TS+33Python+314BE+4EX+18Web，14已包含在根不再累加。旧crypto/inventory SQL/实际PG测试/93契约/迁移/依赖/lock/Web/Android/executor不变。本轮未启动服务或重跑实际PG，不将上一阶段PG12当本轮执行。非UI检查不替代Playwright/真机。

复现：`pnpm --filter @socialgrowth/product-backend exec tsx --test src/database-backup-file-store.test.ts`；根 `pnpm env:check`、`pnpm check:product`、`pnpm lint:product`、`pnpm test:product`、`pnpm build:product`。不依赖现有服务，不复用他窗资源。首错误为测试类型声明，不计产品缺陷或旧首红清零。

## 原窗口完整结果与接续

原QA B完整 `artifacts/acceptance/product/B5/20261001T094430Z-wp27-v2-1921/acceptance-report.md` 已全文读，SHA63cf830d99a93cbcb610baa48b30cd00f3686d2807933d1db41f584a5f43f279。原固定1921继承反例4=3PASS1RED仍为历史remaining1；仅覆盖c147两个清单文件的最小组合，同oracle4/实际PG12/真实declaration1首次过，组合new0/remaining0/QA新oracle0，有限双工程闭合。正确认证可带错声明，真实恢复后只读对照检出，不证明SQL来源/当前批准。自有容器卷快照已精确清理，旧报告/首失败/历史指纹不覆盖。

第四阶段固定525原非作者执行中，本阶段不混入；首自有快照导出缓冲区使安装零产品检查，另存日志并修其流式取证工具，进度非产品结论。完整结束后主窗口全文读/整改→原QA→原非作者本新固定批。已有报告仅读不重发，三窗口模式和授权不变；主窗口继续无依赖工程/汇报完整结论，不以发送作为停点。初次本阶段文档整包patch猜错memory标题，校验失败零文件落地；核对实际标题后重新精确补写，非产品失败。

四态：**通过**作者fs14/root428及静态；**失败**首TS2322保留、无本阶段业务RED、旧首红不改；**阻断**生产维护资源/父来源/管理员浏览器/SEC各对应范围；**未验证**本阶段原非作者/QA、实际PG本轮、断电/生产恢复/RPO-RTO/当前facts-fence/联合资源/Web/真机/全部开发ACG3。RES-WP27-01～03真实人工输入继续登记，Developeraf14/父pending1不变，服务Samsung授权不等于生产部署/公开发布。
