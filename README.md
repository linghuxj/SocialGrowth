# SocialGrowth

远程实体手机媒体运营产品。当前只维护 `product/` 正式工程：React Web、NestJS Backend、共享契约、Artemis 执行器和 Kotlin Android。业务范围由需求确认约束；源码存在、局部检查通过和正式发布分别判断。

所有开发在 `dev`；`main` 管理满足部署条件的固定版本。当前工作目录包含尚未提交的业务和迁移修改，不等同于 `main` 已部署版本。分支与验证规则见 [CLAUDE.md](CLAUDE.md)。

- [当前正式实现](docs/current-implementation.md)：实际入口、接线、配置条件与未完成范围。
- [文档索引](docs/README.md)：当前使用顺序和文档用途。
- [有效需求](docs/current-requirements-summary.md)及[确认来源](docs/requirements-alignment.md)：目标与业务边界，不作为已实现清单。
- [技术说明](docs/technical-design.md)、[Android 接入操作](docs/android-pilot-onboarding.md)及[开发与验收](docs/engineering/delivery/README.md)。
- [业务术语](CONTEXT.md)、[工程规范](CLAUDE.md)及[Agent 规范](AGENTS.md)。

## 安装与启动

```sh
pnpm install --frozen-lockfile
pnpm dev
```

正式 Web 为 `http://127.0.0.1:3100`，后端为 4320，配置的执行服务为 4318。使用同一运营登录进入“执行与人工协助”。已有配置和数据库保持原位置；统一启动不自动执行手机任务。验证使用 `pnpm test:playwright`，范围由 `SG_PRODUCT_WEB_SCOPE` 选择。

当前代码接线与业务验收限制见[实现说明](docs/current-implementation.md)。原未知结果和占用保留；没有据代码清理宣布发布。工程处置见[执行器迁移](docs/engineering/delivery/records/demo-removal-migration-20261006.md)，文档处置见[文档清理](docs/engineering/delivery/records/documentation-cleanup-20261006.md)。
