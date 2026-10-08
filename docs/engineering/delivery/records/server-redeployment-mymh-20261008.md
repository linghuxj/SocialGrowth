# mymh 空库重新部署（2026-10-08）

用户要求重新部署到 `ssh root@mymh`，随后明确域名改为 `sg.mhtm.top`，继续不迁移数据、初始化新库。原服务器及其数据保留。

## 固定版本与部署

- 新服务器：`47.107.148.57`，阿里云深圳 `cn-shenzhen`，Ubuntu 26.04.1 LTS，x86_64，4 CPU、约 16 GiB 内存。实际资源与早期香港服务器规格不同。
- 服务端沿用已通过 main CI 的固定版本 `e2b64fba0067cdaf809d0436908a70d840bc43b1`；[CI 37651747665](https://github.com/linghuxj/SocialGrowth/actions/runs/37651747665) 成功。本次没有新增服务端代码、合并 main 或把部署等同于完整 B1 验收。
- 目录：`/opt/socialgrowth/releases/e2b64fba0067cdaf809d0436908a70d840bc43b1`；`/opt/socialgrowth/current` 指向该目录。使用 `compose.production.yml` 与 `compose.execution.yml`，Docker 29.1.3、Compose 2.40.3。
- 复用原固定镜像，导入后核对 backend/executor/web 镜像 ID 和 revision 标签一致；未从浮动上游重新构建。Artemis 上游为 `351ca8422f7b5b54e80a9c1ce03a222e02415b6b`，包含原项目补丁。
- 传输使用 SSH；为避免经 Mac 中转造成的低速，临时创建了仅允许新服务器经原跳板读取指定镜像的 SSH 访问，带来源 IP、命令/转发目标和到期限制。传输完成已删除两端授权及新服务器私钥，旧部署未停止。
- PostgreSQL 17.11、Redis 8.2.1、backend、executor、web 五个容器均运行；具有健康检查的容器均 healthy。仅 Web 发布宿主机 TCP 80/443；数据库、Redis、后端和执行器不发布公网端口。执行器共享 backend 网络命名空间，使用回环 4318。
- 48 项数据库迁移完成。初始管理员使用原受保护登录配置，通过正式 `operator-admin initialize` 创建；业务项目、提供方、手机及关联均为 0，执行任务和检查均为 0。新认证 pepper、数据库口令及执行器令牌独立生成。

## 配置位置与保留内容

- `/opt/socialgrowth/config/.env.production`：域名 `sg.mhtm.top`、OSS S3 兼容素材存储、原阿里云短信配置、临时验证码模式 `temporary_api`、执行器连接及 B1 启用配置。
- `/opt/socialgrowth/config/.env.executor-standby`：执行器认证、OSS 截图存储；设备 token 集合为空。
- `/opt/socialgrowth/private/artemis.env`、`artemis.jsonc`：原模型与 Artemis 配置；`media-credential-keys.json` 保留原密钥。
- `/opt/socialgrowth/config/bootstrap-operator.json`：初始管理员受保护登录配置。所有凭据文件保持 0600，不进入 Git、公开下载目录或报告。
- `/opt/socialgrowth/private/adb-standby` 与 `/opt/socialgrowth/runtime-standby` 为新空状态，归容器 UID 1000 持有。未导入旧 ADB 信任、执行 SQLite 或业务绑定。
- 手机管理网络的原接入密钥通过受保护文件保留，期限为 `2026-10-14T10:10:11.059Z`；`pilot-network.json` 的旧手机 allowlist 已清空，不给新空库导入旧设备授权。新增手机如走该配置入口，需明确登记本次真实安装。
- Tailscale 宿主机已由用户在 `mhtongm@gmail.com` 下确认连接，节点 `sg-production-shenzhen`，IPv4 `100.100.5.116`。加入后独立核验 Running 及无 health 告警，容器能查询宿主 socket。
- 为避免 Tailscale 对 100.64/10 的防伪规则误拦阿里云 DNS 回包，保留仅允许 eth0 上阿里云两台解析器 TCP/UDP 53 已建立连接回包的规则，并配置 tailscaled 的 ExecStartPost；未关闭其余防伪规则。
- Redis 仍为 Docker 服务；现有队列组件未注册，不因 Redis healthy 宣称任务队列启用。未部署 MinIO。

## 域名、APK 与验证

- 用户确认 DNS/安全组已配置；公开解析 `sg.mhtm.top` A 为 `47.107.148.57`，未观察到 AAAA。HTTPS 实际返回正式页面与后端 health，证书主体为 `sg.mhtm.top`，Let's Encrypt 签发，有效至 2027-01-06 UTC。这里只记录公网可达，备案状态未独立核验。
- 使用已有正式签名重新构建新域名 APK，源代码固定为 dev `40d6e2487e9ed13ce57a86aee4a880fa3023f53f`，包含既有通知补发和脱敏诊断修复；服务端接口与本次 main 版本兼容。APK 仍为 B1 候选，不等于正式实机验收通过。
- APK `1.0.2-b1.2`，versionCode `6`，HTTPS API `https://sg.mhtm.top`，正式证书 SHA256 `0d8947fbdaaa834db01b3d2f8cdebd5856044cc31b313811205aae0adff13c43`。构建与 apksigner 校验通过；本机受保护 Android 发布配置同步新域名及版本输入。
- 下载：`https://sg.mhtm.top/downloads/socialgrowth.apk`；SHA256 `3ea396da02429892ddc355969d6500cf87052a42ec4427b4f7a84fa61f5abb20`。从公网重新下载核验完整哈希一致。未操作手机安装或清除 App 数据。
- 实际 Web Playwright：管理员登录、项目页、刷新保留会话、退出 4 项通过；执行控制台 6 项通过，任务/作业为 0，没有发起手机任务。
- 容器中核验 ADB 37.0.1、Python 3.12.15、ffmpeg、私有配置挂载；Artemis 模型 describe 成功，MCP stdio connect/listTools 的必需工具通过；原模型接口已鉴权返回模型元数据，没有模型生成请求或手机动作。
- 新域名下真实手机注册、关联、B1 配对、管理网络切换和 VPN 共存恢复未验证；新手机无旧信任的首次接入仍未完成。真实 OSS 素材流程、短信送达和公开发布未在本次部署验证。

可复现验证入口（凭据只通过受保护文件/环境读取）：

```sh
SG_PRODUCT_WEB_URL=https://sg.mhtm.top \
SG_PRODUCT_DEPLOYMENT_LOGIN_FILE=/absolute/protected/bootstrap-operator.json \
SG_PRODUCT_WEB_SCOPE=deployment pnpm test:playwright
# executor-console 使用受保护包装器加载 SG_PRODUCT_TEST_LOGIN_NAME/PASSWORD。
```

本轮私有脚本、命令日志、截图与结果保留在 `.runtime/redeploy-mymh-20261008/`（0700）；服务器操作脚本和状态保留在 `/opt/socialgrowth/staging/`。部署记录补充提交在 dev，main 固定部署版本不变。
