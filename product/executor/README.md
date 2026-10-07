# 正式执行器边界

2026-10-06：既有执行服务已并入 `src/runtime/`，必要共享规则和回执契约在 `src/runtime/domain/`。主入口默认启动这一个正式执行服务；显式 `disabled` 可关闭启动。入口不自动启动设备 worker。组件存在不等于手机获得业务动作许可，Google Artemis 的原证据仍按原环境和范围保留。

从根目录运行 `pnpm executor:start`；复用原 `.env.runtime`、`.env.agent` 和 `.runtime`，不要重新初始化、迁移数据库或重放未知任务。Web 操作统一在正式运营端“执行与人工协助”。`pnpm --filter @socialgrowth/product-executor test` 为不操作手机的补充回归；`test:device` 需要核对真实设备和在途任务，`test:storage` 需要真实 MinIO，两者不替代 Playwright 验收。

## 受控读屏 transport

`AdbReadScreenTransport` 实现 `PhoneFenceTransport<AdbScreenCapture>` 的一个具体端口。内部构造时固定原 device、holder、authorization、attempt、控制 generation、用途、准确 serial、ADB server IP/port，以及绝对规范化的可执行文件路径和 SHA-256。没有读取环境来启用、自动发现设备、切换端点或接受模型提供的命令。

`PhoneActionFence` 交接时传入已核验、冻结的新动作票。transport 再校验准确 tuple、serial、`business/read_screen`、非重放票和最多两秒的时间窗；可执行文件必须为本人或 root 所有、不可被组或其他用户写入、可执行，且启动时路径／文件身份／内容指纹仍匹配。文件检查后再次检查当前时间。

只有固定 argv：`-H <固定 IP> -P <固定端口> -s <固定 serial> exec-out screencap -p`。`spawn` 在 fence 写锁内同步发起，无 shell、await 或延迟回调；子进程环境只包含固定 ADB 端点变量，不继承凭据、动态加载或 Node 环境配置。该端口不能读层级、任意 shell、导航、安装、登录、创建身份或发布内容。

等待实际 child close 才处理回执，三秒超时或超过 16MiB 尝试终止客户端并拒绝；非零退出、信号、错误、缺少／坏 PNG CRC、异常解压／尺寸／扫描行、截断、尾随数据以及 1px headless 占位均拒绝。当前只接受非交错 8-bit RGB/RGBA PNG，解压最多 64MiB；不兼容的新格式也拒绝。返回授权内部消费者所需 pixels、尺寸与摘要，不落盘截图，不保留或输出 raw ADB stderr。

失败由本地 fence 保留 `unknown`，客户端进程退出不证明 ADB server、派生进程或手机实际操作已停止。停止、原操作核实、回执接续仍使用已有持久 ledger；不能因拿到 PNG 或重新启动进程清空 unknown。当前端口仍需 broker、真实目标／网络检查器、全部物理路径保护和当前手机参与事实才能接入。

**此模块只保护经它调用的单条读屏路径。** 它没有替换 Artemis 默认 adbutils driver、UIAutomator、人工补图、保护输入或 READ_ACTIONS 旁路，没有证明 OS 进程隔离或封闭其他 ADB 连接，也没有平台注册身份的独立核验能力。不注册 worker、不提供 HTTP 权限路由、不加入自动启动，不读取或修改私密模型配置。真实接线仍须先完成这些边界及原未决停止确认。

补充组件验证：根执行 `pnpm --filter @socialgrowth/product-executor test`。新增检查使用真实 OS 子进程，但可执行文件、像素和 authority 全部是明确的合成 fixture；不是实际 ADB、设备或平台验收。Web 验证始终通过根 `pnpm test:playwright`。

## Artemis 私有读屏接线

`ArtemisReadScreenBridge` 以当前 holder 的准确原 tuple 创建私有 Unix socket，仅允许当前用户的规范化 0700 父目录和 0600 socket，拒绝已有文件。内部一次访问 token 和 scope digest 只通过可信 task 进程启动输入交接，不进入模型、环境开关、HTTP 或普通日志。socket 请求只含协议、原 requestId、token 和 digest；不收 device／command／kind／手机事实。最多 1024 bytes、16 条本地连接、一个 frame。每个 requestId 就是 ledger 原 actionId，所有读取经 `PhoneActionFence.execute`，重放不再次执行或缓存截图；连接丢失不取消／清空原动作。执行中暂停、替换或租约过期后不返 pixels，原回执仍保留。关闭 IPC 不等于手机停止。

`integrations/artemis/socialgrowth_read_screen.py` 只使用 AF_UNIX，核验文件归属／权限／规范路径和原 socket inode；每次读取新 UUID，拒绝错误协议／身份／摘要／尺寸、截断或额外内容，不自动重连／重试，不直接 ADB 或返回占位截图。

`socialgrowth_read_only_driver.py` 为实际 SDK `BaseDeviceDriver` 的实现，经这条 bridge 构造真实 `ScreenData`；没有 hierarchy 或猜测 package，只有实际 capture 后才知道尺寸。专属、全新 task 进程可用 `bind_read_only_context(ctx, bridge)` 绑定准确 serial，拒绝已有 raw driver／client 或第二次绑定，缓存 driver、raw adb／UI 客户端必须保持绑定。disconnect 只拒绝新读屏，不提供停止证明。

绑定同时在该 Python 进程内拒绝已核对的 raw Android driver／UIAutomator／adbutils connection／AdbSession 调用，并用 Python audit hook 拒绝新 subprocess／os.system／exec／fork。拒绝采用 `PhysicalPathDenied(BaseException)`，越过 SDK 捕获 `Exception` 后的 raw／headless 回退，不能把拒绝转换成假的 PNG。这个 hook 永久作用于专属进程，不能在共享 MCP／daemon 进程上原地绑定。它不是 OS sandbox，不能封闭其他进程、预先捕获的原始方法、任意 native library 或全部网络路径；不产生 `allPathsFenced=true`。

本仓库 supervision／human_input／observer overlay 已增加受绑定上下文分支：只暴露获准读屏／等待及 note 工具；层级、保护输入、人工补图／刷新、安装和写操作均不暴露／拒绝；observer 使用相同 bridge，拒绝后无 ADB fallback。未绑定的既有执行适配保留其原行为。**没有将这些 overlay 复制到现有 SDK checkout 或注册正式 worker**，SDK 上原有外来修改不被覆盖。实际接入前还须专属进程及完整 OS／网络／目标边界、当前参与和原未决停止证明，不能仅凭这些类或 hook 放行 executor。

补充 SDK 组合检查：根执行 `pnpm --filter @socialgrowth/product-executor exec tsx --test src/artemis-read-screen-bridge.sdk-test.ts`，使用本地 SDK `.venv/bin/python` 和真实 SDK 类型／factory、私有 socket、ledger 及有界 transport，但 authority／可执行文件／pixels 均为合成 fixture；不会启动模型、实际 adb 或手机。Python codec 拒绝检查使用 `PYTHONPATH=integrations/artemis PYTHONDONTWRITEBYTECODE=1 integrations/google-artemis/.venv/bin/python -m unittest test_read_screen`。
