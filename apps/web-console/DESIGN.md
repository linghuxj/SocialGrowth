---
name: SocialGrowth Industrial Command
version: "1.0.0"
colors:
  primary: "#0F172A"
  secondary: "#475569"
  accent: "#2563EB"
  surface: "#F8FAFC"
  surface-card: "#FFFFFF"
  border: "#E2E8F0"
  status-online: "#10B981"
  status-warning: "#F59E0B"
  status-danger: "#EF4444"
  status-experiment: "#8B5CF6"
  status-shortlink: "#06B6D4"
  platform-fb: "#1877F2"
  platform-yt: "#FF0000"
  platform-ins: "#94A3B8"
typography:
  h1:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: "600"
    lineHeight: "2rem"
  h2:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: "600"
    lineHeight: "1.75rem"
  body-md:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: "400"
    lineHeight: "1.25rem"
  label-caps:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: "600"
    lineHeight: "0.875rem"
  code-log:
    fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: "400"
    lineHeight: "1rem"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  card-metric:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border}"
    padding: "16px"
  badge-status:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    fontSize: "0.75rem"
    fontWeight: "500"
  terminal-stream:
    backgroundColor: "{colors.primary}"
    textColor: "#E2E8F0"
    rounded: "{rounded.md}"
    padding: "12px"
---

## Overview

SocialGrowth Web 运营管理平台是面向海外真实社媒运营专员、技术审计人员的高密度工业级运营中枢（Industrial Command Center）。系统承载 Google Artemis 纯物理真机群控调度、独占式切片素材分发、经验规则与 AI 策略审核、导流短链分析、冷备风控置换以及小样本 A/B 策略实验评估。

整体设计拒绝轻浮无用的消费级大渐变与大圆角，采用紧凑、高信息密度、硬核严谨的工业控制台风格，确保单人运营人员在复杂矩阵场景下的高效巡检与低误触操作。

## Colors

色彩体系建立在高对比度的工程中性色与严格对应业务语义的状态色之上：

- **基底与框架 (Primary & Surface)**：
  - `Primary (#0F172A)`：冷色板岩深墨色，用于应用顶栏、侧边栏关键底色与代码日志背景。
  - `Surface (#F8FAFC)`：低饱和度中性灰，作为主内容面板背景，降低长时间巡检的视觉疲劳。
  - `Surface Card (#FFFFFF)`：纯白卡片表面，与浅灰底色形成清晰层级。
  - `Border (#E2E8F0)`：极细边框线，强化各面板边界。
- **核心操作色 (Accent)**：
  - `Accent (#2563EB)`：工业电光蓝，驱动关键按钮、激活菜单项与核心交互锚点。
- **业务语义状态色 (Semantic Statuses)**：
  - `status-online (#10B981)`：表示 Artemis 纯真机设备在线、心跳正常、策略晋级全量生效。
  - `status-warning (#F59E0B)`：表示切片素材排他独占锁定、策略待单人审核、冷备换号待人工确认。
  - `status-danger (#EF4444)`：表示账号风控限制、任务执行硬超时自愈强杀、域名被封拦截。
  - `status-experiment (#8B5CF6)`：表示 A/B 策略实验组标记与综合评分提升。
  - `status-shortlink (#06B6D4)`：表示导流短链有效跳转与归因事件。
- **平台标识色 (Platform Brand Colors)**：
  - `Facebook (#1877F2)`：Facebook 官方品牌蓝。
  - `YouTube (#FF0000)`：YouTube 官方品牌红。
  - `Instagram (#94A3B8)`：战略储备槽位，统一以低饱和度灰色描边展示，标识待后续接入。

## Typography

- **无衬线主界面字体**：统一采用 `Inter`（回退至 `-apple-system, BlinkMacSystemFont, Segoe UI`），字号梯阶紧凑，行高收紧以提升垂直方向的信息承载量。
- **等宽数据字体**：设备物理序列号（如 `dev-001`）、短链哈希、坐标数据、执行参数与 Logcat 回执 100% 采用 `JetBrains Mono` / `Fira Code` 等宽字体，避免数字错位。
- **文字层级**：
  - `h1 (1.5rem / 24px, 600)`：模块级页面主标题与关键统计大数。
  - `h2 (1.25rem / 20px, 600)`：区块标题与大卡片头部。
  - `body-md (0.875rem / 14px, 400)`：正文说明与通用表格内容。
  - `label-caps (0.6875rem / 11px, 600, UPPERCASE)`：表格表头与元数据徽标。
  - `code-log (0.75rem / 12px, 400)`：Artemis 端侧回执与审计证据。

## Layout

- **固定 App Shell 结构**：
  - 左侧固定宽 240px 紧凑侧边导航栏，支持 7 大交付模块与归档研究库直达。
  - 顶部固定高 52px 全局系统状态栏，常驻显示当前在跑物理真机总数（20/20）、在管账号数（40/40）、独占切片总数（3,078）与异常报警计数。
  - 中央自适应主工作区，采用响应式多列 Grid 网格布局。
- **高密度紧凑间距 (Compact Grid)**：
  - 模块内卡片间隙统一为 `16px (gap-4)`，表单与数据行间隙为 `8px (gap-2)`，消除不必要的虚浮留白。

## Elevation & Depth

- **拒绝大扩散投影**：系统严禁使用超过 `8px` 扩散的浅灰弥散阴影。
- **线条层级划分**：主要依靠 `1px solid #E2E8F0` 边框结合微弱阴影（`0 1px 2px 0 rgba(0, 0, 0, 0.05)`）实现物理层级区分，使界面清晰硬朗。

## Shapes

- 全局采用 `4px`（徽章、微型按钮）与 `6px`（卡片、弹窗、图表容器）微圆角（Subtle Rounded）。
- 杜绝 16px 以上的胶囊形或巨型大圆角，确保严谨的企业级软件手感。

## Components

1. **KPI 指标卡片 (MetricCard)**：
   - 包含大号核心数值、趋势百分比徽标、统计口径说明标签（如“按90%实现率”或“双轨保底”）。
2. **状态徽章 (StatusBadge)**：
   - 包含小圆点（Status Dot）与结构化文本，背景使用对应语义色的 10% 浅淡色填充，边框使用 20% 色彩描边。
3. **Artemis 终端流面板 (TerminalStream)**：
   - 纯真机 UI 步骤回执，等宽字体暗色渲染，支持展开查看坐标修复日志（Self-healing Logs）。
4. **切片素材独占排他锁 (ExclusiveLockPill)**：
   - 明确标注排他锁定状态与唯一绑定的账号 ID，鼠标悬停显示加锁时间戳。

## Do's and Don'ts

- **DO**：
  - 所有数据呈现必须标注数据源是社媒官方 API 还是第三方兜底服务。
  - 所有设备展示必须明确标注真机型号（`Samsung Galaxy S23`）与海外节点，杜绝模糊推断。
  - A/B 实验数据必须同时展示基线组与实验组的多维加权对照。
- **DON'T**：
  - 严禁在界面中出现任何与 Android 模拟器、虚拟机或云机相关的字段与配置。
  - 严禁设计跨账号切换登录的交互，严格遵循 1:1 设备账号物理隔离。
  - 严禁允许同一切片分配给超过一个账号。
