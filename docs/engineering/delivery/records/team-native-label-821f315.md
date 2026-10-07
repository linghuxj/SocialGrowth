# Android 本人设备备注与未知结果恢复补验

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

日期：2026-10-04。此记录仅覆盖本人设备备注；不作为整体 App、参与、执行或发布验收。

当前状态更新：后续跨登录补验的原 key 已成功保存临时备注 SESSION，设备版本为6；这一次临时备注尚未恢复。用户随后要求减少负载、禁止模拟器，主窗已关闭管理模拟器，USB真机在线且原执行端身份保留。下文第一批的版本5恢复记录仍是当时事实，不能描述为当前名称已经恢复。

固定 Android 源码为 `821f3156552fa85363cc7317d46378ba5f76c03f`，已获独立源码批准，主窗 Android main 与该候选逐字节一致。安装 APK SHA-256 为 `9e3515abd7d2e9ac6bc01f2517f575cbda6e9925d47bd12d2b373c1d3518412e`。页面操作使用自有 API 35 管理模拟器及 Google Artemis，服务源码为 `7e12f5f` 的自有回环 4320 实例。该实例的 provider label 接口与固定候选兼容；本记录不证明后来整合的计划接口。

## 实际结果

| 阶段 | 页面操作与结果 | 独立只读补充 |
| --- | --- | --- |
| 正向备注 | 实际输入临时名称 A、点击保存、显示成功，然后通过页面恢复原名称 | 设备版本 1→2→3，原名称恢复 |
| 传输中断 | 仅移除管理模拟器自己的 `tcp:4320` reverse；实际提交名称 B 后显示结果未知并锁定输入 | 原名称、版本 3 未变化，无原请求回执 |
| 进程重建 | 恢复自有 reverse；App 进程停止后，正确文本目标的 Artemis 重新进入管理页面与备注对话框，B 与未知请求冻结恢复 | checker 7 passed、无 unmet subgoals；持久记录仅含业务 body/metadata，不含会话凭据 |
| 当前事实核实 | 通过页面点击“核实当前事实”，显示当前事实尚未变化，保持冻结 | checker 3 passed；原 body/key 未变，原 key 回执仍为 0 |
| 原请求接续 | 通过页面点击一次“用同一请求重试”，服务端接受原请求 | checker 2 passed、2 inconclusive 如实保留；独立只读核对原 key 恰有 1 条 succeeded 回执、目标 B、版本 4 |
| 恢复 | 通过页面重新输入并保存原名称 | checker 2 passed；原名称为真、版本 5、未决命令 0、控制命令与 holder grants 均 0，关联仍为待完成准入状态 |

管理备注是可逆的业务元数据，测试后已恢复。没有在 USB 手机上安装本次备注 APK、操作暂停/恢复、恢复参与或触发设备队列；不能将元数据修改表述为执行准入完成。手机号登录此前使用受保护的开发验证码，不证明真实短信送达。

## 未通过与未验证边界

- 首次过长目标触及既有模型请求预算；拆成短的独立 Artemis 目标继续，没有扩大预算。首次未点击保存，原事实未变。
- 主窗新封装误将目标文件路径传给要求目标文本的 CLI，`unknown-reopen` 超时、`unknown-rebuild` 被终止；两次均为无效验收调用，排除业务验收。修正为读取私有目标文本后，`unknown-rebuild-text` 通过。无效运行保留，不用后来的成功覆盖。
- 原请求重试 checker 的两项 inconclusive 没有改成 passed；原 key 的成功回执只作为其明确范围的补充。尚未现场覆盖旧事实版本冲突、会话失效的页面文案；该工作包仍有验收缺口。
- 不能外推双真机、多个提供者、实际权限恢复、真机执行、正式签名升级或生产验收。

## 复现与证据

### 跨登录补验与最新设备约束

补验仍使用上文相同固定管理 APK 和 Google Artemis。实际离线保存 SESSION 后进入未知、expectedFactVersion5，原请求被冻结。实际退出管理登录 checker3passed，服务端只读核对撤销一条会话；持久原请求逐值不变。通过实际页面请求开发验证码并重新登录，checker2passed；新会话出现，原请求及冻结输入恢复。实际核实当前事实 checker2passed，原名称/版本5尚未变化且原key回执0。显式同一请求重试 checker3passed；只读核对恰有1条succeeded、目标匹配、版本6，控制命令和holder grants均0。这里的跨登录成功仅覆盖模拟器，不能改写为USB真机验收。

工作恢复时宿主服务和管理AVD已停止，主窗曾恢复原实例而不重置数据库；随后用户明确禁止模拟器，已关闭且不再启动。原请求重试在关闭前已经完成，未终止或篡改成功回执。USB `RFCW40MYYCV` / SM-S9110 已实际online，主App UID10377仍在，保留安装身份。当前App在存在执行端安装身份时走执行端入口，没有直接的提供者管理入口；不通过清除本机身份、重建关联或恢复参与来绕过。临时备注恢复继续列待处理，沿用独立管理设备资源边界；没有重置权限或放弃该事项。

初始长目标的预算失败、打开个人页checker2passed/2inconclusive保留；后续短目标未扩大预算。真实短信、native旧版本冲突、第二真机/异主与物理执行仍未验证。恢复服务使用原已构建backend产物及原33迁移，不以本次root新提交冒充重建运行源码。有限固定结果见 [跨登录摘要](../../../../artifacts/acceptance/team-lead-20261004/native-session-safe/summary.json)及[逐阶段结果](../../../../artifacts/acceptance/team-lead-20261004/native-session-safe/stages.json)。原目标、验证码、设备存储、日志及截图继续私有。

Artemis 命令使用 `integrations/google-artemis/.venv/bin/python -m artemis run`，传入实际目标文本，并指定 `--standalone --device-serial emulator-5554 --locked-app com.socialgrowth.product --profile pro --verification-level checkpoints --without-video-recording-tools`。服务地址和模型配置必须复用对应已加载的私有环境；本次串行运行，禁止固定手机点击脚本。原名称由实际页面/只读事实取得并私有保存，恢复时通过页面输入；没有后端业务调用或数据库预置结果。

阶段的有限 process/checker/UI/数据库证据及会话 ID 位于 [stage-results.json](../../../../artifacts/acceptance/team-lead-20261004/native-label-safe/stage-results.json)，摘要位于 [summary.json](../../../../artifacts/acceptance/team-lead-20261004/native-label-safe/summary.json)。原始目标、模型日志、截图、设备存储和配置保持私有，未纳入提交。
