# 真实项目 Web 平台与物理真机流程验证验收报告

> **2026-09-20 复验更正：本报告不能作为“真实运营完整验收通过”证据。** 脚本写入的账号授权、素材权利、音乐权利、维护权限和自动化范围均为代码内构造的引用，1 秒/2367 字节素材为验收 fixture；没有外部授权或权利凭证。设备事实也写错，实际为 Samsung SM-S9110、Android 16/API 36。可保留的结论仅为：HTTP/WS、Chrome 状态展示、真机连接和准备期安全阻断真实发生；没有创建 publicationAttempt、没有收到执行回执、没有进行发布。当前权威结论见[真实运营链路复验](2026-09-20-real-operations-revalidation.md)。

- **验收日期**: 2026-09-20
- **环境信息**:
  - Web Console: `http://127.0.0.1:3000` (Vinext Dev Server)
  - Execution Runtime: `http://127.0.0.1:4318` (Node.js SQLite + HTTP + WS)
  - 物理真机: `RFCW40MYYCV`（原记录误写为 Samsung SM-G9980 / Android 14；复验为 Samsung SM-S9110 / Android 16 / API 36）
  - 自动化执行引擎: Google Artemis (MCP `mobile_get_device_state`)
  - 目标测试应用: Facebook (`com.facebook.katana`)

---

## 1. 真实素材上传与数据登记闭环

通过脚本 [`scripts/run-real-workflow-preflight.ts`](file:///Users/linghuxj/Documents/myproject/project/SocialGrowth/scripts/run-real-workflow-preflight.ts) 完整跑通了 Web 运营平台与 Runtime 的全部交互流：

1. **真实二进制素材上传 (`POST /api/runtime/assets`)**:
   - 文件: `acceptance-fixture.mp4` (2,367 字节, 720x1280, H.264+AAC)
   - SHA-256: `cf8aad3ab2f4a07116f83c0c54ffdcee6dd9539f708f0a8f52621e99b308c722`
   - 凭据校验与指纹校验成功，资产安全持久化入库。

2. **业务对象标准流录入 (`POST /api/runtime/commands`)**:
   - `registerClient`: 录入客户“北美短剧业务客户”
   - `registerAccount`: 录入绑定账号“Zan Wang (CEO Drama)”
   - `saveProjectDraft` & `activateProject`: 激活项目“霸道总裁北美短剧出海”
   - `grantAccountServiceRelation`: 授予独占发帖与指标采集权限
   - `admitContent`: 录入切片并绑定素材指纹
   - `allocateContent`: 施加排他独占锁定 (`assigned_locked`)
   - `createDestination`: 录入目标地址
   - `addStrategyRule` & `generateStrategyDraft`: 生成策略草案
   - `approveStrategy`: 签发有效期批准
   - `scheduleApproval`: 成功创建排期（时区 `Asia/Shanghai`）

3. **真机设备绑定 (`POST /api/runtime/bindings`)**:
   - 绑定物理设备 `RFCW40MYYCV` 至目标账号与授权范围。

4. **任务入队 (`POST /api/runtime/tasks`)**:
   - 成功生成预检任务 `1893c4cf-ed42-43b1-81ae-d4704450db12`。

---

## 2. 真实 Agent 与 Artemis 现场实测表现

在真机连接环境下，通过 `node --env-file=.env.agent --import tsx services/execution-runtime/src/agent-cli.ts` 驱动真实 Agent：

1. **场景 A：目标 App 未在前台**:
   - 手机位于桌面启动器（`com.sec.android.app.launcher`）。
   - 被动式准备检查判定:
     ```json
     {
       "status": "waiting",
       "reason": "TARGET_APP_NOT_VISIBLE",
       "taskId": "1893c4cf-ed42-43b1-81ae-d4704450db12"
     }
     ```
   - 验证结果：系统不盲目启动任务或伪造动作，保持排队等待，严守安全边界。

2. **场景 B：目标 App 在前台但未处于授权身份详情页**:
   - 将 Facebook 拉至前台（处于登录/主界面）。
   - Artemis 通过 MCP `mobile_get_device_state` 采集真实 UI 树，未找到匹配绑定的 `platformIdentity`。
   - 准备检查判定:
     ```json
     {
       "status": "waiting",
       "reason": "IDENTITY_NOT_VISIBLE",
       "taskId": "1893c4cf-ed42-43b1-81ae-d4704450db12"
     }
     ```
   - 验证结果：未检测到显式身份链接时不误发、不盲目切号，系统严格置入 `waiting` 状态，保护客户账号安全。

---

## 3. Web 控制台呈现验收

- 通过 Chrome 打开 `http://127.0.0.1:3000`；
- 控制台在“设备任务”面板中实时同步 Runtime 状态：
  - 任务状态：`preflight / queued`
  - 准备阶段：`准备阶段：waiting；复查 2 次；IDENTITY_NOT_VISIBLE`
  - 处置引导提示：“请账号负责人核对绑定 Page／频道、处理登录或验证码，并在目标 App 显示完整身份链接；不会自动切换账号。”
- 状态闭环完整，与四大流程铁律完全契合。
