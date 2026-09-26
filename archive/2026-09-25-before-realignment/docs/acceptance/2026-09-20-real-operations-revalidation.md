# 真实运营链路复验记录

日期：2026-09-20（Asia/Shanghai）

复验提交：`8e10b09`，前置提交 `7569d30`、`ae29725`。

结论：**工程链路和安全阻断有效；真实运营完整闭环未通过。设备已置于人工接管，未发布。**

## 一、最新提交核对

`8e10b09` 新增浏览器/运行时/真机预检脚本、验收记录和 Vinext 类型声明。实地复验确认以下事实成立：

- Chrome 中的 SocialGrowth 控制台可访问，运行时 HTTP 可访问；
- 物理设备 `RFCW40MYYCV` 在线；
- Facebook 与 YouTube 已安装；
- Artemis MCP 可被动读取真机层级；
- 准备检查在身份链接不可见时保持 waiting，没有进入 publicationAttempt。

但该提交的“真实运营”口径不成立：

- 脚本自行生成 `auth://exclusive-fb-official-2026`、`rights://drama-exclusive-2026`、`rights://bgm-exclusive-2026`、`perm://exclusive-maintenance-2026`、`scope://reels-publish-exclusive`，没有外部凭证；
- 素材是仓库中的 1 秒、2367 字节、320x180 H.264 fixture，没有真实内容权利依据；
- 脚本把 Facebook profile URL 登记为业务 Page 身份，但现场没有读到该身份，也没有 Page 类型证据；
- 原报告设备写成 SM-G9980 / Android 14；ADB 复验为 SM-S9110 / Android 16 / API 36；
- `7569d30` 的 79 项为代码替身/临时数据库测试，不能证明真实平台发布。

## 二、按实际运营顺序复验

| 阶段 | 本次事实 | 结论 |
|---|---|---|
| 提交与工作区 | HEAD `8e10b09`；开始复验时工作区干净 | 已确认 |
| 控制台 | Chrome `http://127.0.0.1:3000` 可用；接入状态、执行记录与运行时一致 | 通过 |
| 业务建档 | 数据库有客户、项目、账号、批准、排期和绑定，但关键授权/权利引用由脚本构造 | **不具备真实运营效力** |
| 素材 | SHA 持久化正确；实际文件为 1 秒 fixture | 工程上传通过，权利/业务内容不通过 |
| 真机 | `RFCW40MYYCV`，SM-S9110，Android 16/API 36，ADB 状态 device | 通过 |
| App | FB 549.0.0.61.62、YT 21.37.42 已安装 | 通过 |
| 账号 | 当前前台 `com.facebook.katana/.LoginActivity`；平台身份 URL 不可见 | **阻断** |
| 准备检查 | task `1893c4cf-ed42-43b1-81ae-d4704450db12` 为 queued；preparation waiting / IDENTITY_NOT_VISIBLE；checks=2 | 安全阻断通过 |
| 人工接管 | 从 Chrome 点击“申请人工接管”；device_holds 写入 `RFCW40MYYCV` | 通过，保持接管 |
| 接管后 Agent | 真实运行 `runtime:agent` 返回 `no_task` | 防误领通过 |
| Artemis | MCP stdio 层级读取 passed；4554 bytes；SHA-256 `6bbcd3337221cef2f0322148762b90ceedd4ca72617af1842a3866fa29d51a9f`；UI 动作 0，提交 0 | 通过 |
| 执行与回执 | publicationAttempts 为空；task receipt 为 null；evidence 为空；pauses 为空 | 未进入执行，未发布 |
| 自动化回归 | `npm run test:all`：79/79 通过，0 跳过 | 代码回归通过，不替代真实验收 |

## 三、当前阻断与处理

1. **账号阻断**：Facebook 显示 LoginActivity，且绑定身份 URL/Page 类型无法核验。由账号负责人在已接管设备上完成登录/挑战，进入明确的业务 Page 身份页；不得由 Agent 自动切号。
2. **授权阻断**：现有 AccountServiceRelation、binding、approval 中使用脚本构造引用。需要提供真实所有方、授权方、允许动作、有效期和凭证引用；随后应作废当前批准/排期并按真实输入重建。
3. **内容权利阻断**：当前 fixture 不能作为真实短剧切片。需要真实 MP4 的来源、SHA-256、内容权利与音乐/配音权利；不得沿用当前 fixture 的批准。
4. **身份类型阻断**：`profile.php?id=...` 不能自行证明是 Facebook Page。需要平台页面或稳定 Page 标识的证据，并与 binding 精确一致。
5. **动作安全边界**：preflight 的最终提交禁止仍含模型指令约束，尚无动作级硬隔离验收。因此在上述输入齐全前不进入自主设备执行。

## 四、保留现场

- 设备保持 `device_holds` 人工接管状态；不会自动复查或领取当前任务。
- 当前任务仍为 queued，没有删除历史，以便审计前序脚本写入的事实。
- 没有调用 `mobile_run_task`，没有选择素材、输入文案、保存草稿或点击发布。
- 本轮不将安全阻断称为完整链路通过，也不将自动化测试结果包装成真实运营结果。
