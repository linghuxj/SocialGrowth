# @socialgrowth/artemis-controller

基于 **Google Artemis** 的纯物理真机自动化群控与调度中枢。

---

## 一、 系统定位

作为 SocialGrowth 架构中的底层设备执行端（对应系统交付规格模块 6）：
- **100% 纯物理真机底座**：连接真实海外 Android 移动设备池（如 Samsung Galaxy S23 等纯真机），彻底排除并禁止使用任何模拟器或虚拟化容器；
- **平台范围收敛**：前期核心聚焦驱动 **Facebook**（Reels/视频）与 **YouTube**（Shorts/长视频）原生应用（Instagram 预留规范，待稳定后再接入）；
- **1:1 强绑定调度**：严格落实单台物理设备在同一平台内专属绑定单一账号（单机同时承载最多 1 FB + 1 YT），禁止跨设备借调与串号派发；
- **双向通信拓扑**：design-v1 选择 WebSocket Pull 作为唯一传输方向；当前提交实现共同载荷与调度边界，真实 Agent 连接仍待真机联调；
- **全链路闭环证据**：自动捕获执行截屏证据流、坐标自愈修正日志（Self-healing Logs）与 Logcat 运行回执。

---

## 二、 模块结构

```
apps/artemis-controller/
├── src/
│   ├── types.ts          # 指令协议、设备状态、动作流契约与执行回执类型
│   ├── device-pool.ts    # 纯真机、平台、账号与指定设备精确路由
│   ├── scheduler.ts      # 去重、资格校验、回执合并、暂停与恢复边界
│   ├── execution-adapter.ts # 未接入时明确阻断，不构造成功
│   ├── receipt-store.ts  # 受控内存与 JSON 文件回执存储适配器
│   └── index.ts          # 模块统一入口
├── config/
│   └── devices.example.json # 纯真机映射与专属平台绑定样例
└── package.json
```

---

## 三、 接口协议与动作流规范 (Action Protocol)

当前源码已采用 design-v1 共同类型。它完成受控调度语义，不表示真实 Agent、原生 App 动作或真实发布已经接入。

| 当前源码类型 | 实际字段/枚举 | 接入边界 |
| --- | --- | --- |
| `PublishTaskDirective` | design-v1 的项目、策略、批准、绑定、指定设备/账号、共同内容身份、文件校验、目的地、排期/时区和动作步骤 | 真实中枢必须注入当前资格校验器；真实 Agent 尚待接入 |
| `AutomationStep` | `stepIndex`、`action`，可选 `targetSelector`、`coordinates`、`value`、`timeoutMs`；动作为 `open_app/navigate/click/input_text/select_media/scroll/wait` | 不使用旧 README 大写 `ActionStep` 定义；挑战在目标回执中处理 |
| `ExecutionReceipt` | 技术状态、独立发布事实、证据、资源状态及结构化失败/挑战码 | 未配置执行器返回 `not_submitted/EXECUTOR_NOT_CONFIGURED`，不伪造发布成功 |

### 目标开发契约 design-v1

实现遵循[执行契约](../../docs/engineering/execution-contract.md)：同一 task/attempt 去重，技术异常记录为 `unknown`，迟到公开证据只补记历史，挑战后的恢复同时核对挑战、授权和排期。JSON 文件存储可用于单进程受控持久化；生产部署仍需接入权威数据库事务。

[数据模型](../../docs/engineering/data-model.md)说明内容身份、发布尝试与授权关系；[离线验证规格](../../docs/engineering/offline-verification.md)定义可控替身及正常/异常断言。实现时一起更新 types、调度、端侧与测试；受控验证不替代真实设备和平台证据。

---

## 四、 看门狗自愈与人机协同守则

1. **常见弹窗轻量自愈**：动作流包含对常见系统弹窗（权限申请、通知、评分提示）的识别自愈步骤，执行自动点击跳过或关闭。
2. **阻断性异常人机协同**：身份验证与平台限制分别判断，按 G-04a 暂停受影响及关联安排并通知运营；非值守进入待办，不承诺即时接管。挑战过期重新处理，恢复须人工核对异常、发布结果、授权和排期，不能只因输入验证码自动恢复。
3. **执行超时的业务边界（G-04a）**：既有 10 分钟参数仅描述技术执行超时，不是人工响应期限；以下旧复位命令示例不证明发布失败、未提交或已经可恢复业务：
   ```bash
   adb shell am force-stop <targetAppPackage>
   adb shell input keyevent KEYCODE_HOME
   ```
   保留必要证据并核对发布结果；结果未知不再次提交或释放内容，设备资源恢复与业务恢复分别判断。非值守只继续确认无关联且批准有效的安排，相关恢复经人工核对，过期任务不自动补发。
4. **经授权的资源重新安排**：先区分登录挑战、功能限制、内容争议与账号终止，核对平台许可、账号授权及未知发布结果，再决定是否安排备用资源；账号终止不自动触发换号继续运营。以下旧命令示例仅清理应用数据，不证明消除关联、解除限制或取得新账号运营许可：
   ```bash
   adb shell pm clear <targetAppPackage>
   ```
5. **开发启动纪律**：遵循全局 [`CLAUDE.md`](../../CLAUDE.md)，本地环境不自动后台启动调度常驻进程，必须由开发者手动运行 `npm run dev` 配合调试。
