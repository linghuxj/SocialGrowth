# 切片、Page 绑定与效果读取复核（2026-10-06）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

本轮仅复核既有项目、原文件、原账号和原操作；未公开发布、改素材版本、迁移账号或清除未知回执。结论：**切片信息提取通过；Page 自动绑定和真实效果采集尚未完整。**

| 项目 | 当前证据 | 结论 |
| --- | --- | --- |
| 原切片 | 真实 Web 点击 AI 提取；原件 SHA256 匹配；119.884853 秒、1920×1080、6 帧；生成标题、摘要、字幕及配文 | 通过。只分析画面/字幕；音频、集数及制作方不推断 |
| 原账号与手机 | Web 选择新项目，显示既有账号占用；没有再次移用或新建 | 已保留；不能据此声称真实 Page 已绑定 |
| Page ID 获取 | 既有真机获取记录为 `61595032504951`，父账号 ID 为 `61550800776808`，详见原闭环记录第 141 行起 | 原记录可复用；本轮未重新操作手机获取 ID |
| 新项目 Page 绑定 | 只读运行时映射表返回 0 行；Web 查询原操作仍未知；原 Artemis trace 为 cancelled，设备序列号匹配 | 未通过。不是账号缺失；原身份核验超时且设备占用未结束，不能重复派发 |
| 新项目效果 | 实际 Web GET 返回 `not_configured`、0 条指标；缺失不显示为零 | 读取与缺失展示通过；采集未接通 |
| 旧项目效果 | 实际 Web 读取 3 行历史值；缺少指标名称、单位、来源定义和覆盖范围 | 仅证明历史记录可读取；无法证明这些值是播放/互动指标或本轮真实采集结果 |

新项目：`55fa34ae-71e8-4079-b870-985c88635382`；原文件对象：`443193fb-5c6f-4346-bac2-6e03edc2842d`。原 Page 核验操作：`0ef94113-c6de-4171-b873-fd0c2bf62b53`，trace：`ff006725-3a68-470c-80b3-3b914d901505`。

## 本轮最小改动

- 停用 `execute-metrics-visual-collection.mts`。原实现没有调用 Artemis，直接把预设零值写入业务数据库，并把截图写成 passed；现在运行立即失败且无写入。当前数据库三行是另一批符合快照格式的历史记录，不能把它们说成该脚本本轮生成的数据；没有删除历史。
- 扩展既有 Playwright 验证入口，实际点击切片分析、核对保留资源、读取效果；不应用或保存新分析草稿，保持任务引用版本。
- 复用既有 MetricSnapshot 字段导出 `standardized-metrics.csv`，不新增业务表、评分系统或复盘流水线。

## 最小标准衡量口径

每条指标独立记录：项目、真实 Page／频道、账号级或内容级、指标原名、定义与单位、数值及缺失原因、累计或区间、覆盖起止、统计截止、采集时间、时区、来源报告和修订。CSV 空字段表示未知；明确读取到的 `0` 保留，不能补零。

优先读取平台实际提供的播放、覆盖、反应、评论和分享。保留平台名称和定义，不把播放次数当独立观看人数，不把账号汇总归到这份尚未发布的切片。内容级报告还须有实际发布 ID／URL 与任务的核验关联。

只有来源可核验、定义/单位相同、身份和内容范围一致、观察窗口一致的数据才可比较。观察窗口沿用项目已确认配置。累计快照不相加；不同来源不混算。`measurement_metadata_complete` 仅表示口径字段齐全，不代表来源可信、可跨行比较或效果达标。本轮三行均为 false。

如需互动率，仅在同一范围和区间内、五项原值真实齐全且覆盖人数大于零时，计算 `(反应 + 评论 + 分享) / 覆盖人数 × 100%`，注明这是本项目派生口径。否则留空；本轮不计算、不评分、不生成优化结论。

## 验证与剩余核心缺口

- 项目 Node v24.16.0，`pnpm env:check` SQLite OK；复用既有 Web3100、后端4320、runtime4318。USB `RFCW40MYYCV` 可用；原 engine 无活跃锁，但业务 hold 仍存在，因此未绕过占用操作手机。
- 首次新脚本模块路径错误已修正。第二次真实分析 HTTP500：配置引用的原本地素材存储容器已停止；恢复原容器后，第三次实际 Web 分析通过。需确保运行 Web 时素材存储依赖可用；未更换存储、重上传或直接写库。
- 新旧项目效果页各验证正常读取、真实浏览器断网失败后重试、980/700/390px 无整页横向溢出及零浏览器错误。截图人工查看：切片分析与应用/保存边界清楚；效果页的“可信来源解析器”“反馈接口”偏技术化，记录后续文案简化，不扩大开发。
- 剩余两项核心工作：**核清并结束原只读身份核验的占用，完成同一项目 Page 可信映射及最终发布前准备；接通真实平台效果采集并携带上述统计口径。** 未恢复自动执行、未绑定成功、未取得这份未发布切片的内容效果。

证据根目录：`output/playwright/slice-page-feedback-20261006/`。保留 run1/run2 失败、storage-restored 成功和 old-feedback/new-feedback 的结果、截图、原反馈 JSON、标准 CSV，以及 `page-binding-read.json`。后续导出重跑分别存 old-feedback-final/new-feedback-final。

复现核心命令（无需在命令中填写密码）：

```sh
SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=core-execution \
SG_PRODUCT_CORE_EXPECT_UNKNOWN=1 SG_PRODUCT_CORE_REVALIDATE=1 \
SG_PRODUCT_CORE_PROJECT_ID=55fa34ae-71e8-4079-b870-985c88635382 \
SG_PRODUCT_CORE_OBJECT_ID=443193fb-5c6f-4346-bac2-6e03edc2842d \
SG_PRODUCT_CORE_PROJECT_NAME=获准原文件字节验收-1791208369573 \
SG_PRODUCT_CORE_OUTPUT=output/playwright/slice-page-feedback-20261006/new-run \
pnpm test:playwright
```

效果验证使用 `SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=project-feedback pnpm test:playwright`；从私有本地配置向进程传入测试登录环境变量，并指定 `SG_PRODUCT_PROJECT_FEEDBACK_PROJECT_NAME`、`SG_PRODUCT_PROJECT_FEEDBACK_PROJECT_ID`、`SG_PRODUCT_PROJECT_FEEDBACK_OUTPUT`。不得打印密码。
