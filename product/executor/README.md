# 正式执行器边界

主入口仍只说明配置，保持 disabled；组件存在不等于允许运行手机。既有 Google Artemis 的已验证能力保留原环境和覆盖范围。

## 受控读屏 transport

`AdbReadScreenTransport` 实现 `PhoneFenceTransport<AdbScreenCapture>` 的一个具体端口。内部构造时固定原 device、holder、authorization、attempt、控制 generation、用途、准确 serial、ADB server IP/port，以及绝对规范化的可执行文件路径和 SHA-256。没有读取环境来启用、自动发现设备、切换端点或接受模型提供的命令。

`PhoneActionFence` 交接时传入已核验、冻结的新动作票。transport 再校验准确 tuple、serial、`business/read_screen`、非重放票和最多两秒的时间窗；可执行文件必须为本人或 root 所有、不可被组或其他用户写入、可执行，且启动时路径／文件身份／内容指纹仍匹配。文件检查后再次检查当前时间。

只有固定 argv：`-H <固定 IP> -P <固定端口> -s <固定 serial> exec-out screencap -p`。`spawn` 在 fence 写锁内同步发起，无 shell、await 或延迟回调；子进程环境只包含固定 ADB 端点变量，不继承凭据、动态加载或 Node 环境配置。该端口不能读层级、任意 shell、导航、安装、登录、创建身份或发布内容。

等待实际 child close 才处理回执，三秒超时或超过 16MiB 尝试终止客户端并拒绝；非零退出、信号、错误、缺少／坏 PNG CRC、异常解压／尺寸／扫描行、截断、尾随数据以及 1px headless 占位均拒绝。当前只接受非交错 8-bit RGB/RGBA PNG，解压最多 64MiB；不兼容的新格式也拒绝。返回授权内部消费者所需 pixels、尺寸与摘要，不落盘截图，不保留或输出 raw ADB stderr。

失败由本地 fence 保留 `unknown`，客户端进程退出不证明 ADB server、派生进程或手机实际操作已停止。停止、原操作核实、回执接续仍使用已有持久 ledger；不能因拿到 PNG 或重新启动进程清空 unknown。当前端口仍需 broker、真实目标／网络检查器、全部物理路径保护和当前手机参与事实才能接入。

**此模块只保护经它调用的单条读屏路径。** 它没有替换 Artemis 默认 adbutils driver、UIAutomator、人工补图、保护输入或 READ_ACTIONS 旁路，没有证明 OS 进程隔离或封闭其他 ADB 连接，也没有平台注册身份的独立核验能力。不注册 worker、不提供 HTTP 权限路由、不加入自动启动，不读取或修改私密模型配置。真实接线仍须先完成这些边界及原未决停止确认。

补充组件验证：根执行 `pnpm --filter @socialgrowth/product-executor test`。新增检查使用真实 OS 子进程，但可执行文件、像素和 authority 全部是明确的合成 fixture；不是实际 ADB、设备或平台验收。Web 验证始终通过根 `pnpm test:playwright`。
