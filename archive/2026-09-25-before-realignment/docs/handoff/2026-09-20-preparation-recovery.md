# 准备期自动复查与保守恢复交接

日期：2026-09-20；接续 119b524。实现同身份/任务/有效授权、未进入设备执行时自动复查；范围变化重新批准；结果不明不重跑。

## 实现及运行

- SQLite 新增 preparations/device_holds，不迁移 running/unknown 为可重试，不删除历史。
- WS 新增 PullPreparation、PreparationReport、BeginExecution；旧 PullTask 不能绕过。准备期不创建 publicationAttempt、不作废批准；租约最长 10 分钟，ready 有效 30 秒，失败退避 15 秒至 5 分钟。
- 准备只有确定性 App 补装、前台检查、Artemis 被动观察。完整绑定 URL 精确可见是前提，不替代执行期 Page/频道类型核验；不调用自主模型导航或账号切换。
- 窗口到期或任务/批准/排期/绑定/权利/授权变化停止旧任务并要求重批。BeginExecution 确认丢失按已开始处理，超时 unknown，不能再次操作。
- 前台 worker 由操作者手动运行 `npm run runtime:worker`，本轮没有启动常驻服务。同设备使用同 ledger；进程互斥和服务器租约防重复派发。
- 控制台展示准备原因、下一检查时间，并提供人工接管/交还。检查/执行中不抢占，交还不授予发布权、不清除 unknown。

## Artemis 兼容修补

保留本地已有路由，在实际 OpenAI 传输上将结构化输出统一为 function_calling，wrapper provider 对齐实际客户端。代理 SDK 重试为 0，由 Artemis 分类网关处理；单请求超时上限 30 秒。

按 HTTPX 序列化计算全请求 JSON（含 schema、图像）预算，默认 786432 bytes，环境变量 ARTEMIS_PROXY_MAX_BODY_BYTES 可调整；超限本地永久失败，不发送、不盲重试。此值不是已确认代理上限，不是自动压缩算法。原图片历史限制继续生效。

本轮增量补丁 `services/execution-runtime/patches/artemis-local-preparation-proxy.patch` 以已有本地强制 OpenAI 路由及前一份 proxy-compat 补丁为基线，使用 git apply --check 后应用。外部 Artemis 用户改动未整体提交，密钥未入库。

## 实测与阻断

- 实际代理 CheckReport 小探针：HTTP 200，2.20 秒，空 verdicts 解析成功，0 设备操作；不能推定整个自主任务稳定。
- 2026-09-20 08:31:34 UTC 真机：RFCW40MYYCV 在线，FB 549.0.0.61.62、YT 21.37.42 均安装。Artemis 层级读取成功，摘要 b397dcbf1b41ef380cc91b420d6d2a81b4b8ef41bebe0ae2e26e7c1248a43989。前台为三星 Launcher，没有平台身份 URL；没有打开 App、处理登录或公开发布。
- 旧 YT 登录错误本次未复核；桌面没有错误不能说明登录恢复。
- 尚缺真实 FB Page/YT 频道绑定、所有方授权、素材/音乐权利及本次公开发布批准。不能用测试占位数据补齐。
- 任意页面自动打开 App/导航到身份信息尚缺动作级隔离；目前人工展示正确 App 完整身份链接后交还。此项是残余阻断，不能宣称全自动业务验收。
- 自主 preflight 最终提交禁令仍是指令约束；未公开发布、未部署、未平台指标回采、未进行浏览器点击验收。

## 验证

运行时 36、Controller 8、业务集成 3、Web 业务模型 28、Artemis 59 项通过，共 134 项。运行时 build/lint、Web tsc、改动文件 lint、生产构建通过。整仓历史 Web lint 不列为通过。完整真机账号恢复与业务闭环仍待上述真实输入。
