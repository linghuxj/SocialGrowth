# 原生管理与手机准入协议固定补验 — 2026-10-04

原生业务 APK 来源为 `2517b08bdb31228315a4bba5489dcdcc5b5d390c`；管理端验收时 backend 实际构建来源 `7e12f5f`。协议诊断增量固定为 `076e9037aa8e3c4b2dd26cb13b7010ee2fcc20de`，独立审查批准仅覆盖该增量。后续计划工程已整合到 `7263a37a2bce303558817281891d269041c6aa9a`，不属于本次原生管理或协议验收来源，完整整合仍需另行冻结复核。

## 通过

- 独立 Android 模拟器 `emulator-5554`，Google Artemis 实际识别、决策与操作：双入口→管理注册空表单→返回→执行介绍→返回。没有创建安装身份、请求短信或发参与命令。会话 `da2c70f1-c93f-4b7d-ae61-302684540566`，进程退出 0。
- 同一模拟器实际原生页面：请求已有提供者的开发短信→通过受保护回环读取验证码→页面输入并登录→查看真实关联的 SM-S9110→设备详情→分佣→我的→设备。会话 `fb0ef4b8-4bd2-4299-bf17-94b8662bb71c`，Artemis 检查 5 通过、0 失败/不确定/未检查；主窗补充只读页面断言 5/5：仅管理、真实一台设备及型号、未知就绪状态、三页入口。只读数据库计数保持安装/关联各 1，控制命令/holder grant/任务 outbox 各 0。
- USB SM-S9110 / Android API36 的补充协议测试 11/11：真实手机 Tailnet→官方 Serve 的实际反向 socket 与 daemon 生命周期绑定→TLS→WhoIs 当前节点绑定；state 200，非法 body/protocol 400、错误凭证 401，缺正式 verifier 的 begin 503，未绑定 challenge/proof 403，最后 state 200 且未改变。此测试属于协议检查，不替代真实页面验收。
- 协议补验前后手机均无新鲜参与许可；没有发参与命令，network admission/action permission 始终 false。主 APK 使用 `install -r` 保留 UID/数据；成功这次保留候选主包、恢复原测试包，没有声称成功后回滚主包。

安全证据保存在仓库的 `artifacts/acceptance/team-lead-20261004/native-entry-artemis/acceptance.json`、`native-management-login/{acceptance,current-ui-assertions,postflight}.json` 和 `admission-protocol/correct-runner-attempt/`。私有手机号、验证码、Bearer、模型日志、目标文本及原包备份不提交。

## 失败及临时修正

- 早期 phone offline 后恢复在线；仅 CLI Online/WhoIs 或 Serve 配置就绪不能证明真实手机请求到达。
- `retry-ready`、`retry-stage-diagnostic`、`retry-progress-diagnostic` 探测失败保留。主窗重建时遗漏 `-PsgAdmissionApiChecks=true`，测试包注册的是默认 Runner；不能把这些失败归因于网络/TLS。失败尝试均恢复原主包及测试包。
- 增加安装后精确 Runner/target 核对、有限阶段与计数诊断、60 秒进程边界；正确 Runner 下才执行本次 11/11。未放宽来源、TLS、端口或准入校验，未改政策。
- 默认 Gradle home 的既有全局 mirror init 使一次构建失败；改用此前已有隔离 `GRADLE_USER_HOME=/tmp/socialgrowth-gradle-ux` 后通过，没有修改全局配置。

## 复现边界与命令

这些入口要求已存在的受保护本地配置、当前原安装身份、在线的同一手机、官方 Mac Tailscale 和未占用的 Serve 作用域；不得为了复现清空或伪造身份。先用 `mktemp -d artifacts/acceptance/team-lead-20261004/admission-protocol/repro.XXXXXX` 创建新的私有目录，在两个终端均将 `SOCIALGROWTH_VERIFICATION_OUTPUT` 设为该目录的绝对路径；不覆盖原验收目录。

```sh
cd product/android
GRADLE_USER_HOME=/tmp/socialgrowth-gradle-ux ./gradlew --no-daemon -PsgAdmissionApiChecks=true :app:assembleDebugAndroidTest
cd ../..
SG_PRODUCT_ADMISSION_PROTOCOL_CHECK=authorized SG_PRODUCT_ADMISSION_PROTOCOL_MINUTES=3 pnpm exec tsx scripts/run-network-admission-verifier-check.mts
```

verifier 在独立终端有限运行；确认实际 `Foreground` 内的 9443→127.0.0.1:4443 / PROXY v1 配置及启动元数据后，再由主窗串行运行：

```sh
SG_PRODUCT_ADMISSION_PHONE_CHECK=authorized pnpm exec tsx scripts/verify-network-admission-phone.mts
```

三分钟到期只清理该前台 Serve 子进程。补验使用现有 debug CA，不证明生产 TLS；证书到期后需重新满足既有证书前置。诊断 helper 的 strict NodeNext TypeScript 检查及 Gradle 正确 Runner 构建通过。

## 仍未验证 / 原阻断

真实短信送达、第二实体管理机/多提供者、多实体设备、原生控制/实际停止/恢复 producer、实际分佣或到账均未覆盖。H4/H5 的真实策略 CAS 下发、单调网络修订及受限网络共存/路径仍未完成；协议通过不关闭该阻断。RES-03、RES-04/11、RES-06/08/10 和原 SEC 窗口继续使用共享 ledger 的原记录，不新增同义阻断。未公开发布、撤下、开启正式准入、恢复 Samsung 参与或启动设备队列消费者。
