# WP-08 阶段三：Android 安装持钥与严格签名消费

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

更新：2026-09-30。前置持久层整改 `95a6c25` 仍由原非作者窗口复核；本阶段从其建立独立执行分支 `feature/wp-08-installation-key-stage3`。沿用 [WP-08 任务卡、R/AC 及资源表](WP-08.md)、[质量手册](../quality-gates.md)。AND 主责实施由 Codex 阶段代理承担，BE/EX 对齐签名元组，OPS 提供后续可信来源和策略资源，原复核／QA 窗口分别核对。实名人工与兼容机型矩阵待落实，不虚构签署。

## 工程交付与排除范围

- Android 安装 ID 范围的 P-256/SHA-256 Keystore 密钥：首次准备生成，重复准备复用；算法与曲线独立核对。签名时缺失密钥失败关闭，不静默重建旧接入身份。没有导出私钥或把签名／挑战写入日志。
- 独立 CT-05 生成规格与严格挑战消费：版本／用途、未知字段、UUID、代次字符串、节点 ID／密钥／安全整数修订和精确时间顺序。时间保持任意小数精度与原始偏移，当前身份和接入代次必须完全一致。
- Kotlin 与 Node 使用同一固定有序 JSON 元组；原 UUID 大小写和时间拼写保留，斜杠、U+2028、代理对／孤立代理及控制字符按 JSON.stringify 编码。两端相同黄金 SHA-256 用例持续守住签名域；DER 正整数转 IEEE-P1363 的 `r||s` 固定为 64 字节。
- 生成防漂移同时检查 JSON、B1 Kotlin、CT-05 Kotlin 三个产物；未知 schema 约束／字段或共享字段分歧会拒绝生成，不静默忽略。旧 B1 载荷版本、原生成规格和界面不改变。
- 新增原生密码学补充检查 runner：只针对本产品自有 Keystore，使用两个随机测试安装 ID，验证缺钥拒绝、密钥复用、不可导出、独立公钥验证和旧代次／错安装／过期拒绝，最终仅清理自身测试密钥。不是其他 E2E 验收套件，不打开媒体 App，不生成归属、就绪、联网成功或业务发布事实。
- 尚未把辅助层接入 MainActivity、安装持久接入状态或 CT-05 HTTP。未来调用层须缓存原证明及幂等键，丢响应时原样重试；ECDSA 随机重签不等同原载荷。服务端仍须独立核对当前安装资格及真实来源，不能因为本机签名成功开放网络。

本阶段无页面变化，不新增／替换参考图与提示词。后续界面仍须按页面规格及已选设计索引实现，不能拿黄金夹具的设备名称或状态当产品事实。

## 验证记录

最终本地 `pnpm env:check` 为 Node 24.16.0／SQLite OK；`check:product`、`lint:product` 和 `test:product` 98/98（契约30＋Python9＋Backend41＋executor4＋Web14）通过；Android Debug／Release JVM 各16/16，Debug APK／androidTest APK／lint通过。Gradle 使用局部 `JAVA_HOME=/Users/linghuxj/Library/Java/JavaVirtualMachines/jbr-17.0.9/Contents/Home`、`GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle`，不改变全局环境。文档结构检查通过，仅结构范围。

已获默认真机联调授权。运行前核对 Samsung SM-S9110／Android16／`RFCW40MYYCV`，本产品无活跃进程、4320／3100无服务；原`qm-dev-postgres`和`minio-test`未动。覆盖安装 Debug 和测试 APK，没有清数据／卸载原产品。补充 native crypto runner 重跑原始输出：`passed=10`、`failed=0`、`testKeysRemoved=true`、`INSTRUMENTATION_CODE=-1`。测试结束只卸载 `com.socialgrowth.product.test`，测试包及其数据可从已构建APK重新安装；保留原产品和数据。详细命令、APK指纹及断言见[实施自检报告](../../../../artifacts/acceptance/product/B2/20260930T0406Z-wp08-stage3-self/crypto-report.md)。这不是非作者 QA，也不证明真实关联／准入。

阶段三非作者复核、独立 QA 和真实网络业务均待固定提交后对应原窗口确认。缺真实 tailnet／多机资源如实记录；不能把密码学补充检查扩成 AC-11/12 或兼容矩阵通过。

最终另运行同一局部环境的 `assembleRelease lintRelease --no-daemon`，44秒退出成功；Release APK／lint通过（未签正式分发密钥、未安装Release），不外推生产签名或更新兼容。

## 资源缺口及继续工作

RES-WP08-01 独立核验服务、受控 tailnet 权限、叠加 ACL／Grants、中心／出口节点仍未提供；没有真实策略写入。RES-WP08-02 多实体手机／第二提供者仍缺，双机真实归属与交错绑定未验证。RES-WP08-03 现有 Samsung 可做局部 Keystore 补充检查，最低系统／支持矩阵、真实来源配对与旧节点回收仍待 AND/EX/OPS。各项最晚时点、解除条件和补验动作沿用任务卡，不以延期作为完成。

下一可独立工程是期限扫描、事务回收、可信来源接口与失败封闭边界；WP-11 统一许可、WP-14 最小项目、WP-20 无项目待办按编码依赖领取。未经真实校验的网络副作用与业务执行继续关闭，但不因人工或网络资源未到停止这些工程工作。
