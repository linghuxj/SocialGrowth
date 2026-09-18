# SocialGrowth 开发规范与工程基准指南 (CLAUDE.md)

欢迎参与 SocialGrowth 核心工程研发。本文档为仓库全局开发规范与架构准则的**最高指导原则**，所有研发人员与协作 Agent 在执行任何编码、重构或调试任务前必须严格阅读并遵循。

---

## 一、 核心架构五大铁律（强制执行）

任何代码实现、接口定义与架构设计严禁违反以下既定业务基线：

1. **执行底座锁定**：
   - 100% 采用 **Google Artemis 纯物理真机设备池**（如 Samsung Galaxy S23 等）；
   - **彻底废除并严禁引入任何 Android 模拟器或虚拟化实例**；
   - 内容发布与端侧交互必须驱动原生 App 走端到端 UI 自动化，不采用官方发布 API。
2. **阶段平台收敛**：
   - 前期核心阶段仅开放 **Facebook (FB)** 与 **YouTube (YT)** 双平台；
   - **Instagram (INS)** 作为战略储备平台，系统预留接口枚举与槽位，但在前 3 个月业务周期内**禁止引入对 INS 的硬性运行依赖**。
3. **1:1 设备账号强绑定（单机跨平台隔离）**：
   - 单台真机在同一时期内，同一平台仅登录并绑定 1 个专属账号（单机承载上限为 1 个 FB Page + 1 个 YT 频道）；
   - **严禁在同一 App 内切换多个账号**，从物理层杜绝设备与网络指纹关联风险。
4. **切片素材排他独占锁（Exclusive Lock）**：
   - 漫剧切片资产经人工确认后，系统强制加注唯一目标账号独占锁；
   - **严禁同一切片跨账号重复分发**，从源头根除搬运与低质降权。
5. **数据双轨采集与保底降级**：
   - 数据采集优先官方 Insights/Analytics API，若受限或审批延迟，必须无缝切换至第三方社媒数据服务；
   - A/B 策略评估算法在缺失私有完播曲线时，必须具备自动降级为公开互动指标（播放、点赞、评论、分享）的加权评分机制，严禁因缺字段抛出致命异常。

---

## 二、 本地开发与运行纪律

> [!CAUTION]
> **严禁在本地环境下由自动化工具/Agent 主动启动常驻后台服务！**
> 本地环境的所有服务（如 `npm run dev`、守护进程启动、常驻测试服务等）均由人类开发者**手动启动与调试**。测试脚本与构建验证必须执行单次运行并正常退出的命令（如 `npm run build`、`npm test`、`python3 script.py`）。

---

## 三、 代码风格与开发标准

### 1. TypeScript / JavaScript 规范
- **严禁泛滥使用 `any`**：所有业务实体、API 入参及出参必须定义明确的 `interface` 或 `type`。
- **严格空值检查**：开启 `strict: true`，所有可选字段使用可选链操作符（`?.`）与空值合并操作符（`??`）。
- **统一枚举命名**：使用字符串联合类型（Union Types，如 `'facebook' | 'youtube' | 'instagram'`）替代原生 TypeScript `enum`，确保序列化的一致性与简洁性。
- **异步处理**：所有 I/O 操作统一采用 `async/await`，必须包裹 `try/catch` 并输出结构化错误上下文，严禁裸奔 Promise 导致未捕获异常崩溃。

### 2. Python 脚本规范
- 统一使用 Python 3.10+，脚本必须包含类型注解（Type Hints）；
- 涉及数据生成、测算模型的脚本必须具备命令行参数解析（`argparse`）与清晰的标准输出日志；
- 数据输出统一使用 UTF-8 编码格式的 JSON 或 Markdown。

### 3. Git 提交与分支规范
- **分支命名**：
  - 特性开发：`feature/<task-id>-<description>`（例如 `feature/task-01-scheduler-route`）
  - 缺陷修复：`fix/<issue-id>-<description>`
  - 规范重构：`refactor/<scope>-<description>`
- **Commit Message 格式**：
  `[<模块名>] <动作>: <简明说明>`（例如 `[artemis-controller] fix: 严格限制 1:1 设备账号路由，杜绝串号派发`）。

---

## 四、 仓库工程架构导航

```
SocialGrowth/
├── apps/                               # 终端应用与人机界面层
│   ├── web-console/                    # 统一现代 Web 运营管理控制台 (Next.js + shadcn UI)
│   └── artemis-controller/             # Artemis 纯真机群控调度端
├── services/                           # 核心中枢与计算服务层
│   ├── ai-engine/                      # AI 策略生成、规则解析与 A/B 评估中枢
│   └── shortlink-service/              # 导流短链服务 (302 跳转、三层日志与爬虫过滤)
├── docs/                               # 权威规划与交付规范
│   ├── delivery-specification.md       # 【核心基准】7 大核心交付模块与系统规格说明书
│   ├── business-requirements.md        # 业务需求与技术规划讨论全记录
│   ├── monthly-delivery.md             # 连续 12 个月逐月交付表与里程碑
│   ├── budget-summary.md               # 年度五类技术预算汇总
│   ├── platform-rules.md               # 平台官方规则核查记录
│   └── handoff/                        # 研发交接台账与整改任务看板
├── scripts/                            # 自动化脚本层 (数据测算与报告构建)
├── artifacts/                          # 最终成果物输出 (数据模型与正式汇报文档)
├── CONTEXT.md                          # 全局业务术语表与边界约定
└── CLAUDE.md                           # 本规范文档 (开发最高准则)
```

---

## 五、 核心基准文档索引

- 7 大交付模块完整规格：[`docs/delivery-specification.md`](docs/delivery-specification.md)
- 研发交接任务书与整改看板：[`docs/handoff/README.md`](docs/handoff/README.md)
- 业务术语字典：[`CONTEXT.md`](CONTEXT.md)
- 测算数据基准：[`artifacts/data/3至20台真机设备-前三个月发布与准入测算.md`](artifacts/data/3至20台真机设备-前三个月发布与准入测算.md)
