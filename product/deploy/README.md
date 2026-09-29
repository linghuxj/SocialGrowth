# 正式产品本地依赖

本目录只服务 `product/` 正式实现，不读取 Demo 的 SQLite、运行时队列或对象存储。

1. 将 `.env.product.example` 复制为被 Git 忽略的 `.env.product`，替换示例密码。
2. 执行 `docker compose --env-file product/deploy/.env.product -f product/deploy/compose.product.yml config` 检查配置。
3. 仅在开发者授权启动常驻依赖后，执行相同参数并追加 `up`。

端口、卷名和数据库名均使用 product 专属前缀。示例值不得用于共享或正式环境。
