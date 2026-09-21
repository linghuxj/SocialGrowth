# Artemis 人工密码输入扩展

这是对本机 Artemis 的小范围下游扩展，不是 Google 原生已支持的协议。
只向 Operator 挂载 `human_password_input`；判断页面、聚焦字段、点击登录和判断结果仍由 Agent 完成，没有 Facebook 坐标脚本。

部署到已配置好的 Artemis checkout：将 `socialgrowth_human_input.py` 和 `socialgrowth_supervision.py` 安装到 `artemis/tools/`，再在 checkout 应用 `operator-human-input.patch`（包含 Operator 白名单与 ActionSession 统一出口）。已应用时先 `git apply --reverse --check` 检查，不重复叠加；从旧补丁升级需逐项比对，不覆盖 checkout 内已有的代理适配修改。

SocialGrowth 启动 MCP 时传入运行时地址与一次性会话 capability；不传账号密码。缺少扩展的 checkout 会在启用协助时拒绝启动。升级 Artemis 后必须重新检查 Operator 工具注册点、`get_driver` 和屏幕 XML 契约，并运行本目录测试；此补丁需维护。

## 安全与范围

- 会话绑定任务、物理设备、应用、预期身份和截止时间；每会话最多一个密码待办。
- Web 显示截图与账号，操作人确认后通过本机认证接口提交。当前支持 1–128 个可打印 ASCII 字符；不做字符替换后继续登录。
- 密码不写 SQLite、WS 消息日志、模型上下文、命令行参数或剪贴板；仅内存暂存并一次领取。JS/Python 不保证字符串内存物理擦除，不能宣称硬件级零残留。
- 密码字段必须原生、受保护、已聚焦且属于目标包；工具使用原生 clearTextField 清空该唯一字段，复核为空后才创建待办。输入前重新检查同一字段、前台应用及清空后的账号标签。等待期间 Operator 不执行其他动作。
- 输入时临时关闭 Android 最后字符显露并恢复原设置；工具只填充，登录点击由 Agent 单次执行。输入成功不是认证成功。
- 过期、取消、页面改变、输入失败及进程重启均不重放输入。运行中会话禁止释放诊断设备接管。
- 验证码／2FA／CAPTCHA 仍停止并转人工；本补丁尚未实现验证码字段安全输入和续跑，不能宣称所有登录挑战已全自动打通。
- 平台账号不符不自动切换，Web 取消后由负责人重新分发。正常发布保留 Page／频道、权利、批准和最终发布授权检查。个人 Facebook Profile 只用于显式诊断，不伪造 Page 准入。
- 前次真实阻断已纳入修复：密码工具开始前登记次数，失败后运行时冻结动作，ActionSession 在实际出队前强制检查；不依赖 Agent 自觉停止。标签识别式敏感按钮限制仍不是覆盖所有页面的完整证明，详见 `docs/engineering/agent-supervision-guide.md`。

## 验证

- `pnpm test:all`：包括新 HTTP 角色隔离、一次消费、取消、超时、重启和旧业务安全回归。
- 用 Artemis `.venv/bin/python integrations/artemis/test_human_input.py` 验证字段安全限制（从 SocialGrowth 根目录执行）。
- 完整 Web 发起验收使用执行记录页“从 Web 启动完整验收”，需要服务端固定设备／素材配置和设备接管；密码只在后续人工待办中输入。此入口是诊断，不替代业务 Page 授权。
- `scripts/verify-human-login.mts` 是**显式人工授权才可运行**的单次真机随机密码验收：真实 Web 表单、真实运行时、一个 Artemis 任务、一次登录，绝不点击内容发布。运行前需启动 runtime/Web、保持设备接管，并提供 `SG_PLAYWRIGHT_MODULE`、输出目录和已有 `.env.runtime/.env.agent`。它不是成功登录验收，也不要重复运行尝试密码。
