# 手机初始化模板验证记录

日期：2026-09-21。规格见 [手机初始化业务模板](../specs/2026-09-21-device-initialization-template.md)。本轮仅增加业务选项与处理，不重排页面或修改样式；开始时已存在的 UI 未提交改动保留。

## 已执行

- `pnpm test`：129/129 通过，其中账号接入／初始化 22 项；为受控端口回归，不代表真实平台安装／登录／创建成功。
- `pnpm build:runtime`：通过。
- `pnpm build`：通过；构建不替代下面单独列出的 Web 类型检查。
- 新增及增补的 Web 业务文件 scoped oxlint：通过。
- `scripts/verify-device-initialization-web.mts`：通过真实 Web 操作完成 5 组断言，无页面异常、无 API 写请求、无设备或平台变更。使用既有无设备登记测试账号 `Playwright未绑定账号-1789962536145`，没有预置成功状态或 Mock。
- 浏览器断言：初始化默认关闭创建；父登录身份必填而未绑定的目标 ID 可选；明确授权后出现创建资料；切回单独核验恢复完整 ID 必填；资料不足阻止提交，不触发设备接管。

证据：`/Users/linghuxj/Documents/Codex/2026-09-20/new-chat/outputs/device-initialization-web/result.json` 与同目录 `initialization-form.png`。

## 影响与未验收

- Web `tsc --noEmit` 目前受另一批已有 UI 改动影响：`registry.tsx` 中 `allocated`、`allocatedAccountId`、`allocatedAt` 与现有 ContentIdentity 类型不一致，共 6 条错误。本轮未改动该文件，未据此宣称全仓类型检查通过。
- 新增的是按平台初始化模板，不是自动注册个人 Facebook／Google 登录账号。缺账号由人工分发；已有账号不一致时不擅自换号。
- 本地 Artemis 的普通操作和专用密码输入仅允许任务目标 App 包；跳至 Google 系统登录页面时通过原任务人工操作并返回目标 App 后复核。跨包凭证自动填充没有实现或验收。
- 没有用户指定的新平台资产创建资料，因此未执行真实创建、卸载、登出、清数据或公开发布，也未重置现有手机来模拟出厂设备。
- 此前 Artemis 模型 Broken pipe 属于另一个尚未实测确认恢复的阻断；本次 Web 表单和受控回归不能证明其已恢复。

真机退出判据：提供已授权父登录身份、目标 Page／频道及创建选项，在 Web 发起一次初始化任务，实际完成必要安装与人工协助，回传准确身份、管理权限及截图，再通过 Web 确认绑定；分别对 FB/YT 记录事实，不跨平台合并成功结论。
