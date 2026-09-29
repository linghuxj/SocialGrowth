# WP-03 第三阶段设计 QA

日期：2026-09-29。最终结果面向邀请管理 Web 的 UI-014 浅色工作台实现。

## 比较目标与证据

- source visual truth：`docs/design/workbench/provider-detail-v1.png`，并以 `provider-detail-prompt.txt`、`docs/design/workbench/README.md` 和 `docs/workbench-page-spec.md` §8.2 约束业务语义。该图是风格参考，不复制示例人物、设备、金额或状态。
- implementation screenshot：`artifacts/design-qa/wp03-stage3/implementation-pass2-1465x1074.png`。
- combined comparison：`artifacts/design-qa/wp03-stage3/comparison-pass2.png`；左侧参考、右侧实现。
- viewport：1465 × 1074 CSS px，deviceScaleFactor 1；source 1465 × 1074 px，implementation 1465 × 1074 px，无缩放或密度归一化。
- state：已登录；一份 3 次上限的有效邀请刚创建，一次性共享码/注册链接窗口可见，列表显示 0/3 和撤销入口。
- browser evidence：Chromium 真实页面截图；Playwright 从实际 Web 入口完成登录、创建响应丢失后重试、凭证一致性、列表、撤销、账号开通/停用及退出。浏览器控制台未出现非预期页面错误；故意触发的 401、409 和响应丢失网络错误单独作为场景断言，不计作意外错误。

## 全视图比较

实现保持参考稿的 230px 左侧导航、浅灰 `#F4F6FA` 画布、白色信息面板、深蓝正文、蓝色主操作、细 `#DCE2EA` 边框、8–10px 圆角和中等信息密度。内容宽度、顶部标题层级、摘要条、主表格及底部说明在同一桌面视口内完整可见，无页面横向溢出。

邀请页没有照搬提供者详情的示例数据；页面只呈现 R-152 所需的次数、有效期、状态、成功注册集合、设备数和撤销，并明确复制不等于发送、失效不取消已有身份或设备。

## 聚焦区域比较

- 导航与页头：品牌比例、四项导航、选中态蓝底、标题/说明层级与参考一致。
- 摘要和创建区域：沿用参考稿的横向摘要条与白色主面板；表单主操作有清晰焦点、禁用和处理中状态。
- 凭证窗口：成功色仅表示创建事务成功；共享码和链接使用真实输入框与 Phosphor 图标，不用手工 SVG、字符图标或占位资产。
- 表格：表头背景、边框、行高、状态标签、数字层级和末列操作与参考保持同一密度；展开区承载完整注册进展。

## 必查视觉表面

- Fonts and typography：使用 Inter / PingFang SC / Microsoft YaHei 回退；标题 28–36px、分区标题 20px、正文 14px、小型状态 11–12px，层级及字重接近参考，无异常截断。
- Spacing and layout rhythm：导航、页边距、面板间距、表单网格和表格节奏稳定；1465px 桌面视口无溢出，并提供 980px 与 700px 响应式布局。
- Colors and visual tokens：主蓝、深蓝正文、浅灰画布、细灰边框及中性/成功/到期/耗尽/撤销语义色区分清楚，未使用参考稿没有的深色设备农场风格或渐变。
- Image quality and asset fidelity：参考页面没有必须复制的照片或插画；实现仅使用 Phosphor 图标库，不含自制 SVG、CSS 图画、emoji 或占位图片。
- Copy and content：文案遵守多人限次限期、不预绑手机号、成功注册才扣次、复制不等于发送、撤销不取消旧身份/设备及秘密仅创建成功时展示的产品边界。

## Findings

没有可执行的 P0、P1 或 P2 差异。

- P3：`datetime-local` 的可视日期格式由 Chromium/操作系统控件决定，本次截图仍显示英语顺序。参考图没有邀请创建表单，也未定义该原生控件；字段标签和提交值均为中文及 ISO 时间语义，正式验收应以实际浏览器 locale 与后端时间事实为准。

## 比较历史

- Pass 1：确认整体结构、颜色、边框、密度及 1465px 视口无横向溢出；将 Playwright 浏览器 locale 显式设为 `zh-CN`，避免测试环境其他本地化漂移。没有 P0/P1/P2 finding。
- Pass 2：以同尺寸重新截图并与参考并排检查；邀请核心状态、表单、凭证和列表完整可见，未产生新的 P0/P1/P2 finding。

## 交互与控制台

- 已测试：登录、刷新、切换邀请/账号视图、创建邀请、响应丢失重试、复制及剪贴板内容、撤销确认、注册集合展开入口、账号开通/停用、会话撤销、退出，以及 980px/700px 无横向溢出和核心导航可见。
- Playwright 断言通过；页面未产生非预期 console/page error。复制操作只更新本地剪贴板和页面反馈，不调用发送通路。

## Follow-up Polish

- 后续如改用自有日期时间组件，可统一中文年月日顺序并增加明确时区提示；这不阻断当前阶段。

final result: passed
