# Google Artemis 与三星真机发布验证及阻断清单

日期：2026-09-20

范围：当前本地分支 `feature/first-loop-implementation`、三星 Android 真机、Facebook Reels 发布前流程。
安全边界：未点击最终发布按钮，未保存草稿，未产生公开帖子；未修改原始视频。

## 一、结论

项目业务路线确实指定 Google Artemis 作为纯真机自动化底座。当前仓库中的 `apps/artemis-controller` 已实现 design-v1 类型、指定设备/账号路由、去重、异常和回执语义，但仍是 SocialGrowth 自建控制层；当前依赖为空，也没有 Google Artemis MCP/SDK、WebSocket Agent、真实设备任务下发或证据回传接入。

现有代码测试全部通过。三星真机与 Facebook 原生 App 的现场路径已验证到最终 `Share now` 页面，素材可见、可选择、可编辑，公开受众选项存在。由于真实业务参数和公开发布授权未确认，本轮安全退出，没有提交。

因此当前状态是：

- **受控业务逻辑通过**；
- **单机 Facebook 发布前路径通过**；
- **真实公开发布未执行**；
- **SocialGrowth → Google Artemis → 真机 → 回执的产品闭环未接入**；
- **YouTube 真机路径未具备条件**。

## 二、已执行验证

### 2.1 代码与构建

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 跨模块首条闭环 | `npm run test:first-loop` | 3/3 通过 |
| Web 领域逻辑 | `apps/web-console: npm test` | 28/28 通过 |
| Web 构建 | `apps/web-console: npm run build` | 通过 |
| Artemis Controller | `npm test && npm run build && npm run lint` | 5/5、构建、lint 全通过 |
| AI Engine | `npm run build` | 通过 |
| Shortlink Service | `npm run build` | 通过 |

上述结果证明当前本地代码的受控状态和规则没有回归，不代表真实外部服务或平台发布已经接入。

### 2.2 设备与素材

- 真机：Samsung SM-S9110，ADB 序列号 `RFCW40MYYCV`，状态 `device`。
- Android：16；显示区域 1080×2340；Wi-Fi 已连接并通过系统验证；可用存储约 208 GB。
- Facebook：已安装，账号处于登录后的个人资料/Reels 界面；已允许读取视频。
- YouTube：设备未安装 `com.google.android.youtube`。
- 原始候选：`/Users/linghuxj/Downloads/切片/将门逆子/将门逆子-pxy-8.15-二创 (7).mp4`。
- 测试副本：从原始候选前 60 秒生成，720×1280、H.264/AAC、60.066667 秒、9,989,392 字节。
- 测试副本 SHA-256：`5fe19c6d1fe5e2c636a12ee7f559ecc177ebc04876d30e2525e85627ce40c4dd`。
- 手机路径：`/sdcard/Movies/SocialGrowth/socialgrowth-fb-preflight-20260920.mp4`；已触发媒体扫描并被 Facebook 相册识别为 1 分钟视频。

测试副本位于临时目录及设备测试目录，原始文件没有改动。

### 2.3 Facebook 原生 App 路径

已实际完成：

1. 从登录后的 Facebook 进入 Reels。
2. 进入 `Create reel`。
3. 在 Gallery 中识别并选择本轮导入的 1 分钟视频。
4. 进入音频、文字、特效、贴纸、剪辑页面。
5. 点击 `Next` 进入最终 `New reel` 页面。
6. 确认描述、受众、Story、Instagram、Tag、Location、AI Label、Topics、Save as draft 与 `Share now` 控件存在。
7. 打开受众选择，确认 `Public / Friends / Friends except / Specific friends / Only me` 可选。
8. 不改变受众、不填写文案、不保存草稿、不点击 `Share now`，逐层退出到 Reels。

最终提交页证据：

- `artifacts/reports/2026-09-20-device-publishing-verification/facebook-final-submit-screen.png`
- `artifacts/reports/2026-09-20-device-publishing-verification/facebook-final-submit-screen-overlay.png`

现场默认受众为 `Friends`，不是业务所需的公开发布；页面明确提供 AI 内容标签入口。

## 三、阻断清单

