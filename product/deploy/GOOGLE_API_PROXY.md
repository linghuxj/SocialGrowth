# Google 模型专项出口

本配置仅供官方 Gemini API 请求使用。固定单一节点，不启用服务器 VPN、TUN、全局 HTTP 代理、默认路由或 Tailscale Exit Node。

## 配置位置

- `/opt/socialgrowth/private/google-api-proxy.private.yaml`：受保护的单节点配置，权限 `600`、UID `1000`。不得提交 Git 或放入镜像。
- `/opt/socialgrowth/private/artemis.env`：`SG_GOOGLE_API_PROXY=http://127.0.0.1:17891`、`ARTEMIS_LLM_PROVIDER=google`、`ARTEMIS_DEFAULT_MODEL=gemini-3.8-flash`。保留用户配置的 `GOOGLE_API_KEY`，`OPENAI_BASE_URL` 留空。
- `/opt/socialgrowth/config/.env.production`：`SG_GOOGLE_API_PROXY_CONFIG=/opt/socialgrowth/private/google-api-proxy.private.yaml`。
- Compose 在现有 production、execution、phone-initialization 文件之后追加 `compose.google-api-proxy.yml`。

Mihomo 使用固定镜像摘要，与 backend/executor 共用网络命名空间，只监听 `127.0.0.1:17891`，不开放宿主机端口；重建 backend 时须同时重建 proxy、executor。容器无网络管理能力，内存上限 128 MiB、CPU 上限 0.5 核。

## 私密节点配置要求

只保存用户确认的 `🇹🇼 台湾3-VIP88a-谷歌学术` 节点。`port: 17891`、`bind-address: 127.0.0.1`、`allow-lan: false`，禁用 SOCKS/mixed、DNS、TUN 和控制 API。规则只有：

```yaml
rules:
  - DOMAIN,generativelanguage.googleapis.com,🇹🇼 台湾3-VIP88a-谷歌学术
  - MATCH,REJECT
```

节点凭据保持在上述私密文件中，不设置自动选点或 DIRECT 回退。节点失败时 Google 请求报错，不能回落到香港直接出口。

## 客户端范围与验证

`google_proxy.py` 只为 Google SDK 生成显式 client_args；支持 LangChain 同步/异步、Explorer/VideoAnalyzer 原生 Google SDK、文件上传及预热客户端。不会设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`。未配置时保持原 SDK 行为，非 loopback 地址及带凭据的代理地址拒绝加载。

`google-client.patch` 在已有 `socialgrowth.patch` 后应用，便于保持现有执行权限约束。构建必须检查补丁与固定上游兼容。

验证命令：

```sh
python3 -m unittest discover -s product/deploy/artemis -p 'test_google_proxy.py' -v
```

上线前后另验证官方模型真实调用、非 Google 域名拒绝、宿主机路由、独立服务健康、真实 Web 登录和页面状态。模型连接通过不代表手机环境初始化、新手机接入或长期稳定性验收完成；不得因此自动清除历史未知任务或开启手机初始化。

## 停用

在 `artemis.env` 中删除 `SG_GOOGLE_API_PROXY`，重启 backend/executor；停止 proxy 服务即可。保持 `OPENAI_BASE_URL` 空值以继续使用官方 Google 客户端。香港直连可能再次收到地区不支持错误。
