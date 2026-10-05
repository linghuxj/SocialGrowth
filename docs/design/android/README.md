# Android App 视觉稿与设计规范

更新：2026-10-04；图稿制作于 2026-09-28。状态：全部 11 组页面的 UI、展示内容与交互对齐已完成（AND-001～AND-025）。受邀注册／原手机号登录已在 WP-04 第三阶段按第 1 版实现并完成阶段内真机验证。
其余管理流程、基础分佣、永久退出及执行手机接入与本机暂停仍为待对应工作包实施的图稿；补充我的与人工找回参考稿按 R-141 收敛首期范围。

> [!CAUTION]
> **图稿有效性说明（防过期误用）**：
> 下列 PNG 图稿均生成于 2026-09-28，属于初期视觉方向探索；在 2026-10-03～10-04 经过全面的产品与交互复核后，确认了 **AND-010～AND-025** 系列决定。
> **部分既有图稿已过期或存在严重业务/结构偏差（详见第二节对照表），绝对不能直接拿过期图片作为开发与验收的唯一依据。**
> 任何业务逻辑、页面布局、字段及状态流转一律以 [页面规格 0.12](../../android-app-page-spec.md)、[Android 设计规范 0.7](DESIGN.md) 和 [对齐记录](../../android-app-alignment.md) 为准。

逻辑画幅目标为 390 × 844，实际 PNG 均为 853 × 1844；属于视觉候选，不能证明像素尺寸、对比度、触控区域或实际交互已达标。全为示例数据，无真实注册、发短信、手机操作或分佣结果。

---

## 1. 图稿有效性、过期状态与对齐对照表（2026-10-04 最新基线）

为了防止开发人员或设计评审人员误用过期图稿，特将目前仓库内所有图稿的状态、与最新规格的偏差及对应规范章节对照整理如下：

### A. 缺失图稿的页面（完全无图，必须直接依据规格实现）

