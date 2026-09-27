# 真机监控：参考来源与回传映射

**状态：历史探索。** 用户已按 UI-014 恢复原浅色设计稿，替代 UI-013 的 Demo 大屏视觉方向。本文保留事实盘点与检查来源，不作为当前页面布局要求。

2026-09-27。按用户 UI-013 调整：参考 Demo 真机大屏，以真实回传对应显示。本文是设计与事实盘点，不修改 Demo 代码，也不锁定最终接口或技术栈。

## 本轮可核实的资料

- [Demo 监控组件](../../../apps/web-console/components/operations/device-farm.tsx)：深色手机卡片、完整屏幕、设备标识、动作步骤、事件更新与状态轮询。
- [Demo 状态与截屏处理](../../../services/execution-runtime/src/server.ts)：设备状态聚合、抓取截图、事件发布。
- [Demo 步骤事件结构](../../../services/execution-runtime/src/events/step-event-bus.ts)：设备/会话/步骤/状态/图片引用及事件时间。
- [历史大屏截图](../../../archive/2026-09-25-before-realignment/artifacts/acceptance/artemis-live-monitoring/03-device-farm-live-step.png)：仅作已有布局参考，不作为当前在线状态。
- [归档真机原图](../../../artifacts/reports/2026-09-20-runtime-real-preflight/final-screen.png)与[同目录回执](../../../artifacts/reports/2026-09-20-runtime-real-preflight/receipt.json)：预览原样引用。回执为 executionStatus=failed、publishStatus=unknown、failureCode=TECHNICAL_FAILURE；不把执行结束说成发布成功。

原图与回执属于同一归档目录，但当前资料不足以确定截图的精确采集时间及逐帧事件对应，预览明确分开。回执 occurredAt=2026-09-20T07:06:13.098Z，换算 Asia/Shanghai 为 15:06:13.098；不将其填入截图采集时间。图片原像素与文件保持不变，没有送入图像生成工具重绘。

本轮 `lsof -nP -iTCP:3000 -iTCP:4318 -sTCP:LISTEN` 未返回监听实例。因此仅使用归档设计参考，没有访问实际 Web、扫描手机、刷新真机截图、运行任务或启动常驻服务。

## 显示所需事实与 Demo 当前来源

| 显示项 | Demo 可见来源 | 后续设计要求 |
| --- | --- | --- |
| 设备卡片 | deviceId / serial | 同一物理设备去重，业务 ID 与连接端点分别保留；不同端点不能误增设备数 |
| 机型 | model（当前有固定兜底值） | 只显示实际探测值；未知不填 Galaxy S23，不拼接固定机型后缀 |
| 手机画面 | imageKey 与截图读取 | 真实图片原比例；图像设备及任务关联须明确，缺图不能用模拟界面补齐 |
| 步骤与说明 | step、totalSteps、action、actionDesc、sessionId | 有总数才显示分母，不换算虚构完成率；无关联任务时保持未知 |
| 执行状态 | status / task / challenge / hold | 执行、设备连接、独占控制和发布核验分别判断，不能用单一 status 覆盖全部 |
| 平台与发布身份 | platform / platformIdentity、binding | 分配值与实际观察匹配分开；缺值不默认 FB 或已核验 |
| 管理连接 | adbStatus、设备探测、页面事件连接 | 页面事件通道与单机可达性分开，不能从 SSE open 推断所有手机在线 |
| 状态时间 | timestamp | 只作来源定义支持的事件时间；不能凭一个字段宣称截图时间/最后在线时间均已知 |
| 截图时间 | 当前事件结构无独立明确 capturedAt | 需实际采集证据，不因刷新读取就标“刚刚”；历史图片保留原时间/未知 |
| 信号、电量、网络类型 | 当前 UI 有固定“5G · 100%” | 未见相应真实字段，不显示这些固定值；日后有可靠回传才加入 |
| 独占控制与交还 | hold/challenge 提供部分线索 | 不足以直接证明完整接管握手、实际控制者与交还确认；补齐事实前不可展示已控制 |
| 提供者暂停/退出与就绪 | 当前状态结构未完整表达新基线所有条件 | 按需求补齐独立事实，不能用 idle 一律译成就绪或已获准执行 |

这些是所需业务事实，不要求最终沿用上述字段名、接口、存储方案或三秒轮询。

## 参考时需修正的 Demo 行为

1. `/devices/states?capture=1` 仅在在线且无旧图片引用时尝试截图；常规轮询不等于每次获得新截图。“三秒自动刷新”不能直接写成三秒实时视频。
2. 手动 `/devices/refresh` 当前发布 idle / manual_refresh 事件；截图更新应独立于任务执行与控制状态，不能因拍到图就显示设备待命或覆盖阻断。
3. 页面把 all 记录总数称为已连接台数、把 idle 称就绪，且部分 completed/failed 状态落入简化兜底文案；新设计必须分别核对，不能从这些标签反推真实状态。
4. 当前有默认机型、默认平台、固定 Worker/存储架构及网络指标文案；产品首屏展示与运营判断相关的实际事实，诊断细节按需展开，不继承无依据默认值。
5. 事件总线同时按业务 ID/serial 保存部分索引，状态聚合需验证同机去重和身份映射；不能只数事件条数当物理手机数。历史事件、当前探测与新绑定也需明确时间及来源优先级。
6. “重新扫描/截图”可能访问手机，不能当作无条件的页面刷新。提供者暂停、授权失效或他人独占时须分别限制；首次打开监控也不默认获准对所有手机发截屏命令。

以上仅做设计核对，本轮没有修改相关产品源码。准确交互边界见[页面规格第 7 节](../../workbench-page-spec.md#7-账号设备及接管)。

## 可复现的预览检查

文件：[HTML 设计预览](device-monitor-preview.html)、[渲染脚本](render-monitor-preview.mts)、[检查结果](device-monitor-preview-check.json)、[历史参考视图](device-monitor-preview-v2.png)、[未连接视图](device-monitor-unconnected-v2.png)。

从仓库根目录运行 `pnpm exec tsx docs/design/workbench/render-monitor-preview.mts`。脚本用 Chrome/Playwright 打开本地文件，阻断 HTTP(S) 请求，不连接 runtime；核对真实原图加载、放大与 Escape 关闭、焦点返回、未连接/历史切换、接管按钮禁用、1500/1100 桌面宽度无横向溢出并保存截图。

这证明设计预览的有限交互与布局可以打开，不证明实际 Web 的数据订阅、手机控制、业务状态或恢复链路通过。技术细节、异常和真机结果须另按仓库真实 Web 验收规则验证。
