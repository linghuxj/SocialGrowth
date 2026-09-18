# @socialgrowth/web-console

SocialGrowth 统一现代 Web 运营管理控制台（Human-in-the-loop 人机协同界面）。

---

## 一、 系统定位与架构

作为 SocialGrowth 系统的统一前端应用，为单人专职运营人员提供直观、高效的监控与操作控制台，承接 7 大交付模块的前端可视化与人机交互流：

```
                              ┌───────────────────────────┐
                              │     apps/web-console      │
                              │ (Next.js / React 19 / UI) │
                              └─────────────┬─────────────┘
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
          services/ai-engine      apps/artemis-controller   services/shortlink-service
          (策略/规则/匹配/评估)      (真机群控/状态/回执)       (短链统计/跳转流)
```

---

## 二、 7 大核心交付模块界面映射

1. **账号矩阵与设备映射看板（模块 1）**：
   - 物理真机池与账号专属绑定关系（1机1平台1号）；
   - 账号生命周期状态（冷启动、持续运营、受限警告、已置换）。
2. **切片资产库与独占排他监控（模块 2）**：
   - 漫剧切片视频资产管理与特征标签展示；
   - 独占排他锁状态（`unallocated` / `assigned_locked` / `published`），严格杜绝重复推荐。
3. **AI 策略工作台与规则引擎（模块 3）**：
   - 单人审核流：待确认策略列表、一键确认与驳回调整；
   - 策略级“自主托管开关”：针对已成熟账号开启无人值守下发；
   - 经验规则库管理：自然语言录入、三级分类管理与规则冲突预警。
4. **导流短链分析面板（模块 4）**：
   - 批量短链创建与目的地配置；
   - 三层点击流统计图表（原始访问、有效点击、跳转成功）与平台归因明细。
5. **账号风控与冷备换号中心（模块 5）**：
   - 4 类异常实时告警列表与处置证据；
   - 冷备账号置换工单流水线与 2FA 人机接管界面。
6. **Artemis 设备群控看板（模块 6）**：
   - 物理真机设备池在线状态、电池健康、网络延迟与当前执行任务；
   - 任务截屏流、动作自愈日志（Self-healing Logs）实时回显。
7. **数据归因与 A/B 策略实验大屏（模块 7）**：
   - 社媒官方 API 与第三方数据服务双轨采集指标聚合看板；
   - 实验组 vs 基线组多指标加权评分对比，达标全量晋级与一键回退（Rollback）操作。

---

## 三、 技术栈选型

- **核心框架**：React 19 + vinext / Next.js
- **组件库**：shadcn UI + Base UI (@base-ui/react) + Tailwind CSS v4
- **图表引擎**：Recharts (折线图、条形图、面积图)
- **图标系统**：Lucide React
- **编译工具链**：Vite 8 + oxlint + oxfmt

---

## 四、 环境变量配置 (`.env.local`)

开发时在当前目录创建 `.env.local` 文件：

```env
# 核心后端服务接口地址
VITE_AI_ENGINE_URL=http://localhost:3001
VITE_ARTEMIS_CONTROLLER_URL=http://localhost:3002
VITE_SHORTLINK_SERVICE_URL=http://localhost:3003

# 鉴权与租户标识
VITE_CONSOLE_AUTH_SECRET=your-console-auth-secret
```

---

## 五、 本地开发与构建指令

> [!NOTE]
> 遵循项目规范，本地环境由开发者手动启动与调试服务，禁止脚本自动后台驻留。

```bash
# 安装依赖
npm install

# 本地启动开发服务器
npm run dev

# 静态类型检查与代码规范检查
npm run lint

# 代码格式化
npm run format

# 生产环境编译构建
npm run build
```
