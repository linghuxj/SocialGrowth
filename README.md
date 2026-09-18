# SocialGrowth

面向企业提供内容生产与媒体运营自动化增长能力的核心工程仓库。前 3 个月聚焦于已有 AI 漫剧切片的高精度匹配分发、多平台（Facebook / Instagram / YouTube）自动化运营闭环以及基于 Google Artemis 的设备群控调度。

---

## 一、 系统架构拓扑

```mermaid
flowchart TD
    subgraph UI ["人机协同与终端应用层 (apps/)"]
        WC["web-console<br>(统一现代 Web 运营管理控制台)"]
        AC["artemis-controller<br>(设备自动化群控调度端)"]
    end

    subgraph Service ["核心中枢与独立服务层 (services/)"]
        AI["ai-engine<br>(AI 策略生成与规则推理中枢)"]
        SL["shortlink-service<br>(导流短链与归因分析服务)"]
    end

    subgraph Execution ["设备硬件底座"]
        DEV["移动真机池 (Samsung S23 等) + 模拟器矩阵"]
    end

    WC -->|人机确认 / 规则配置 / 监控大屏| AI
    WC -->|短链配置与点击查询| SL
    AI -->|下发标准化策略指令 (API/MCP)| AC
    AC -->|驱动目标 App 落实 UI 自动化| DEV
    DEV -->|截屏 / 自愈日志 / 执行回执| AC
    AC -->|执行状态上报| WC
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
│       ├── src/                        # 调度器、真机/模拟器连接池、UI 驱动器
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
│   └── annual-plan.md                  # 年度规划访谈全记录
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

系统在前 3 个月演进周期中的核心能力严格对应如下 7 个交付模块（详见 [docs/delivery-specification.md](docs/delivery-specification.md)）：

1. **模块 1：账号资产与定位管理模块**（`apps/web-console` + `services/ai-engine`）
2. **模块 2：已有切片素材管理与智能匹配模块**（`services/ai-engine/src/matching-engine.ts`）
3. **模块 3：策略引擎与单人辅助工作台**（`services/ai-engine/src/rule-parser.ts` + `apps/web-console`）
4. **模块 4：导流短链服务**（`services/shortlink-service`）
5. **模块 5：账号异常与风控管理模块**（`apps/web-console`）
6. **模块 6：Artemis 设备自动化执行与调度模块**（`apps/artemis-controller`）
7. **模块 7：数据采集与 A/B 策略优化闭环模块**（`services/ai-engine` + `apps/web-console`）

---

## 四、 快速使用指引

### 1. Web 运营控制台 (`apps/web-console`)
```bash
cd apps/web-console
npm install
npm run dev        # 本地开发服务器启动
npm run build      # 编译构建生产版本
```

### 2. Artemis 设备群控服务 (`apps/artemis-controller`)
```bash
cd apps/artemis-controller
npm install
npm run dev        # 启动调度守护进程
```

### 3. AI 策略引擎 (`services/ai-engine`)
```bash
cd services/ai-engine
npm install
npm run build      # 编译 TypeScript 模块
```

### 4. 工具脚本运行
```bash
# 重新计算前 3 个月发布容量并生成数据
python3 scripts/analytics/calc_launch_capacity.py

# 构建 CEO 汇报正式 Word 文档
python3 scripts/ceo_report/build_report.py
```
