# WP-03 第三阶段设计 QA

日期：2026-09-29。最终结果面向邀请管理 Web 的 UI-014 浅色工作台实现。

## 比较目标与证据

- source visual truth：`docs/design/workbench/provider-detail-v1.png`，并以 `provider-detail-prompt.txt`、`docs/design/workbench/README.md` 和 `docs/workbench-page-spec.md` §8.2 约束业务语义。该图是风格参考，不复制示例人物、设备、金额或状态。
- implementation screenshot：`artifacts/design-qa/wp03-stage3/implementation-remediation-1465x1074.png`（共享码与注册链接已遮蔽）。
- combined comparison：`artifacts/design-qa/wp03-stage3/comparison-remediation.png`；左侧参考、右侧实现。历史未脱敏截图已从本地证据目录移除。
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

复核曾发现会话切换后的秘密残留、截图未遮蔽、窄屏退出入口及手机写操作等 P1/P2 问题；整改复核又发现 701–980px 退出入口空档和测试证据不足，现已补齐并重新执行浏览器与视觉检查。当前没有可执行的 P0、P1 或 P2 差异。

- P3：`datetime-local` 的可视日期格式由 Chromium/操作系统控件决定，本次截图仍显示英语顺序。参考图没有邀请创建表单，也未定义该原生控件；字段标签和提交值均为中文及 ISO 时间语义，正式验收应以实际浏览器 locale 与后端时间事实为准。

## 比较历史

- Pass 1：确认整体结构、颜色、边框、密度及 1465px 视口无横向溢出；将 Playwright 浏览器 locale 显式设为 `zh-CN`，避免测试环境其他本地化漂移。没有 P0/P1/P2 finding。
- Remediation：统一清除失效/切换会话的一次性凭证；桌面验收截图遮蔽秘密；700px 手机视图改为只读；701–980px 均保留退出入口。以同尺寸重新截图并与参考并排检查，未产生新的 P0/P1/P2 finding。

## 交互与控制台

- 已测试：登录、刷新、切换邀请/账号视图、创建邀请、响应丢失后恢复相同完整邀请 ID/共享码且总记录只增加一条、复制及剪贴板内容、撤销确认、注册集合展开入口、账号开通/停用、真实停用会话清除凭证及切换身份、退出，以及 980px/700px 无横向溢出、手机只读和退出入口可见。
- Playwright 断言通过；页面未产生非预期 console/page error。复制操作只更新本地剪贴板和页面反馈，不调用发送通路。

## Follow-up Polish

- 后续如改用自有日期时间组件，可统一中文年月日顺序并增加明确时区提示；这不阻断当前阶段。

final result: passed

---

# WP-04 第三阶段 Android 注册／登录设计 QA

日期：2026-09-29。范围为选定的受邀注册视觉在 Kotlin 原生 Android 管理模式中的实现；业务成功态、登录态和退出态另以真机流程验证，不把参考图的示例状态当作后端事实。

## 比较目标与证据

- source visual truth：`docs/design/android/provider-registration-v1.png`，853 × 1844 px；同时受原始 `provider-registration-prompt.txt`、`docs/design/android/DESIGN.md` 与页面规格约束。
- implementation screenshot：`artifacts/design-qa/wp04-stage3-registration-final.png`，Samsung SM-S9110 真机 1080 × 2340 px、物理密度 480 dpi；截图保留真实系统状态栏与导航栏。
- authenticated screenshot：`artifacts/design-qa/wp04-stage3-success.png`，同一真机及尺寸，证明注册后的管理身份提示不把本机表达为执行手机。
- combined comparison：`artifacts/design-qa/wp04-stage3-comparison.png`；HTML 比较画布把两张纵向图分别以 390 × 844 CSS px 呈现，避免不同原始像素密度影响结构比较。
- state：实现对深链中的邀请只先表达“邀请待校验”；实际验证码请求由服务端确认邀请后才切换为“邀请已校验”。这比静态参考图直接显示已校验更符合权威事实，不是遗漏。

## 视觉与交互核对

- 保持浅灰 `#F4F6FA` 画布、白色表单卡、深蓝正文、蓝色主按钮、绿色邀请状态及细灰边框，没有渐变、装饰插画、底部登录前导航或未确认业务入口。
- 标题、说明、手机号／验证码字段、独立获取验证码动作、主注册动作、不会接入本机提示、已有账号登录入口和逐台扫码说明均与参考层级一致。
- 触控目标不小于 48dp，输入框与主按钮为 54dp；实际真机没有横向溢出，内容可滚动，系统栏不覆盖表单动作。
- 返回使用 Android 主题提供的原生 up indicator；页面没有字符拼装图标、自制 SVG、占位图片或不必要的生成资产。
- 手机号不预设 `+86`，客户端按后端 E.164 边界要求用户输入带国际区号的完整号码；验证码允许 4～8 位，不把静态稿固定为六位。

## Findings 与迭代

- Pass 1：真机整体结构、颜色、字号、间距和主要动作与参考方向一致；发现系统 `ic_media_previous` 呈现为上一曲图标，不符合返回语义。
- Pass 2：改为解析 Android 主题 `homeAsUpIndicator`，真机重建与截图确认返回箭头正确；Debug/Release 构建及两套 JVM 测试通过。
- 当前没有可执行的 P0、P1 或 P2 视觉差异。参考图的绿色勾选图标未单独复制；状态色和文案已完整传达语义，避免为装饰性小图标引入手制图形。

## 最终结果

真机实现忠实承接选定方向，同时按服务端事实纠正邀请初始状态。注册成功页明确说明管理登录不会接入本机；完整真机流程证据另记入 WP-04 交付记录。

final result: passed
