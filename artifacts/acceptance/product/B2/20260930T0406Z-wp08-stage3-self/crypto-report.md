# WP-08 阶段三实施窗口持钥补充检查

2026-09-30；执行分支 `feature/wp-08-installation-key-stage3`，基线`95a6c25`，本报告对应随后凝聚提交内的实现。实施自检，不代替非作者复核或正式 QA。

环境：pnpm8.14.0、项目Node24.16.0（env:check实际路径 `/Users/linghuxj/Library/pnpm/nodejs/24.16.0/bin/node`，SQLite OK）、JBR17.0.9、隔离Gradle缓存`/tmp/socialgrowth-product-gradle`；Samsung SM-S9110 Android16，USB序列号`RFCW40MYYCV`。本产品进程运行前为空；产品3100/4320无监听，未启动业务服务，未消费队列，原其他容器未动。

命令：

```sh
pnpm check:product
pnpm lint:product
pnpm test:product
JAVA_HOME=/Users/linghuxj/Library/Java/JavaVirtualMachines/jbr-17.0.9/Contents/Home GRADLE_USER_HOME=/tmp/socialgrowth-product-gradle product/android/gradlew -p product/android testDebugUnitTest testReleaseUnitTest assembleDebug assembleDebugAndroidTest lintDebug --no-daemon
adb -s RFCW40MYYCV install -r product/android/app/build/outputs/apk/debug/app-debug.apk
adb -s RFCW40MYYCV install -r product/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s RFCW40MYYCV shell am instrument -w -r com.socialgrowth.product.test/com.socialgrowth.product.EnrollmentCryptoInstrumentation
adb -s RFCW40MYYCV uninstall com.socialgrowth.product.test
```

Debug APK SHA-256 `88596062dcadc5ad2a38d5ec084767662e45a7f362a992a628f2a394685047bc`；测试APK SHA-256 `354394c9aeb719daa9b4cc749ad5eb549e3448ddf633ed716467356790fa362f`。源改动后须重新构建／固定指纹，不能外推本次产物。

补充检查通过：产品98/98（30+9+41+4+14）、Android Debug16/16、Release16/16、类型/lint及Debug/test APK。JVM持续覆盖黄金签名元组、任意时间精度、错身份／代次、未知字段、错协议、非法DER及40次真实JDK P256签名的独立P1363验证；P384拒绝。

真机10断言：缺失密钥签名拒绝；同安装多实例复用公钥；私钥encoded为空；缺钥路径不新建别名；签名解码64字节；独立SPKI公钥与ASN.1编码后验签成功；错误接入代次拒绝；错误安装ID拒绝；到期拒绝；拒绝后公钥未替换。两次runner输出摘要一致，第二次`-r`原始结果：

```text
INSTRUMENTATION_RESULT: failed=0
INSTRUMENTATION_RESULT: passed=10
INSTRUMENTATION_RESULT: stream=Native enrollment crypto checks: 10 passed; no business admission asserted.
INSTRUMENTATION_RESULT: testKeysRemoved=true
INSTRUMENTATION_CODE: -1
```

最终卸载测试包成功，`pm list instrumentation`无本runner，测试随机别名由runner finally删除。没有清产品数据、处理真实安装凭据、截图秘密、写网络、关联身份或触发媒体业务。仅自有密码学补充检查，无新业务UI，因此未用它替代Playwright或固定脚本模拟Artemis。

随后同一局部环境单次 `assembleRelease lintRelease --no-daemon` 44秒退出成功，Release未签正式分发密钥且未安装，不证明分发更新。

失败0；资源阻断：实际tailnet策略／独立来源服务和多机。未验证：Android最低版本/机型矩阵、密钥硬件安全等级与升级恢复、真实归属→Keystore持钥→可信源准入、撤权、HTTP或业务UI、AC11/12和B2G3。独立QA及原窗口固定提交复核待后续。