| 编号 | 优先级 | 阻断事实 | 影响 | 责任建议 | 完成验收条件 |
| --- | --- | --- | --- | --- | --- |
| DP-01 | P0 | `artemis-controller` 没有 Google Artemis MCP/SDK/Agent 接入，默认执行器返回 `EXECUTOR_NOT_CONFIGURED` | 控制台任务不能真实下发到设备 | Artemis/后端研发 | 固定实际使用的 Artemis 版本和部署方式；实现单一传输适配；指定本机序列号执行测试任务并返回真实 trace/receipt |
| DP-02 | P0 | Web 控制台和 Controller 没有运行时 API/队列连接；Web 仍是浏览器本地存储 | 批准和排期不会进入设备队列 | 全栈/后端研发 | 从批准排期创建唯一 task/attempt；Controller 可读取并按设备、平台、账号精确派发；刷新后状态不丢失 |
| DP-03 | P0 | 当前素材通过人工 `adb push` 导入，未实现对象存储/预签名下载、SHA-256 端侧校验和 MediaStore 入库 | 设备无法自主、安全取得任务素材 | 端侧/存储研发 | Agent 下载指定资产、校验哈希、写入媒体库；过期 URL 不创建第二次发布尝试；失败返回结构化原因 |
| DP-04 | P0 | 真实执行证据没有回传至 SocialGrowth；现有截图与 UI 层级为人工采集 | 无法可靠判定 `published/unknown/confirmed_not_published` | Artemis/后端研发 | 回传任务关联截图、trace、时间、设备、账号及发布事实；`published` 必含可核对 Post ID/URL 与证据引用 |
| DP-05 | P0 | 公开发布参数未确认：当前默认受众是 Friends，文案为空，AI Label 关闭，素材权利/音乐/二创授权未登记 | 不能安全点击 `Share now` | 运营/内容权利负责人 | 明确账号身份、Public 受众、最终文案、AI 标签判定、素材/配音/音乐授权及一次发布批准，并形成批准记录 |
| DP-06 | P0 | YouTube App 未安装，频道登录和账号绑定未知 | YouTube Shorts 路径完全无法验收 | 设备运营/账号负责人 | 安装官方 YouTube 或 Studio；确认唯一频道登录、上传权限、儿童受众设置、可见性和通知；完成发布前及一次授权发布验收 |
| DP-07 | P1 | 真机上的实际 Facebook 账号/设备绑定尚未写入权威配置，仓库只有示例配置 | 调度器无法证明任务发给正确账号 | 账号运营/后端研发 | 建立不含凭据的 device-account binding；会话核对真实登录账号；不匹配时拒绝执行并留痕 |
| DP-08 | P1 | 没有平台自动化许可/账号所有方授权的接入记录 | 即使技术可执行，也不能据此认定允许规模化自动发布 | 合规/业务负责人 | 记录账号所有权、操作授权、适用平台条款核查和允许的自动化范围；结果只授权对应账号/动作 |
| DP-09 | P1 | 发布完成后的公开可见性、处理状态、重复内容/版权通知和指标回采未接入 | 点击提交后仍无法形成完整验收 | 后端/数据/运营 | 等待处理完成；从外部可见面核对帖子；记录版权/限制通知；回采来源、时间和指标定义 |
| DP-10 | P2 | 本轮测试脚本为一次性 ADB 现场步骤，未形成可重复的 Artemis 场景和选择器策略 | App UI 更新后无法稳定回归 | 移动自动化测试 | 建立动态定位优先、坐标兜底的 FB/YT 发布前测试；敏感最终提交设置显式审批门；保存 trace 和截图 |

## 四、建议交接顺序

1. 运营先关闭 DP-05：确认内容权利、目标 Facebook 身份、公开受众、文案和 AI 标签。
2. 设备负责人关闭 DP-06、DP-07：安装并绑定 YouTube，登记当前 Facebook/YouTube 唯一账号映射。
3. Artemis 研发处理 DP-01、DP-03、DP-04、DP-10：先用一台三星真机跑通任务、素材和回执，不先扩多设备。
4. 后端/全栈处理 DP-02：把 Web 批准排期与 Controller 权威任务队列连接。
5. 获得明确的一次真实发布批准后，在 Facebook 和 YouTube 分别执行一条；逐平台取得公开 URL、截图和回执。
6. 最后处理 DP-09，补齐公开可见性与指标回采，再宣布首条真实闭环验收。

## 五、当前可交付判断

- 可交付：本地业务逻辑、Controller 受控调度规则、三星真机 Facebook 发布前流程和阻断证据。
- 不可交付：Google Artemis 驱动的 SocialGrowth 自动发布闭环、Facebook 真实公开发布、YouTube 真机发布、生产持久化和真实指标闭环。
- 不得用本次到达 `Share now` 页面替代公开发布成功，也不得用手工 ADB 步骤替代 Google Artemis 产品接入验收。
