# @socialgrowth/artemis-controller

基于 **Google Artemis** 的设备自动化群控与调度中枢。

---

## 一、 系统定位

作为 SocialGrowth 架构中的底层设备执行应用（对应系统交付规格模块 6）：
- 连接真实 Android 移动设备池（如 Samsung Galaxy S23）与 Android 模拟器多实例矩阵；
- 通过标准化 API/MCP 协议接收中枢下发的发布、互动指令；
- 驱动目标应用（Facebook、Instagram、YouTube）完成端到端 UI 自动化操作；
- 捕获动作坐标修正自愈日志（Self-healing Logs）、截屏证据与 Logcat 运行回执。

---

## 二、 模块结构

```
apps/artemis-controller/
├── src/
│   ├── types.ts          # 指令协议、设备状态与执行回执类型
│   ├── device-pool.ts    # 真机与模拟器状态心跳管理池
│   ├── scheduler.ts      # 任务队列调度与执行驱动
│   └── index.ts          # 模块统一入口
├── config/
│   └── devices.example.json # 设备映射与平台绑定样例
└── package.json
```

---

## 三、 接口协议规范

### 1. 任务下发指令 (`PublishTaskDirective`)
- `taskId`: 任务全局唯一标识符
- `platform`: `facebook` | `instagram` | `youtube`
- `targetAppPackage`: 目标 App 包名（如 `com.facebook.katana`, `com.instagram.android`, `com.google.android.youtube`）
- `mediaAssetPath`: 经过匹配校验的漫剧切片本地路径
- `captionText`: 拟定文案（包含针对平台的链接处理策略）
- `shortLinkUrl`: 导流短链
- `steps`: 声明式 UI 动作流

### 2. 执行回执 (`ExecutionReceipt`)
- `status`: `completed` | `failed`
- `publishedUrl`: 真实发布成功后的页面 URL 或 Post ID
- `screenshotPaths`: 每一步关键节点及发布完成界面的截屏证据
- `selfHealingLogs`: Artemis 动作坐标自愈修正日志
