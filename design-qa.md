# WP-15 第十一阶段最新设计门禁：仅推进非UI客户端

2026-10-01。source visual truth：`docs/design/workbench/materials-batch-v1.png`（已查看实际1487×1058）、原21行`materials-batch-prompt.txt`，以`docs/workbench-page-spec.md` §4及图稿索引约束业务。示例6行/候选/待补/失败/文件名日期不是当前事实；不可复制为准入许可。沿用现有Phosphor/字体与token，无需新栅格asset或独立prototype；user-context预检未保存上下文。

RES-WP14-03管理员策略校验不可用仍无解除证据，按image-to-code/design-qa暂停新增UI组件/页面/样式/截图及视觉交付，不换入口绕过。当前仅GET客户端与8单元/根439/静态补充，没有运行态实现截图、并排比较或聚焦图，不能按源码推导视觉通过；Fonts/Spacing/Colors/Image fidelity/Copy五面、响应式、真实交互和console均未验证。不得把fetch合成端口结果算真实浏览器业务验收。

运行环境管理员恢复原策略服务后，WEB按同源图/prompt/当前规格实现素材页面，QA从真实Web入口操作、捕获实际账号对象同状态同尺寸图并做全视图/聚焦对照；BIZ/OPS提供实际合法对象/声明与受控存储资料，资源需求和职责/解除/补验见WP15-stage11及RES-WP14-03。其他独立非UI工程继续。以下原阶段证据保留，不重新标绿。

final result: blocked

---

# WP-14 第三阶段最新设计门禁：暂停新UI实现

2026-09-30。目标是project-settings-v1.png及project-settings-prompt.txt的筹备目标/设置能力，以docs/workbench-page-spec.md §3与DESIGN.md校正生成稿示例；没有实现运行周期修改或复制示例数值。

原QA固定6394cde于本轮再次收到管理员浏览器策略校验服务不可用，完整证据artifacts/acceptance/product/B3/20260930T084037Z-wp14-stage1-6394cde/browser-policy-blocker.md。按image-to-code/design-qa，暂停新UI实现、截图与视觉交付，不换其他入口绕过控制。当前只有规划草案后端、契约/PG证据，没有第三阶段浏览器渲染、同状态并排或聚焦图；五个视觉表面、响应式、交互及console均未验证，不从源码推导设计通过。

责任与解除：运行环境维护方恢复管理员策略校验服务，WEB/QA随后从真实页面补捕获、操作与同尺寸比较。其他独立工程继续，见docs/engineering/delivery/records/WP-14-stage3.md。以下既有阶段历史证据保留，其passed不覆盖本阶段。

final result: blocked

---

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

# WP-06 第三阶段 Android 真机设计 QA

日期：2026-09-30。范围仅为 Samsung SM-S9110／Android 16 上真实 0 台归属设备的管理首页、本人资料、原号码不可用帮助与设备接入说明；非空设备详情及执行端本机页不在本次真机视觉结论内。

## 输入与真实证据

- source visual truth：`docs/design/android/home-list-v1.png`、`device-detail-v1.png`、`profile-v1.png`、`account-recovery-help-v1.png` 及各自同名 `*-prompt.txt`。参考中的设备、收益、发布身份、在线/授权及进度是示例，不能照搬为真实事实。
- implementation：`artifacts/design-qa/wp06-stage3/management-home.png`、`profile-remediation.png`、`account-help.png`、`association-help-remediation.png`，真机 1080 × 2340 px；旧 `profile.png` 保留为首次复核前对照。`web-provider-no-device.png` 为实际 Web 入口看到同一隔离后端的 1 位提供者／0 台设备补充核对。注册前和取验证码时的临时截图仅供本机调试，不作交付视觉证据。
- combined comparison：`artifacts/design-qa/wp06-stage3/comparison.png`，左参考、右真机，以等显示高度并排检查。两侧数据状态不同，比较限于信息层级、色彩、布局和边界文案。

## 检查结果与边界

