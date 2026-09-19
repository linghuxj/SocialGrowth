# SocialGrowth

面向企业提供内容生产与媒体运营自动化增长能力的核心工程仓库。前 3 个月聚焦于已有 AI 漫剧切片的高精度独占分发、核心双平台（Facebook / YouTube）自动化运营闭环以及基于 Google Artemis 的 100% 物理真机自动化调度（Instagram 待稳定后接入）。

上述月份与资源安排属于商业交付计划。产品面向最终业务目的分阶段构建，数量、增长结果及商业验收不限制开发方式与能力范围。当前文档入口：

- [产品能力与阶段开发路线](docs/product-roadmap.md)：能力依赖、并行推进与真实运营启用边界。
- [阶段推进与交接计划](docs/handoff/2026-09-19-product-stage-plan.md)及[首条业务闭环规格](docs/product-first-loop-spec.md)：四批成果、16 项产品工作与首批使用流程。
- [业务需求](docs/business-requirements.md)与[业务流程及决策记录](docs/handoff/2026-09-19-business-flow-proposal.md)：当前生效需求和用户确认。
- [业务审计处理结果](docs/handoff/2026-09-19-business-audit-closure.md)：12 组业务问题、原 45 项发现的逐项处理。
- [月度商业交付](docs/monthly-delivery.md)与[预算](docs/budget-summary.md)：商业目标和投入；[年度访谈](docs/annual-plan.md)保留历史追溯。
- [Handoff 台账](docs/handoff/README.md)：既有研发任务及其状态；文档更新不代表实现完成。

---

## 一、 系统架构拓扑

```mermaid
flowchart TD
    subgraph UI ["人机协同与终端应用层 (apps/)"]
        WC["web-console<br>(统一现代 Web 运营管理控制台)"]
        AC["artemis-controller<br>(设备自动化群控调度端)"]
    end

    subgraph Service ["核心中枢与独立服务层 (services/)"]
        AI["ai-engine<br>(AI 策略生成、规则推理与 A/B 评估中枢)"]
        SL["shortlink-service<br>(导流短链与归因分析服务)"]
    end

    subgraph Infra ["基础设施与持久化存储层 (infra/)"]
        DB[("核心关系型业务库<br>(PostgreSQL: 账号/策略/任务/切片锁)")]
        REDIS[("缓存与高频日志<br>(Redis: 短链点击/排他锁/心跳)")]
        S3[("对象存储<br>(S3/MinIO: 切片视频原片/截屏证据)")]
    end

    subgraph Execution ["设备硬件底座 (海外物理分散部署)"]
        DEV["海外物理纯真机设备池<br>(Samsung Galaxy S23 等，彻底排除模拟器)"]
    end

    WC -->|人机确认 / 规则配置 / 监控大屏| AI
    WC -->|短链配置与点击查询| SL
    AI -->|下发标准化策略指令 (API/MCP)| AC
    AI <-->|读写账号画像/规则版本/策略快照| DB
    SL <-->|点击流写入与跳转校验| REDIS
    AC -->|安全拉取预签名素材| S3
    DEV -->|WebSocket/gRPC Pull 模式建立心跳与拉取任务| AC
    DEV -->|驱动原生 App UI 自动化执行| DEV
    DEV -->|上报截屏证据 / 自愈日志 / 执行回执| AC
    AC -->|执行状态上报与归档| WC
    AC -->|持久化任务与执行证据| DB
```

---

## 二、 仓库目录结构

本仓库采用模块化分层（Monorepo）结构组织：