| 缺失页面／组件 | 最新决策编号 | 规范要求与核心行为 | 对齐章节依据 |
| --- | --- | --- | --- |
| 首次使用方式独立入口 | AND-010 | 首次打开未登录且未关联时，展示两张同等大小的白色入口卡片（“管理我的设备”与“接入这台执行手机”），纵向排列整卡可点 | [页面规格 § 1](../../android-app-page-spec.md#首次使用方式入口and-010-已确认) |
| 手动输入设备关联码界面 | AND-015 | 管理端添加设备时，除扫码外提供备用入口；不索取相机权限，输入后“核对设备”进入共用核对页 | [页面规格 § 3](../../android-app-page-spec.md#管理端扫码与手动输入) |
| 暂停本机底部确认浮层 | AND-019 | 现场人员点击“暂停本机”时从底部弹出，核对设备并说明影响，点“确认暂停”正式提交，取消不产生请求 | [页面规格 § 3](../../android-app-page-spec.md#本机暂停与离线进展and-008019r-139) |
| 首页已退出设备折叠区 | AND-023 | 首页底部“已退出设备 · N”折叠卡，展开后查看已退出历史设备行与清理进展；清理需配合在顶部提示 | [页面规格 § 2](../../android-app-page-spec.md#2-设备首页and-003013023025-已确认) |

---

### B. 已过期／存在结构与业务偏差的图稿（禁止直接照图开发）

| 图稿文件 | 对应功能／页面 | 偏差与过期原因说明 | 正确依据与对齐规范 |
| --- | --- | --- | --- |
| [home-action-v2.png](home-action-v2.png) | 首页修订稿 | **[已过期]** 缺少底部“已退出设备 · N”折叠区（AND-023）；未展示设备备注名与稳定型号并存逻辑（AND-014）；代码中旧有的“退出管理登录”按钮按 AND-025 明确移至“我的”，首页不放退出按钮；需配合与折叠区状态流转不完整。 | [页面规格 § 2](../../android-app-page-spec.md#2-设备首页and-003013023025-已确认) |
| [device-association-confirm-v1.png](device-association-confirm-v1.png) | 关联确认页 | **[已过期]** 缺少可选填的“设备备注名”输入框（AND-014）。原图仅核对了当前提供者与目标型号，未提供让用户为设备起别名的字段。 | [页面规格 § 3](../../android-app-page-spec.md#关联核对页与关联结果扫码手动输入共用) |
| [local-association-code-v1.png](local-association-code-v1.png) | 本机关联码页 | **[已过期]** 仅画出了二维码扫码形态，缺少按 AND-015 补充的“手动输入备用设备关联码”区域及文字说明。 | [页面规格 § 3](../../android-app-page-spec.md#执行手机的关联码页) |
| [local-preparation-v1.png](local-preparation-v1.png) | 本机准备页 | **[已过期]** 原图为静态完整清单列表。按 AND-016 最新决策，本机准备改为“整体进度 + 当前一步重点引导”，默认文字说明且必须提供可直达设置/应用的跳转按钮；最后一步单次明确表达“开始参与”（AND-018）。原静态列表式布局已废弃。 | [页面规格 § 3](../../android-app-page-spec.md#本机准备先说明用途再进入实际授权) |
| [onsite-stop-pending-v1.png](onsite-stop-pending-v1.png) | 现场协助（停止中） | **[已过期]** 原图步骤和后续流转包含手动“提交处理结果”。按 AND-021/022 明确两端分工，彻底废除手动文本提交步骤：管理端仅看问题与停止确认，执行机展开步骤并就地自动检查。 | [页面规格 § 6](../../android-app-page-spec.md#6-本人协助与现场操作and-021022-已确认) |
| [resume-request-v1.png](resume-request-v1.png) | 请求恢复页 | **[已过期]** 原图顶部显示“SG-021 处理结果已提交”，这是废弃的旧表单逻辑（AND-022）。最新规范为执行手机自动检查通过后，管理端直接展示“现场条件已检查通过，设备仍保持暂停”，并提供“请求恢复”与“暂不恢复”。 | [页面规格 § 6](../../android-app-page-spec.md#6-本人协助与现场操作and-021022-已确认) |
| [local-pause-pending-v1.png](local-pause-pending-v1.png) | 本机暂停进展页 | **[部分过期]** 原图仅画出离线暂停进展，未体现前置的底部确认浮层（AND-019），未体现本机状态页顶部的粗粒度使用状态（“系统正在使用本机 / 当前空闲 / 无法确认”及通知栏同步，AND-020）。另外，现有代码中历史临时实现的“确认当前参与 / 撤回本机参与”按钮与原图不符，按 AND-018 已正式确认作废并不再在界面展示独立参与开关。 | [页面规格 § 3](../../android-app-page-spec.md#等待运营初始化与本机状态and-018020-已确认) |
| [profile-v1.png](profile-v1.png) | 我的页面 | **[微调过期]** 原图底部有“返回设备管理”按钮。按 AND-025，该页面通过底部“设备／分佣／我的”一级导航切换，页面内不再放置多余的返回跳转按钮。 | [页面规格 § 8](../../android-app-page-spec.md#8-我的与账号帮助首期最小范围and-025-已确认) |
| [provider-registration-v1.png](provider-registration-v1.png) | 受邀注册页 | **[部分过期]** 原图仅展示了邀请有效校验通过后的表单状态，未展示手动输入/粘贴邀请码区域（AND-011 确认同页完成邀请填写与手机号验证）。 | [页面规格 § 1](../../android-app-page-spec.md#受邀注册的页面与异常and-007按-r-152-修订) |

---

### C. 仍基本适用的图稿（需注意局部细节与纯色规范）

| 图稿文件 | 对应页面 | 适用性说明与使用注意事项 |
| --- | --- | --- |
| [device-detail-v1.png](device-detail-v1.png) | 设备详情页 | 布局整体适用。注意：须支持修改设备备注名（AND-014）；点击“暂停这台手机”时触发底部确认浮层（AND-019）；现场处理完成后直接展示“现场条件已检查通过”及“请求恢复”，无手动提交步骤。去除按钮微弱渐变，使用规范纯色。 |
| [commission-list-v1.png](commission-list-v1.png) | 我的分佣列表 | 结构完全符合 AND-024（**不显示任何汇总合计金额**，仅保留预估参考区与按期间逐条记录）。注意：中性说明，不得使用黄色警告叹号。 |
| [commission-detail-v1.png](commission-detail-v1.png) | 分佣详情页 | 计算依据与期间展示适用。注意：文字口径统一为“可结算佣金”（替换原图“应得佣金”），不展示提现或绑卡。 |
| [device-exit-confirm-v1.png](device-exit-confirm-v1.png) | 永久退出确认 | 四项必要影响说明与确认结构适用。注意：主按钮为危险色规范纯色，返回保留原状态。 |
| [device-exit-progress-v1.png](device-exit-progress-v1.png) | 退出进展页 | 停派发、旧端停止、清理各状态独立展示逻辑适用。注意：不展示整体恢复按钮。 |
| [local-condition-check-v2.png](local-condition-check-v2.png) | 分项检查页 | 条件展示适用。注意：检查通过后单次触发“开始参与”（AND-018）。 |
| [local-waiting-operations-v1.png](local-waiting-operations-v1.png) | 运营准备中 | 本机条件通过后等待运营的进展展示适用。提供者不选择业务账号。 |
| [resume-review-v1.png](resume-review-v1.png) | 恢复复核中 | 请求受理后多项复核条件展示适用。 |
| [account-recovery-help-v1.png](account-recovery-help-v1.png) | 原号码不可用帮助 | 仅作为人工核验联系说明，首期不开发完整 App 内找回流程（R-141）。 |
| [account-recovery-verify-v1.png](account-recovery-verify-v1.png) | 核验后验证新号码 | 参考稿，首期不作为前置开发项（R-141）。 |

---

## 2. 原始生成图稿清单（按生成顺序归档）

下表保留原始生成记录，仅供追溯设计演进，**不代表当前最终执行基线**：

| 页面 | 图稿 | 状态评估 | 完整提示词 |
| --- | --- | --- | --- |
| 首页修订 | [首页 v2](home-action-v2.png) | **已过期（缺折叠区/备注名）** | [prompt](home-action-v2-prompt.txt) |
| 设备详情 | [设备详情 v1](device-detail-v1.png) | **基本适用（需微调纯色与备注修改）** | [prompt](device-detail-prompt.txt) |
| 现场协助 | [停止待确认 v1](onsite-stop-pending-v1.png) | **已过期（废除手动提交结果）** | [prompt](onsite-stop-pending-prompt.txt) |
| 受邀注册 | [注册 v1](provider-registration-v1.png) | **部分过期（缺手动邀请码输入区）** | [prompt](provider-registration-prompt.txt) |
| 扫码确认 | [关联确认 v1](device-association-confirm-v1.png) | **已过期（缺设备备注名输入）** | [prompt](device-association-confirm-prompt.txt) |
| 主动恢复 | [请求恢复 v1](resume-request-v1.png) | **已过期（废除手动提交结果状态）** | [prompt](resume-request-prompt.txt) |
| 恢复复核 | [复核中 v1](resume-review-v1.png) | **基本适用** | [prompt](resume-review-prompt.txt) |
| 分佣列表 | [我的分佣 v1](commission-list-v1.png) | **基本适用（确认无汇总，需去叹号）** | [prompt](commission-list-prompt.txt) |
| 分佣详情 | [分佣详情 v1](commission-detail-v1.png) | **基本适用（文案统一为可结算佣金）** | [prompt](commission-detail-prompt.txt) |
| 退出确认 | [永久退出确认 v1](device-exit-confirm-v1.png) | **基本适用** | [prompt](device-exit-confirm-prompt.txt) |
| 退出进展 | [停止与清理待确认 v1](device-exit-progress-v1.png) | **基本适用** | [prompt](device-exit-progress-prompt.txt) |
| 执行手机关联 | [本机关联码 v1](local-association-code-v1.png) | **已过期（缺手动关联码）** | [prompt](local-association-code-prompt.txt) |
| 本机准备 | [网络与授权准备 v1](local-preparation-v1.png) | **已过期（已改为单步引导与直达）** | [prompt](local-preparation-prompt.txt) |
| 条件检查 | [分项检查 v2](local-condition-check-v2.png) | **基本适用** | [v1 prompt](local-condition-check-prompt.txt)／[v2 prompt](local-condition-check-v2-prompt.txt) |
| 等待运营 | [运营准备 v1](local-waiting-operations-v1.png) | **基本适用** | [prompt](local-waiting-operations-prompt.txt) |
| 本机暂停 | [离线暂停进展 v1](local-pause-pending-v1.png) | **部分过期（缺确认浮层与粗粒度状态）** | [prompt](local-pause-pending-prompt.txt) |

---

## 3. 下一步工作建议

1. **图稿重新生成／修订**：后续如需为 UI 验收制作视觉依据，优先为 4 个缺失页面补全图稿，并更新 6 个已过期图稿。
2. **代码实现对齐**：根据 [页面规格 0.12](../../android-app-page-spec.md) 重构客户端结构（引入底部导航、用途选择、移除旧参与按钮并替换为单一暂停本机与确认浮层、现场修复两端分工）。
3. **真实真机验证**：涉及系统权限、本地端点与 Artemis 执行能力仍必须在真实机型上通过验证并留存证据，图稿不作为验收通过依据。