- 首页保留参考的浅色画布、深色标题、蓝色主按钮、白色事实卡片和页头资料入口；真实空态明确 0 台、连接未确认，不出现示例设备卡或虚构在线/任务/授权。资料页展示真实脱敏手机号、仅管理身份和明确退出；帮助页解释人工核验与受控换绑，不伪装为已有工单提交能力。
- 真机系统返回按帮助→资料→首页逐级导航；退出后回到认证页，强停重启不回显原资料。屏幕内容可滚动，页面未观察到文字截断或底部操作被系统导航栏遮挡。真实邀请来自 Web 页面，验证码来自隔离后台受保护开发读取；二者不证明真实短信。
- 首轮非作者复核指出“我的”缺选定提示词中的“设备接入说明”。整改后真机资料页同时可见两项帮助入口，进入新增只读说明页并经系统返回回到资料页；说明页的三步和后续授权提示不声称已关联、在线或可接任务。该新增页沿用同组 Android 参考的颜色、卡片和字号；不复制参考稿尚无真实来源的分佣底部导航或项目资料。
- 参考设备详情和执行端本机页因只有一台实体手机、尚无经双机光学建立的归属，不能给出真实非空截图。其排版只经过代码/构建检查，不标视觉或业务通过。需要第二台执行手机后由 AND/QA 按 `docs/engineering/delivery/records/WP-06.md` 补验。

final result: passed（仅上述真实管理端空态、资料及两类帮助页面；非空详情、执行端、跨机影响未验证）

---

# WP-06 第二阶段运营手机事实页设计 QA

日期：2026-09-30。范围为运营 Web“账号与设备／手机”在真实空数据下的页面，非 Android 或非空设备业务验收。

## 比较目标与证据

- source visual truth：`docs/design/workbench/devices-overview-v1.png` 与同名 `devices-overview-prompt.txt`，1465 × 1075 px。图中四台手机、项目、发布身份、在线/授权/任务数据均为示例，不作为真实数据源。
- implementation screenshots：`artifacts/design-qa/wp06-stage2/web-empty-desktop.png`（1465 × 1074 CSS px）和 `web-empty-mobile.png`（390px 宽）；Playwright 从实际 Web 入口登录后进入手机页截图。
- combined comparison：`artifacts/design-qa/wp06-stage2/comparison.png`，左参考、右真实空数据实现，同一桌面宽度直接并排。状态不同仅用于核对页面骨架与视觉系统，不能据参考的四行示例判定非空实现通过。

## 检查、发现与整改

- 桌面导航宽度、浅灰画布、白色面板、深蓝文字、蓝色选中标签/操作、细边框、信息提示条与参考方向一致；过滤区、手机资源主面板和下方详情/提供者区域层级清晰，没有虚构在线、授权有效、项目或发布身份。
- 第一轮 390px 截图发现页头“刷新／退出登录”受窄列压缩为竖排文字；移动端页头改为上下分区，操作按钮横向排列。复测截图中两按钮均保持正常横排、可辨识和可点击；页面无横向溢出。
- 当前真实数据库没有提供者或设备，因此“尚无已关联手机”和“尚无已注册提供者”为正确空态。非空两台设备与零设备提供者的标记结构通过组件测试，但未以模拟接口伪造 Playwright 业务成功；真实非空截图和 Android 设计比较留待权威数据/真机阶段。
- Playwright 检查进入、搜索、状态筛选、刷新、390px 布局、退出与重新登录后的资料清除；提供者筛选因真实空数据未出现，仅组件层检查。原有运营邀请/账号流程回归通过，无非预期页面错误。临时 Web、后端与 PostgreSQL 服务在测试后停止。

## 视觉表面与边界

字体与尺寸、页边距、8–10px 圆角、Phosphor 手机/搜索/刷新图标及正文对比清楚；移动端卡片顺序保持筛选、事实提示、资源、提供者概况。参考稿的表格列和下方任务卡必须等后续项目/发布身份/连接确认有权威来源后再评估，当前不把这种业务内容差异算作漏实现。非空页面真实视觉仍为未验证项。

final result: passed（仅当前真实空数据 Web 视图；非空和 Android 未验证）

---

# WP-05 第三阶段 Android 设备关联设计 QA

日期：2026-09-29。范围为 Kotlin 原生 Android 的执行手机本机关联码与管理手机核对确认两张页面；参考图的示例设备、示例用户、示例时间和假二维码均替换为真机与后端实际事实。

## 比较目标与证据