```
SocialGrowth/
├── apps/                               # 终端应用与人机界面层
│   ├── web-console/                    # Web 运营管理控制台 (Next.js + shadcn UI)
│   │   ├── app/                        # 页面路由（数据大屏、工作台、策略看板）
│   │   ├── components/                 # 核心 UI 组件库
│   │   └── package.json                # 包名: @socialgrowth/web-console
│   │
│   └── artemis-controller/             # Google Artemis 设备自动化群控调度端
│       ├── src/                        # 调度器、纯真机连接池、UI 驱动器
│       ├── config/                     # 设备绑定映射配置示例
│       └── package.json                # 包名: @socialgrowth/artemis-controller
│
├── services/                           # 核心中枢与计算服务层 (AI 与独立能力服务化)
│   ├── ai-engine/                      # AI 策略生成与规则推理中枢
│   │   ├── prompts/                    # 策略拟定、经验规则解析提示词模板
│   │   ├── src/                        # 标签匹配算法 (Tag-to-Profile)、冲突检查器
│   │   └── package.json                # 包名: @socialgrowth/ai-engine
│   │
│   └── shortlink-service/              # 导流短链与归因分析服务 (模块 4)
│       ├── src/                        # 302 重定向、事件流埋点、爬虫过滤
│       └── package.json                # 包名: @socialgrowth/shortlink-service
│
├── docs/                               # 权威规划与规范文档
│   ├── delivery-specification.md       # 【核心基准】7 大核心交付模块与规格规划书
│   ├── business-requirements.md        # 业务需求与技术规划讨论记录
│   ├── monthly-delivery.md             # 年度月度交付表 (逐月里程碑与验收标准)
│   ├── budget-summary.md               # 年度技术预算汇总 (五类技术支出)
│   ├── platform-rules.md               # 平台规则核查记录 (FB / IG / YT)
│   ├── annual-plan.md                  # 年度规划访谈全记录
│   └── handoff/                        # 【研发交接台账与对齐规格看板】
│       ├── README.md                   # 全局事项状态总览表与交接导航
│       ├── 2026-09-19-aligned-business-spec.md # 业务功能确认与需求细节对齐规格书
│       └── 2026-09-18-developer-handoff.md    # 研发交接与审计整改任务书
│
├── scripts/                            # 研发与工具脚本层
│   ├── ceo_report/                     # CEO 汇报文档自动化构建工具
│   │   ├── build_report.py
│   │   ├── update_sources.py
│   │   └── fonts.conf
│   └── analytics/                      # 业务与发布容量测算工具
│       └── calc_launch_capacity.py     # 前 3 个月发布测算数据生成器
│
├── artifacts/                          # 最终成果物归档（纯净输出）
│   ├── reports/                        # 独立汇报文档与 HTML 离线报告
│   └── data/                           # 测算模型与基准 JSON 数据
│
├── CONTEXT.md                          # 业务术语表与全局边界约定
└── README.md                           # 全局工程导航文档
```

---

## 三、 7 大核心交付模块映射

首期商业交付的核心能力按如下 7 个模块组织；跨模块产品流程及后续能力见独立产品路线（详见 [docs/delivery-specification.md](docs/delivery-specification.md)）：

1. **模块 1：账号资产与定位管理模块**（`apps/web-console` + `services/ai-engine`）
2. **模块 2：已有切片素材管理与智能匹配模块**（`services/ai-engine/src/matching-engine.ts`）
3. **模块 3：策略引擎与单人辅助工作台**（`services/ai-engine/src/rule-parser.ts` + `apps/web-console`）
4. **模块 4：导流短链服务**（`services/shortlink-service`）
5. **模块 5：账号异常与风控管理模块**（`apps/web-console`）
6. **模块 6：Artemis 设备自动化执行与调度模块**（`apps/artemis-controller`）
7. **模块 7：数据采集与 A/B 策略优化闭环模块**（`services/ai-engine` + `apps/web-console`）

---

## 四、 快速使用指引

> [!NOTE]
> 根据项目最高开发准则 [`CLAUDE.md`](CLAUDE.md)，本地开发环境所有服务均由开发者手动按需启动，严禁自动化脚本自行后台驻留。

### 1. Web 运营控制台 (`apps/web-console`)
```bash
cd apps/web-console
npm install
npm run dev        # 手动启动 Web 控制台开发服务器
npm run build      # 编译构建生产版本
```

### 2. Artemis 设备群控服务 (`apps/artemis-controller`)
```bash
cd apps/artemis-controller
npm install
npm run dev        # 手动启动调度控制服务
```

### 3. AI 策略引擎 (`services/ai-engine`)
```bash
cd services/ai-engine
npm install
npm run build      # 编译 TypeScript 模块
```

### 4. 导流短链服务 (`services/shortlink-service`)
```bash
cd services/shortlink-service
npm install
npm run build      # 编译 TypeScript 模块
```

### 5. 工具脚本运行
```bash
# 重新计算前 3 个月发布容量并生成数据
python3 scripts/analytics/calc_launch_capacity.py

# 构建 CEO 汇报正式 Word 文档
python3 scripts/ceo_report/build_report.py
```
