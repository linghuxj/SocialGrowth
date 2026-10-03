# 独立安全复核：H1 UID和安装恢复

- reviewer：`/root/adversary`
- base：`09765d8ca9c17beacc3ab6a5054c05c74659cf72`
- head：`a1aed365d056193048abdcb6428031b7160eb2ce`
- verdict：**changes_requested**。无新跨端契约，三文件范围。

## H1-RESTORE-01 / P2

`verify-network-admission-phone.mts` 的 finally 第99～120行把主APK恢复与测试APK恢复放在同一个try。若主恢复因为版本降级/签名等原因抛异常，已经替换的测试APK不会尝试恢复，残留诊断包。泛化的 packageRestoreFailed 不能说明哪个恢复步骤执行过。该路径正属于候选承诺处理的失败恢复边界。

独立从精确head提取finally，用只存在于审查者工作树的纯控制流探针替换ADB，无手机/网络操作；主恢复返回模拟安装拒绝。实际输出只包含 `install -r old-main.apk`，`restored=false`，`packageRestoreFailed=true`，没有 old-test.apk 调用。要求分别尝试主/测试恢复并记录各自结果，即使主恢复失败也不省略测试恢复。

补充：mainPackageInstallSucceeded来自恢复后可变的mainUpdated，成功安装后恢复会变成false，建议区分原安装成功与最终恢复状态，保留历史事实。

## 验证边界

独立从head提取UID helper/test到审查者私有目录，经项目 `pnpm exec tsx --test`：2/2通过，缺失/矛盾UID关闭。已完整读取三文件diff及脚本上下文。上述探针验证失败控制流，不替代真实安装恢复、11项手机协议、Playwright或业务验收。未读取/运行受保护脚本或私有配置。新head必须重审，旧批准不存在，不得据此开PR。