- source visual truth：`docs/design/android/local-association-code-v1.png` 与 `docs/design/android/device-association-confirm-v1.png`；同时受同名 prompt、`docs/design/android/DESIGN.md`、Android 页面规格和交付流程约束。
- implementation screenshots：`artifacts/design-qa/wp05-stage3/local-association-implementation-redacted.png` 与 `device-confirm-implementation.png`，来自 Samsung SM-S9110／Android 16 真机、原始尺寸 1080 × 2340 px；本机页共享证据已遮蔽真实二维码，截图保留真实状态栏和导航栏。
- combined comparisons：`artifacts/design-qa/wp05-stage3/local-association-comparison.png` 与 `artifacts/design-qa/wp05-stage3/device-confirm-comparison.png`；左侧参考，右侧真机实现，以相同高度归一化后并排检查。
- actual state：受控的临时原始截图曾由本机解码器确认二维码编码真实 `associationQrPayload`，随后共享证据只保留遮蔽版本；设备名来自 Android 机型，失效时间按设备本地时区显示。确认页来自 Provider Bearer 会话的只读 inspect 结果，姓名、脱敏手机号和设备标签均为后端事实。

## 视觉与语义核对

- 两页保持 `#F4F6FA` 浅灰画布、白色 12dp 卡片、`#172B4D` 深蓝正文、`#2459C4` 主按钮、`#DCE2EA` 分隔线及 16–20dp 主边距，没有参考规范禁止的渐变。
- 本机页保留返回箭头、标题／说明、设备标识、二维码主视觉、等待状态、两步说明、后续授权提示和返回接入说明；静态示意码替换为真实可解码二维码，原始关联码不以正文或复制控件暴露。
- 确认页保留添加设备返回入口、核对标题、提供者、验证手机号、目标设备、三项后续说明、明确确认、重新扫码及“不会把管理手机接入执行”的边界说明。三项后续说明为解释文本，不伪装成尚未实现的导航入口。
- 触控目标为 48–54dp；纵向内容可滚动，无横向溢出。关联码刷新入口在码实际过期前隐藏，避免静态稿没有依据的提前刷新动作。
- 参考图中的装饰手机图标和说明行图标未以字符、手绘 SVG 或占位图仿造；返回箭头使用 Android 主题资源，二维码使用 ZXing 从真实载荷生成。

## Findings 与迭代

- Pass 1：真机实现已覆盖两张设计的页面层级和业务文案；发现失效时间直接显示 UTC，且本机标签位于主卡片外。整改为设备本地 `HH:mm`，并把本机标签、二维码和等待状态收敛到同一主卡片。
- Pass 2：将顶部品牌栏改为参考方向的原生返回栏；补齐“在管理手机上操作”标题、提供者／验证手机号标签和设备标识核对说明；仅在关联码实际过期后展示刷新动作。
- Pass 3：真机点击扫码首次暴露 ZXing 的非传递 AndroidX Core 运行时缺类崩溃。显式加入 `androidx.core:core:1.15.0` 后重装复测，系统相机权限对话框及 `CaptureActivity` 取景页正常打开，无新增崩溃。
- Pass 4：非作者复核指出共享比较图可从真实二维码还原一次性关联码。已将持久化实现截图和并排比较图中的真实二维码区域遮蔽，只在受控临时材料上完成解码断言；后续复核与验收不得传阅未遮蔽二维码。
- 当前无可执行 P0、P1 或 P2 视觉 finding。相较参考图，真实系统字体、状态栏和机型文本造成的自然换行差异属于平台与真实数据差异，不影响层级、操作或语义。

## 真机交互核对

- 已验证本机根凭据落盘后 bootstrap、创建真实关联码、重启恢复、状态轮询、码失效时间和清数据后生成全新 installation；新身份未认领旧 device 或 association。
- 已验证管理身份经受保护开发读码通道登录、设备列表、关联载荷严格解析、只读 inspect、确认前核对页、显式确认、成功状态、返回列表及重启恢复。
- 已验证系统相机权限请求和真实扫码取景器能够打开；当前只有一台物理手机，因此二维码由同机生成时无法完成“第二台真机对准屏幕”的光学识别动作，该覆盖项留给正式双机验收，不以深链核对替代声明扫码已完成。

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
- Pass 3：正式验收提出两个 P3：登录模式的中性提示仍使用“注册”动词、示例页脚与系统导航安全区距离偏小。现已按模式分别显示“注册不会…”／“登录不会…”；运行态移除仅用于静态稿标识的“示例页面”页脚，并为滚动内容保留 72dp 底部安全内边距，不改变身份、会话或设备事实。
- 当前没有可执行的 P0、P1 或 P2 视觉差异。参考图的绿色勾选图标未单独复制；状态色和文案已完整传达语义，避免为装饰性小图标引入手制图形。

