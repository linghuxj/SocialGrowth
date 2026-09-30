# Android 正式客户端

这是与 Demo 隔离的原生 Kotlin 工程边界。WP-00 固定 JDK 17、compile/target SDK 36、AGP 8.10.0、Gradle 8.11.1 和 Kotlin 2.1.20；AGP 8.10 支持 API 36。WP-04 已实现提供者受邀注册、原手机号登录、管理会话加密保存及退出；WP-05 实现扫码关联工程能力；WP-06 第三阶段实现管理端本人设备事实、只读详情／资料／登录帮助及执行端本机事实。工程存在不等于双机光学扫码或三端业务已验收。

`minSdk 27` 只是 WP-00 的临时工程下限，不代表已确认首期支持设备矩阵或兼容承诺；Android 业务开发前由 TL/AND/QA 根据真实设备资源固定支持范围并记录兼容证据。

已检入 Gradle 8.11.1 Wrapper。为避免开发机全局 Gradle 初始化脚本改变构建，干净验证可使用独立缓存目录：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug --no-daemon
```

WP-01 增加 `FirstBatchContractBoundary`：其版本、码制、状态及错误码规格由 `product/contracts` 的 Zod 源生成，Kotlin 边界严格拒绝旧版本、未知字段和矛盾状态。可用下列命令执行 JVM 契约消费检查：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android testDebugUnitTest --no-daemon
```

WP-04 Debug 构建固定访问 `http://127.0.0.1:4320`，只供本机开发及通过 `adb reverse tcp:4320 tcp:4320` 的 USB 真机联调；Release 构建禁止明文 HTTP，并从 `SG_PRODUCT_ANDROID_API_BASE_URL` 读取 HTTPS 地址。未配置时使用不可用占位域名，不会误连开发后端。开发验证码读取接口不属于客户端能力，Android 只调用公开的 challenge、verify、register、login 和 logout 接口。

受邀注册深链格式为 `socialgrowth://provider/register?invitation=<共享码>`。客户端不因收到深链就声称邀请已验证；服务端接受验证码请求后才显示“邀请已校验”。登录成功后的 session token 使用 Android Keystore AES-GCM 加密后保存在私有 SharedPreferences，过期或无法解密时失败关闭；退出成功会先撤销服务端 session，再清除本地密文。

管理端列表和详情重新读取服务端当前归属，不从本机或设计稿推断在线、平台授权、可接任务；执行端只展示本机的关联状态、更新时间和连接未知。资料及原号码不可用说明不自动提交换绑；管理退出仅撤销管理会话，不等于暂停或退出执行设备。

WP-08 阶段三的 `AdmissionContractBoundary`／`EnrollmentKeySigner` 为独立 CT-05 辅助层，尚未接 UI、HTTP 或网络策略。安装范围 P-256 密钥保留于 Android Keystore；签名缺钥不重建、不认领旧归属。生成器同时固定独立版本、UUID／时间／代次／节点边界；Kotlin 与 Node 的固定元组保留原 UUID 拼写、时间精度及 JSON.stringify 转义。调用方将来应持久保存原证明来重试，不能同请求键重新随机签名。

`src/androidTest` 的 `EnrollmentCryptoInstrumentation` 只检查本产品的 Keystore 与签名，不代替 Playwright、真机关联或 Artemis 业务验收。使用专属随机测试安装 ID，结束仅删除本次创建的两个密钥别名；不清 App 数据、不读取旧安装根凭据或管理令牌、不写网络。构建与运行命令如下，运行前确认手机及在途任务，APK 安装须有授权：

```sh
GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android assembleDebug assembleDebugAndroidTest --no-daemon
adb -s RFCW40MYYCV install -r product/android/app/build/outputs/apk/debug/app-debug.apk
adb -s RFCW40MYYCV install -r product/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s RFCW40MYYCV shell am instrument -w -r com.socialgrowth.product.test/com.socialgrowth.product.EnrollmentCryptoInstrumentation
adb -s RFCW40MYYCV uninstall com.socialgrowth.product.test
```

这是当前 Samsung 测试手机的可复现命令，不能视作 minSdk 27／其他机型兼容承诺。正式签名、首次实际网络来源核对、异常回收及 AC-11/12 仍须按交付记录补验。

构建和单元检查本身只证明 Android 契约消费层与 APK 可构建。WP-04 的真机注册／登录证据见 `docs/engineering/delivery/records/WP-04.md`；WP-06 第三阶段真机空设备检查及剩余双机／执行端验收缺口见 `docs/engineering/delivery/records/WP-06.md`。这些证据不证明真实短信、双机扫码、安装升级、正式签名或完整设备流程通过。

WP-09第一阶段新增`NativeEndpointDiscovery`（RequiresApi34）及`EndpointDiscoveryState`，仅主线程启动/停止的限时本机Wi-Fi NSD观察，不接MainActivity/后台service或任何配对/连接/上报。两种purpose分开，候选不授信任，冲突/未解析/失去/网络变化/旧generation与ticket安全关闭，结束不返回旧port；名字/地址只内存，实际全量Wi-Fi地址筛选不替代中心来源核验。调用方需检查API并在退后台时close，当前min27不是该层支持承诺。

`-PsgNativeDiscoveryChecks=true`只切换test APK runner为`NativeDiscoveryInstrumentation`，默认false仍用原EnrollmentCrypto；只允许true/false。用上述Gradle命令加该flag重建并核验实际test manifest，再运行`com.socialgrowth.product.test/com.socialgrowth.product.NativeDiscoveryInstrumentation`。该无UI补充检查不读session/keys，不打开媒体App、不上报、不配对，不是Playwright或完整业务验收。Samsung本轮6生命周期检查通过，connect/pairing都UNKNOWN；不能声称发现端口或首次配对通过。Debug/Release各28 JVM与APK/lint通过，原APK已恢复且本轮test包卸载；真实资源/细节/日志见[WP-09记录](../../docs/engineering/delivery/records/WP-09.md)。
