# WP-08 阶段四：接入失效扫描与事务回收

更新：2026-09-30。基线`7f95e5e`，执行分支`feature/wp-08-reconciliation-stage4`；BE/EX由Codex阶段代理实施，OPS负责后续周期调度与真实网络资源，原非作者／QA窗口分别监督。需求R-143/148/150/151、CT-05、AC-11/12，沿用[任务卡与资源表](WP-08.md)、[质量门禁](../quality-gates.md)；无新增页面，不替换设计图片／原始提示词。

## 实际交付边界

- 持久`reconcileBatch`按接入UUID分页，一次1～1000条；选出未完成准入超时或当前资格／关联／安装代次／归属版本失效的记录。已正式准入不把10分钟接入窗口当网络租约，资格失效仍回收。
- 扫描不先锁接入；各行按既有provider→installation→association/device→enrollment锁序，取得全部锁后取数据库墙钟、重读当前事实。锁前过时结果不直接回收，恢复资格或竞争处理后无变化则保留。
- 进入回收待处理、候选节点保留、命令摘要、撤权两分项意图、取消未投递升级和审计同事务；任何写失败整体回滚。仅在真正首次进入回收时新增意图，不反复撤权。
- 一行失败返回固定码及接入ID，不输出原查询／URL／驱动cause；继续其他独立设备，游标推进。失败记录占用仍在，不清历史、不假装成功，后续完整扫描重新尝试。每行锁等待5秒为候选防挂保护，不是性能验收线。
- `admission:reconcile`默认关闭，须明确`SG_PRODUCT_ADMISSION_RECONCILE_ENABLED=1`和受控`SG_PRODUCT_DATABASE_URL`，单批执行后退出，不装守护、不写真实网络或消费设备队列。命令见[后端说明](../../../../product/backend/README.md#wp-08-接入失效回收维护)。定期调度、实际外部意图处理／查询和WP-20异常待办尚未实现，不能称自动网络回收完成。

## 检查与环境

隔离实例`sg-wp08-stage4-pg`，回环32834、专用夹具库`sg_wp08`，PostgreSQL17.11，镜像digest`sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f`。原`qm-dev-postgres`／`minio-test`未改动；原窗口资源不混用。遵循用户默认授权，只为非UI补充测试启用重建schema，不当业务验收。

```sh
SG_PRODUCT_TEST_DATABASE_URL=<隔离32834专库URL> SG_PRODUCT_TEST_ALLOW_RESET=1 pnpm --filter @socialgrowth/product-backend test:postgres
pnpm check:product
pnpm lint:product
pnpm test:product
pnpm build:product
python3 docs/engineering/delivery/check_consistency.py
```

补充PG全套56/56通过：原48＋新增8，包含未完成准入过期／正常admitted不因窗口误回收、6类资格变化、两进程竞争唯一回收、锁等待后资格恢复、单行写失败完整回滚且继续另一设备、坏行游标推进并保留节点、真实单次CLI接续和默认关闭／错误脱敏。年龄与资格修改是非UI夹具，不代表真实关联、退出或网络副作用。最终产品100/100（30+9+43+4+14）、类型／lint／构建与文档结构通过；暂无本阶段非作者或QA结论。没有UI／Android／HTTP新增范围，不把补充DB或CLI检查替代Playwright业务验收。

测试结束只读检查专库`socialgrowth_product` schema数量为0，专用容器已停止并自动删除，仅销毁补充夹具数据；原两容器未动。没有留下后台维护进程／业务服务，不操作其他窗口资源。

## 原窗口闭合及剩余事项

阶段二`95a6c25`原窗口[独立验收](../../../../artifacts/acceptance/product/B2/20260930T040902Z-wp08-stage2-95a6c25/acceptance-report.md)已完整读取：97/97、PG48/48、原两项与六组边界探针通过，G1建议合入。核对Developer未被其他worktree检出、后继关系成立，以旧tip`a7bc4df`的CAS快进合入`Developer@95a6c25`，保留当前阶段四和用户脚本。阶段三固定`7f95e5e`正由原复核窗口检查；本阶段不外推其结果。

RES-WP08-01～03仍缺实际tailnet／独立核验服务／叠加策略／多手机／支持矩阵和原节点回收证据。此次仅从数据库登记回收需求，凭据及节点许可是否实际消失仍未验证，AC-11/12和B2G3未通过。人工输入、责任职责、解除条件及最晚时点沿用任务卡，不能因缺资源伪造副作用或停止可独立工程。

下一工程切片继续WP-08可信来源和受控外部意图边界；WP-11统一许可与真实停止、WP-14最小项目、WP-20无项目待办可按编码依赖推进，实际执行仍需全部许可及资源条件齐备。