## 最终结果

真机实现忠实承接选定方向，同时按服务端事实纠正邀请初始状态。注册成功页明确说明管理登录不会接入本机；完整真机流程证据另记入 WP-04 交付记录。

final result: passed

---

# WP-14 第一阶段筹备项目设计 QA

2026-09-30，image-to-code按已选准备图/原prompt实现，仅元数据筹备，不背书批准、资源/执行、周期或通知送达。

## 输入与比较

- source visual truth：`docs/design/workbench/project-readiness-v1.png`，1464×1074；原prompt、README、页面规格§3及DESIGN.md约束语义。
- implementation：`artifacts/acceptance/product/B3/wp14-stage1-gate/readiness-desktop.png`，1465×1074 CSS/pixel，deviceScaleFactor1；另有full/980/700/390截图。实际隔离页面创建项目/负责人，邮箱保存但未发送，目标/素材/资源/周期未配置。源是含示例就绪事实的虚构筹备状态，不把其数量、日期、人员、资源当真实输入；比较同类骨架/视觉，非数据/操作逐像素一致。
- full-view comparison：`artifacts/design-qa/wp14-stage1/pass1-comparison.png`、`pass2-comparison.png`、`pass3-comparison.png`，同一输入左源右实际实现，尺寸2953×1074，24px间隔，未缩放；源少1px不拉伸。
- focused evidence：`pass3-table-comparison.png`，源box266,389,1421,781与实现303,419,1392,802，原像素细看表格/图标/文字；`pass3-mobile-remediation-comparison.png`左旧手机、右整改手机，不冒充源有手机稿。脚本仅组合已有证据，不AI重绘截图。

## Findings 与比较历史

1. Pass1 P2：透明返回按钮继承白字低对比；重复通用标题使清单下移且下方解释区缺失。改为蓝色text-button，收敛页头/项目标题，恢复两个说明区、白底摘要/8px面板；原失败截图保留。
2. Pass2：上项闭合；新P2手机需横滚才见影响/入口。改为逐行纵排“事实→缺项影响→入口”，保留语义表头，手机无写入控件。
3. Pass3：同真实项目重读并排复核，桌面六行与双说明区、返回对比保持；手机聚焦图显示原被隐藏的影响/入口。Playwright断言影响cell完整在700/390视口、全页不横溢出。首次精确accessible-name断言遗漏CSS辅助标签而超时，改为包含同一cell真实内容后通过，未删除可读性断言。

当前无可执行P0/P1/P2。P3：源为生成图，精确字形/图标尺寸自然不同；保留既有系统中文字体及DESIGN候选办公尺度，不声称冻结最终品牌token。

## 五个必查表面

- Fonts/typography：中文系统回退，24px项目标题、18px分区/14px正文；比生成图略小但沿候选规范，长文本可换行，手机label/事实无重叠截断。
- Spacing/layout：230px导航、连续白色信息区/细表格、24px间距、六行与两个下方说明区。真实保存表单在后，不复刻未实现确认按钮；980桌面/700与390只读可滚动、关键影响不横藏。
- Colors/tokens：#2459C4蓝、#172B4D正文、#F4F6FA画布、#DCE2EA边框，8px面板/6px控件；缺项不用成功绿，冲突黄仅表示需核对。
- Image/assets：无必需照片/插画，标准图标采用Phosphor；没有手绘SVG/CSS图画/emoji/假设备画面或人物。
- Copy/content：改“先确认方向”为“发布前确认方向，准备可并行推进”，删除运营界面的WP编号；邮箱保存不送达、所有运营可代办、不额外启动审批，缺项如实。

实际Playwright覆盖创建/丢响应同键恢复/未知请求冻结、跨导航草稿、两运营冲突与核对、负责人/邮箱、reload、客户必填、响应式只读；非预期console/page error0。应用内tab因安全策略校验服务不可用被拒绝，未弱化/绕过，IAB未打开；用户指定的独立标准Playwright渲染截图另作证据，RES-WP14-03保留，不自签原QA独立验收。

final result: passed
