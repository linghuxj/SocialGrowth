# 身份与设备关联的当前接口流程

更新：2026-10-06。依据当前正式控制器及客户端，替换首批接口草案。有效业务要求至 R-163；同一台手机可同时承担本人管理和本机执行用途，但身份、权限和任务意愿分别保存。这里描述已存在的接线，不签署真实短信、双机或全部 B1 验收。

## 正常路径与接续

| 步骤 | 当前接口／操作 | 事实与失败边界 |
| --- | --- | --- |
| 运营登录 | `POST /api/operator/login` | 已开通账号；认证失败不进入工作台 |
| 创建邀请 | `POST /api/operator/invitations` | 次数与期限；创建和复制不等于送达或成功注册 |
| 手机验证 | `POST /api/provider/phone-verifications`、`.../verify` | 用途和邀请绑定；开发验证码不代表真实短信 |
| 提供者注册／登录 | `POST /api/provider/register`、`.../login` | 注册最终原子检查名额；已有身份登录不再次扣减 |
| 安装身份 | `POST /api/installation/bootstrap` | 本机根凭据安全保存；重装不自动认领原设备 |
| 关联会话 | `POST /api/installation/association-sessions` | 核对当前安装；本机关联或另一手机扫码／手动输入走同一目标核对 |
| 解析并确认 | `POST /api/provider/association-sessions/inspect`、`.../confirm` | 管理身份、目标安装及会话分别验证；扫码本身不写归属 |
| 查询原确认 | `POST /api/provider/association-sessions/result` | 确认响应不明时查原结果，不另建归属 |
| 本人／运营／本机状态 | `POST /api/provider/devices/list`、`GET /api/operator/device-facts`、`POST /api/installation/state` | 当前归属及最小字段；旧版本不覆盖较新事实 |
| 网络和本机准备 | Android 当前步骤与[连接说明](android-pilot-onboarding.md) | 关联成功不等于网络、参与、动作许可或平台身份核验 |

接口定义见 [operator](../product/backend/src/operator.controller.ts)、[provider](../product/backend/src/provider.controller.ts)和 [installation](../product/backend/src/installation.controller.ts)。具体请求字段由[共享契约](../product/contracts/src/index.ts)及服务端实现校验，表中省略号沿用同一前缀。

## 权限与验证

运营使用同权 Cookie 会话及 CSRF；提供者和安装身份分别认证。退出管理不自动暂停执行，自动连接不自动参与业务。原 requestId／幂等键和当前版本保留；原结果未知时先查原结果。旧会话失效不能覆盖后继登录状态。

[工作包](engineering/delivery/work-packages.md)、[契约核对](engineering/delivery/contract-checklist.md)和[验收矩阵](engineering/delivery/acceptance-matrix.md)继续约束真实验收。原候选证据见[索引](engineering/delivery/records/README.md)，当前状态与配置边界见[当前实现](current-implementation.md)。
