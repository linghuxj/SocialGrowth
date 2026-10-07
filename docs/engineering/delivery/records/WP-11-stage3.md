# WP-11 第三阶段：实时权威来源与动作 broker 接续

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

2026-10-02领取；基线09146dd7e6490030b3b2ca4deeb38f5c3f76de5c，codex/wp-11-authority-broker-stage3。EX主责Codex实施代理，BE数据库与鉴权/统一锁序，AND可信本机持久意愿和新鲜控制确认，OPS受控引擎包，TL/QA停止判据/真实验收，真人预约待实际签署。依据WP11、CT06、R106/122/123/129/133/137/139/142/146，AC16～20/22/59；不是延伸Demo/绕管理员或换引擎。

已完整重读WP11原任务/阶段二、action-permission-core及phone-control-journal源，核对0001/0004/0005/0006/0015真实SQL。当前Journal只device→journal锁序，begin_call仍借内部trustedFacts；default stop_requested，无holder获取/re-enable/实时authority-loader或物理fence。**这属于工程尚未实现，不得假称已有能力，也不能全部归为需人工后停止编码。** controller/custodian存在不能接任意trustedFacts为真后解密，read Screen/监控/人工补图与写动作都要同当前许可。

|当前来源|已知可复用的实际字段/范围|不得推断及下步|
|---|---|---|
|0001 devices/associations/providers/installations|device fact_version/state、当前association结束事实、provider状态、installation generation/status与会话|关联/access_ready不等本机当前意愿/ADB/平台身份；读取要当前绑定与撤销/到期校验|
|0005 network_enrollments|当前device/installation/provider/association/generation/version/phase与节点引用|admitted记录不代当前外部可达/ADB授权或任务许可；phase/status不能由body自报|
|0015 endpoint_report_journals|绑定scope、endpoint_revision、固定public key与追加epochs/receipts|端点或旧配对回执不代真实授权/当前中心连接；复用WP10原覆盖，不解除source13|
|0006 phone_control_journals|版本/控制代次/holder/在途running-unknown/stop请求与证据|未知/租约到期不释放、停止请求不等物理停止；不能从replayed=false动作|
|action-permission-core task/holder/localConfirmation|严格用途/动作类别、taskAttempt/authorization/租约/当前代次、候选新鲜度、当前暂停及退出拒绝规则|当前只内部输入，必须逐项落实权威持久producer/读取与同事务锁序；不能接受HTTP bool/facts|

执行顺序：先列现有权威写入路径和锁顺序（不能锁前快照＋旧journal宣称竞态关闭）→实现已存在来源的中央实时读取/鉴权及明确缺失时关闭→落实holder/任务授权/本机确认的真实producer与版本/fence→broker持久互斥提交/物理调用前复核→同原非作者/同原QA固定工程→条件具备时原QA真实Playwright＋指定Samsung上Artemis实际决策/停止恢复。代码阶段可用全新synthetic fixture补充真实SQL交错，但绝不预置enabled/true作为设备/业务验收。当前只盘点接续，未实现或验证新broker，不签G1/完整AC/G3。

实际人工输入仍独立记录：EX/OPS RES-WP11-01固定不含秘密的Artemis受控提交/补丁及所有截图/动作路径；AND/QA RES-WP11-02合法设备/第二角色、本机持久控制事实；QA/TL RES-WP11-03事前冻结物理停止/恢复样本和观察期，公开发布另行授权。解除证据及补验沿原卡，不读历史安全配置、不用不安全截图先发模型再脱敏，不修改嵌套用户在途改动。已有默认自有隔离服务/指定Samsung授权不扩大生产或最终发布。缺人工只阻对应实际动作范围，central facts/事务/契约等工程继续；无批准来源的事实明确missing，不造active。

前批交接已接续：WP13-stage4凝聚09146严格11（5产品6docs），10unit/根505/当前source实际HTTPPG12/全product静态actual0，lint两个有意sparse warning保留；两个自有PG及卷精确gone。submitted-verification actual0、metadata whole inverse0，作者实际总目标仍未完成。原非作者已收到新固定3c0→09146，原QA已收到新固定6555→3c0（报告9494065cdad6b59b5231740f1ca5a2ad8d1ced79870d697c2c1d26cf22d5223d，513PASS/另外2桩RED明确保留）。其旧报告均全文读取，stage2原QA7fd3a861…523首过/有限双0；不混当前WP11、不改三原模式、不把发送进度当签收。

Developeraf14/source13 pending1/管理员新UI/SEC及保护脚本仅PATH-STATUS保持，不合并隐藏父门禁。ACTIVE heartbeat继续按实际分支及台账接续；下一次先读取两个原窗口的新完整报告/落实findings，再推进上述实时加载第一子范围，而不是重复发起旧报告或技术基础冒充完整业务。
