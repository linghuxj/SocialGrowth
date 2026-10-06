# 公开手机接入 HTTP 服务

2026-10-06。用户明确先完成公开 HTTP 接入服务，其他环节暂不推进。

**本项已部署并通过验证。** 地址：[https://macbook-pro.tail3656e0.ts.net:8443/](https://macbook-pro.tail3656e0.ts.net:8443/)。HTTP 服务通过公网 HTTPS 提供，访问方不必先加入 Tailnet。

## 实际部署

- 现有 Mac 的 Tailscale 节点已具备 `funnel`／`https` 能力；复用 [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) 发布公网入口，没有购买服务器或修改 Tailnet 准入策略。
- HTTPS 8443 → `127.0.0.1:4330` 接入网关 → 原产品后端 `127.0.0.1:4320`。原后端与 Web 3100 进程保持运行，未将完整后台直接发布。
- `GET /` 为接入服务检查页，页面按钮实际读取 `GET /health/live`，显示当前后端结果。
- 公网仅转发以下 POST：`/api/installation/bootstrap`、`/api/installation/state`、`/api/installation/association-sessions`、`/api/provider/association-sessions/inspect`、`/api/provider/association-sessions/confirm`、`/api/provider/association-sessions/result`。沿用实际后端契约与鉴权，不制造接入成功状态。
- 运营、内部开发验证码、网络密钥及其他路径返回 404。仅转发合法 Bearer 令牌及 JSON 正文，丢弃调用方的转发头、Cookie 和开发令牌；请求正文限 32 KiB、上游超时 5 秒、网关总请求限每分钟 120 次。后端原有本机注册限流继续有效。
- 服务按本项部署目的保留运行：本地网关 Node PID 80186，工具会话 80390。Funnel 配置在现有 Tailscale 服务中后台运行。没有安装新的系统守护服务。

启动／恢复命令（先确认端口与现有 Funnel 配置，避免启动重复进程）：

```sh
pnpm serve:public-phone
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg --https=8443 http://127.0.0.1:4330
```

撤下本项公网入口：

```sh
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --https=8443 off
```

需要停止本地网关时，仅停止本轮网关进程或其前台命令；不要停止原 4320／3100 服务，也不使用 Funnel 全局 reset。

## 验证结果

- 真实 Playwright 从公网 IP `103.84.155.153` 访问 HTTPS 页面，断言响应实际连接该公网地址，避免电脑 MagicDNS 的 Tailnet 路径误判。真实点击“检查接入服务”，后端返回 200，页面显示“接入服务可用”。通过。
- Samsung RFCW40MYYCV 的当前网络为 WIFI，没有活动 VPN transport。手机直接访问同一 HTTPS URL，证书正常校验，公网目标 `103.84.155.153`，`/health/live` 返回 200 与实际产品后端 alive 结果。通过。
- 手机向 `/api/installation/bootstrap` 发送无效正文，收到实际契约 `INPUT_INVALID`／400，确认入口转发到真实接入接口；没有创建新安装身份。
- 手机向 `/api/installation/state` 发送合法契约元数据但不带令牌，收到 `AUTHENTICATION_REQUIRED`／401。通过。
- 手机请求 `/internal/development/provider-sms-codes/read`，收到 404。通过。
- 网关边界测试通过：禁止运营／开发／网络密钥路由、别名路径与错误方法；错误内容类型和超限正文不转发；调用方特权头不转发。此项为非 UI 补充测试，不表示完整新手机业务验收。
- 三个新增 TypeScript 文件检查与 `git diff --check` 通过。

复现浏览器验证：

```sh
SG_WEB_TARGET=product SG_PRODUCT_WEB_SCOPE=public-phone-access \
SG_PUBLIC_PHONE_INGRESS_IP=103.84.155.153 \
SOCIALGROWTH_VERIFICATION_OUTPUT=output/playwright/public-phone-access-20261006 \
pnpm test:playwright
```

入口 IP 可能随公网 DNS 更新；该参数只用于本轮浏览器验证，不改变系统 DNS。截图及真实结果保留在 `output/playwright/public-phone-access-20261006/`，包括 `result.json`、`public-service-ready.png`、手机网络与各接口响应。

## 本项边界

当前部署依赖这台 Mac、Tailscale 与原后端持续运行；不是独立云服务器部署。本轮未安装或配置手机 VPN、分发订阅、调整网络准入、配对 ADB 或验证 FB／YT，也未暴露开发验证码通道。公开接入地址可达已成立，完整新手机流程仍须按其余实际条件分别处理。


## 后续同机接入的受控路由补齐

早先表中网络密钥等不公开的描述只适用于首次公开地址检查。后续为实际 App 接入增加明确的提供者手机号验证／注册／登录、本人设备读取／关联／连接、设备控制及安装连接检查路由；所有受保护路由要求令牌并继续由真实后端验证当前身份、归属与安装代次。提供者协助读取只接受限定分页参数，设备路由只接受 UUID 和明确动作；没有公开运营接口、内部验证码读取或任意路径转发。

密钥仅按实际安装身份及私有内测配置核对后返回，回复不缓存，不记录正文／凭据；仍不是逐台正式准入。配对握手、端口上报使用单独的有界等候时间，其他路由维持 5 秒上游时限，正文仍限 32 KiB，调用方特权头不转发。

公开真实浏览器复核 `output/playwright/public-phone-single-phone-20261006/`：Playwright 从公网 `103.84.155.153` 点击服务检查，返回可用。真机管理登录与后续本机操作访问公开 HTTPS，原先无 VPN 的检查与当前已经启用 Tailscale 的检查分别留痕。
