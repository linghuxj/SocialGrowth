# 正式核心链路验证：2026-10-06

本记录保留早先检查时的结果。用户随后已完成订阅导入，后续网络共存验证见[当前手机网络记录](phone-network-coexistence-20261006.md)。不要把下列早先导入阻断作为手机的当前配置结论。

本轮未通过完整业务验收，未提交 Git。依据 `dev` 的未提交工作目录；HEAD 为 `3040899b368e9feaf91c509ea77319cf0c00841c`。Web 3100、后端 4320、正式执行服务 4318。手机为 Samsung SM-S9110，硬件序列号 RFCW40MYYCV。这里区分实际操作、源码接线及尚未验证的业务结果。

## 实际结果

| 节点 | 结果 | 证据与下一步 |
| --- | --- | --- |
| 正式 Web 登录、打开已有项目 | 通过 | Playwright 使用真实页面登录和选择项目；未创建测试成功状态 |
| 已上传素材 | 局部通过 | 页面显示 1 条上传记录及原文件字节已校验；本轮未新增上传，未确认公开使用权 |
| 内容 App 目标链接 | 未验证 | 默认 `TrackingLinkService` 的目标策略仍为 `null`；不能认定已有可用目标链接 |
| 平台 App 安装 | 已安装，安装流程未重验 | Facebook 581.0.0.45.58、Tailscale 1.102.4、FlClash 0.8.99 已在手机上；安装存在不代表新手机安装流程通过 |
| 手机业务上网 | 阻断 | 现有 FlClash 无配置；原订阅导入出现 YAML 解析错误，代理未启动 |
| 出口恢复 | 通过 | 已撤销临时 Macmini 出口，Tailscale 实际界面显示 Connected、Exit Node None；按 R-163 使用手机已有订阅 |
| Tailscale → ADB → Artemis | 局部通过 | 在 Exit Node None 下，经 `tailscale nc` 建立连接；独立回读硬件序列号匹配，Artemis 从网络 serial 实际读取界面；无 USB 回退 |
| 管理连接与订阅上网共存 | 未通过 | 当前管理连接可用，订阅未导入；不能用管理连接通过代替业务上网或共存通过 |
| 账号登录、账号检测 | 未通过本轮完整检查 | 本轮 Page 核验遇到“找不到网页／无法浏览功能表”；未提交账号密码或验证码，不据此认定账号正常 |
| Page／频道检查与创建 | 阻断 | 原 Page 身份核验超时，未形成可信映射；未创建 Page 或频道 |
| 内容发布与回执 | 未验证 | 当前业务计划桥只执行发布前准备，并停止在最终发布前；原结果仍未知，无实际发布链接或内容回执 |
| 数据检测、收集和整理 | 未验证 | 页面指标来源为 unknown，指标行数为 0；没有把缺数据当作真实零值，也未生成虚构内容指标 |
| 分析与复盘 | 未验证 | 当前没有可信复盘建议读取来源；不能把静态界面或工程测试计作业务复盘 |

## 原操作与网络处理

原 operation 为 `0ef94113-c6de-4171-b873-fd0c2bf62b53`，属于已有项目 `55fa34ae-71e8-4079-b870-985c88635382`。本轮从实际 Web 查询并恢复同一个已停止的身份核验；新建业务尝试及新建 preflight 操作均为 0。

实际 Artemis trace `cbae2922-278a-4e97-8811-e033cc229a6c` 在 Page 身份核验阶段超时。保留原 operation、unknown 结果、设备占用和证据，没有清空后重发内容。修复网络前不重复启动该业务核验。

用户明确不使用 Macmini 后，网络恢复 trace `d37dfec4-91dd-4922-8f6b-861ed2b66b7a` 实际把出口改回 None，并保留 Tailscale 连接。FlClash 检查确认无配置、VPN 开关关闭、核心未运行。

已从原用户记录找回订阅链接。本机请求返回 HTTP 200，但响应不能解析为标准 Clash YAML。手机导入 trace `05da0d98-b75a-40bf-b4e8-109139174389` 记录 `profileImported=false`、`importError=yaml_unmarshal_error`、`vpnEnabled=false`、`proxyCoreStarted=false`，Tailscale 保持 Connected／None。该维护任务到时停止，最终状态 cancelled；这是导入失败的观察证据，不是完整维护任务或业务验收通过。

最终远程读取在 2026-10-06 11:44:31 UTC 完成。网络 serial 为 `127.0.0.1:57095`，连接端口 42433，硬件序列号匹配。临时转接和 MCP 客户端已关闭。原订阅、响应、手机维护日志及可能含凭据的截图均保留于私有目录，不写入本文或 Git。

## 本轮必要修复

效果面板读取未启动的采集记录时，后端曾返回空 HTTP 200 正文。Web 无法解析 JSON，真实采集入口因此不可用。

GET 采集状态现返回 `{ collection: null }` 或 `{ collection: ... }`。Web 按同一响应结构读取。补充 HTTP 序列化测试通过；真实 Playwright 登录后查看效果页并点击“查询原采集状态”，返回 200、not_started、无错误，且“读取 Page 效果”入口可见。此修复不生成采集数据，也不证明指标采集通过。

后端构建、Web 类型检查、相关 lint、文档结构检查、正式工程布局检查和 `git diff --check` 通过。已有无关 lint 警告未修复。文档结构通过仅证明链接及需求归属完整。

## 可复现证据

真实 Web 最终状态检查：

```sh
SG_PRODUCT_WEB_SCOPE=core-chain-status \
SG_PRODUCT_CORE_QUERY_ORIGINAL=1 \
SG_PRODUCT_CORE_PROJECT_NAME='获准原文件字节验收-1791208369573' \
SG_PRODUCT_CORE_OUTPUT=output/playwright/core-chain-20261006/final-core-status \
pnpm test:playwright
```

保存脚本为 `scripts/verify-product-core-chain-status-playwright.mts`。结果目录包含必要截图和 `result.json`：diagnosticPassed=true、coreChainAccepted=false、businessMutations=0、browserErrors=0。原核验查询返回 unknown，并给出仅重新核验 Page 的入口；公开发布仍关闭。网络维护期间真实设备锁会拒绝恢复业务核验，维护结束后查询入口恢复，未因此修改该门禁。

原业务核验失败证据在 `output/playwright/core-chain-20261006/page-recovery/`。最终远程读取补充证据为 `output/playwright/core-chain-20261006/remote-adb-proof-without-exit.json`。这些是当前开发 Wi-Fi 环境的证据，不外推为零准备异地手机或完整发布业务通过。

## 阻断与分支问题

当前下一步核心阻断是订阅兼容性：需要该服务适配的客户端名称，或可被当前客户端实际解析的标准 Clash／Mihomo 私有配置。原链接已经找回，不要求再次提交。FlClash 非 VPN 服务在源码中存在；原生 App 是否使用该代理须在有效配置启动后实测。

后续发布还须核实素材公开使用权、真实 App 目标及发布参数，并连接真实发布、内容指标及复盘读取。当前工作台接线不代表这些结果已经存在。

分支问题仅记录：恢复身份核验时，新 trace 的终态更新可能被旧记录的 traceId 覆盖；本轮未修改历史记录或补写映射。后续恢复前须核对原 trace、当前设备锁及回执证据，不能把旧 trace 停止当作当前业务成功。其他页面占位、既有警告和未覆盖的新手机异常路径均未扩展修复。

提交条件仍是用户要求的完整核心链路无误。当前条件未满足，保留工作目录供继续验证，不合入 main、不创建发布标签。
