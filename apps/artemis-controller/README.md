# @socialgrowth/artemis-controller

基于 **Google Artemis** 的纯物理真机自动化群控与调度中枢。

---

## 一、 系统定位

作为 SocialGrowth 架构中的底层设备执行端（对应系统交付规格模块 6）：
- **100% 纯物理真机底座**：连接真实海外 Android 移动设备池（如 Samsung Galaxy S23 等纯真机），彻底排除并禁止使用任何模拟器或虚拟化容器；
- **平台范围收敛**：前期核心聚焦驱动 **Facebook**（Reels/视频）与 **YouTube**（Shorts/长视频）原生应用（Instagram 预留规范，待稳定后再接入）；
- **1:1 强绑定调度**：严格落实单台物理设备在同一平台内专属绑定单一账号（单机同时承载最多 1 FB + 1 YT），禁止跨设备借调与串号派发；
- **双向通信拓扑**：真机端通过 WebSocket/gRPC 建立客户端心跳并拉取（Pull）待执行任务，突破海外局域网防火墙；
- **全链路闭环证据**：自动捕获执行截屏证据流、坐标自愈修正日志（Self-healing Logs）与 Logcat 运行回执。

---

## 二、 模块结构

```
apps/artemis-controller/
├── src/
│   ├── types.ts          # 指令协议、设备状态、动作流契约与执行回执类型
│   ├── device-pool.ts    # 纯真机状态管理池（1:1 账号精确路由匹配）
│   ├── scheduler.ts      # 任务队列调度、看门狗超时自愈与执行驱动
│   └── index.ts          # 模块统一入口
├── config/
│   └── devices.example.json # 纯真机映射与专属平台绑定样例
└── package.json
```

---

## 三、 接口协议与动作流规范 (Action Protocol)

### 1. 任务下发指令 (`PublishTaskDirective`)

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskId` | `string` | 全局唯一任务标识符 |
| `platform` | `'facebook' \| 'youtube' \| 'instagram'` | 目标平台（前期激活 `facebook` 与 `youtube`） |
| `accountId` | `string` | 专属绑定的账号 ID（调度器严格匹配设备绑定的账号） |
| `targetAppPackage` | `string` | 原生 App 包名（如 `com.facebook.katana`, `com.google.android.youtube`） |
| `mediaDownloadUrl` | `string` | 云端对象存储生成的临时预签名切片视频下载地址 |
| `mediaSha256` | `string` | 视频文件完整性校验哈希值 |
| `captionText` | `string` | 拟定文案（针对平台差异化处理短链） |
| `shortLinkUrl` | `string` | 导流短链 |
| `steps` | `ActionStep[]` | 声明式端到端 UI 动作流列表（详见下文） |
| `taskTimeoutMs` | `number` | 硬超时阈值（默认 600,000ms 即 10 分钟） |

### 2. 声明式 UI 动作流契约 (`ActionStep`)

每个动作步骤必须遵循严格的结构化定义，支持元素定位自愈与容错：

```typescript
export type ActionType = 
  | 'LAUNCH_APP'        // 冷启动或前台调起目标应用
  | 'WAIT_ELEMENT'     // 等待指定 UI 元素出现
  | 'CLICK'            // 点击目标元素或指定比例坐标
  | 'INPUT_TEXT'       // 在目标输入框中填入文本/粘贴文案
  | 'SCROLL'           // 屏幕滑动 (UP / DOWN / LEFT / RIGHT)
  | 'SELECT_MEDIA'     // 在系统相册选择下载好的切片视频
  | 'ASSERT_TEXT'      // 断言屏幕中存在目标文字（用于验证发布成功）
  | 'HANDLE_2FA';      // 检测到双重认证时自动挂起并请求人工接管

export interface ActionStep {
  stepId: number;
  action: ActionType;
  description: string;
  // 选择器优先级：resourceId > accessibilityId > textRegex > fallbackCoordinate
  selector?: {
    resourceId?: string;          // Android View ID (如 com.facebook.katana:id/upload_btn)
    accessibilityId?: string;     // ContentDescription
    textRegex?: string;           // OCR 或 UI 节点文字正则匹配
    fallbackCoordinate?: {        // 基于屏幕分辨率百分比坐标 (0.0 ~ 1.0)
      xRatio: number;
      yRatio: number;
    };
  };
  payload?: {
    text?: string;                // 输入文本或文案
    scrollDirection?: 'up' | 'down';
    timeoutMs?: number;           // 单步超时（默认 15,000ms）
  };
  optional?: boolean;             // 是否为可选弹窗处理（如“允许通知”弹窗）
}
```

### 3. 执行回执 (`ExecutionReceipt`)
- `taskId`: 对应任务 ID
- `status`: `'completed' | 'failed' | 'waiting_human_takeover'`
- `publishedUrl`: 真实发布成功后的公开可核对 URL 或 Post ID（发布失败时为空）
- `screenshotPaths`: 关键节点（进入上传、文案填写、点击发布、发布成功展示）的截屏本地路径/云端路径
- `selfHealingLogs`: Artemis 动态修正元素定位或自愈处理的结构化日志
- `failureReason`: 失败错误码（如 `TASK_TIMEOUT_WATCHDOG_TRIGGERED`, `ELEMENT_NOT_FOUND`, `APP_CRASHED`）
- `challengeType`: 若进入人工接管状态，指定类型（`2fa_sms` | `2fa_email` | `device_verify`）

---

## 四、 看门狗自愈与本地开发守则

1. **Watchdog 超时强杀保障**：任务下发后启动 10 分钟硬超时计时器。若超时未收到正常完成回执，调度端主动下发保底恢复序列：
   ```bash
   adb shell am force-stop <targetAppPackage>
   adb shell input keyevent KEYCODE_HOME
   ```
   截取当前故障现场屏幕，任务标记为超时失败，安全释放设备占用。
2. **开发启动纪律**：遵循全局 [`CLAUDE.md`](../../CLAUDE.md)，本地环境不自动后台启动调度常驻进程，必须由开发者手动运行 `npm run dev` 配合调试。
