# 分支收拢记录（2026-10-06）

> 固定候选证据：正文中的“当前”、通过和未验证只适用于记录的日期、源码与环境。当前接线见[实现说明](../../../current-implementation.md)，不按本文旧阶段安排或分支指令直接操作。

用户确认：只保留 main 和 dev，开发均在 dev，main 管理可部署版本。

- dev 接收原当前开发候选、已等价集成的历史及遗漏的独立审查文档。
- main 保留远端原基线 c7461c1e466d36ff996e6a1d1f0290272f67f6cd；本地原 main 领先内容已在 dev 保留。未将当前未验收产品候选晋级 main。
- provider 冲突保留当前版本零项目、可空来源及新版测试夹具；实际业务源码未回退。其余等价代码提交仅合并历史，不重复应用旧实现。
- 固定审查记录继续保留。收拢不意味着旧失败、未知提交、物理停止、正式接入、生产签名或真实闭环已验收。
- 原工作树的未提交修改原地保留，历史工作树转为 detached HEAD，不删除目录或运行数据。
- 完整 Git bundle 与含工作树状态的恢复清单已在本轮本地产物目录保存。以下名称和 SHA 可用于恢复历史分支；不应据此重新建立常驻分支。

## 原本地分支恢复清单

| 原分支 | 完整 SHA |
| --- | --- |
| Developer | af14e64381db55f4bdabbb705fbe6755664b92d4 |
| codex/ci-current-product-branch | d377b5443d45e8dddbc8d8197ee8905c530e8060 |
| codex/core-automation-loop-stage1 | 4ad385ce8aaa9ab47202039b68d4e52312aa0c7c |
| codex/team-adversary | 5490dc690ca2a81aed6ee5887b31b949fc24ed3a |
| codex/team-adversary-android-access-20261006 | 145c70b70af0f1ddfa33d858c0d61057523a71b2 |
| codex/team-adversary-loop-security-20261005 | 78ee34177e4c34957b21ca88eb1867ab1a5647f8 |
| codex/team-adversary-media-audit-20261004 | 8a53bea9608cafa0956cd1838020df096f4fae8a |
| codex/team-adversary-ops-complete-20261005 | daa22d1f2bd3f846cf24c67fa4c6933ec2f83ef8 |
| codex/team-backend | e1baeaa8b30cc89f7ded8b06719fbd5dbc21fe2c |
| codex/team-backend-android-access-20261005 | d981e995ac2ae88320e0546ac23d42c7d5b82c56 |
| codex/team-backend-control | f4c0c8c028b4c8eed58a02f9ea476ad95b8bd91c |
| codex/team-backend-exec | e18d52fe6dddf441ed65912ea3bbfbf83e24dbfc |
| codex/team-backend-existing-executor-20261006 | c76f4f76ac65e4a209d2381768ccb9ceeca7372d |
| codex/team-backend-loop-core-20261005 | ad544435a6b79dae53db65d54aa791bd674f4d83 |
| codex/team-backend-loop-feedback-20261005 | 05f8cf587a9c8f482da92263d194c06250f088ed |
| codex/team-backend-loop-recovery-20261005 | 89af8b300fb5aa2183c7b520142b2d5f1348bc3b |
| codex/team-backend-media-android-20261004 | 0d4fc050e48b1e61944c46fbdc4252ad10037e97 |
| codex/team-backend-media-audit-20261004 | 3024a001d5413487bdc766957e6591dfb8d7c4b2 |
| codex/team-backend-media-authority-20261005 | 06d2ccd1fae55c7ec5b3ff9665a738dfedadedf1 |
| codex/team-backend-media-crypto-20261005 | ee73baef727571da03594d341fff2544721d1a46 |
| codex/team-backend-media-executor-20261004 | 5c4137360208fd2e01e85d1d35d0941ce2a3c68b |
| codex/team-backend-network | 89552d6303973adeabd2e87d15413060ea1b026e |
| codex/team-backend-network-access-20261005 | 08a13ea13ab959b82825966d51895e9f1f3ef864 |
| codex/team-backend-ops | f7f6df24282d290051c1e93b495e8139bf3b1f60 |
| codex/team-backend-ops-complete-20261005 | 4bc771525a6d15d8370b7acc70fc72c4e76c67e9 |
| codex/team-backend-provider | a84756557c87916d73e14e75596f3843035edb1f |
| codex/team-ux | 1faaad9b52c15ee1badb22de5db33a2c0dc7097c |
| codex/team-ux-loop-ux-20261005 | 257da3764004bea4ffd467ab16b550a1fc4385d9 |
| codex/team-ux-media-audit-20261004 | 0bef498df170c5cec21f00130d7c4d6d58b9a50f |
| codex/team-ux-ops-complete-20261005 | 18c15292bbaf8d8f5ad922d291bb5d5505e6d1a0 |
| codex/team-ux-web | 1c84441d764424e6530ef5d8859dada12845a7dc |
| codex/ux-native-3c97062 | 3c97062ecc6754af3ef847aa32a8d830022fd4dd |
| feature/first-loop-implementation | 23cbd8816c3ce2da1ed49d9d41d33609fac04a3e |
| main | 99983a0e7bf70475c36a142c08a19b6e22ca55af |

## 验证边界

核对合并前后业务源码树一致、全部原分支提交可从 dev 到达、未提交内容未被批量提交，以及本地和远端仅有 main/dev。本次未运行手机任务、生产部署或产品业务验收。CI 触发分支改为 main/dev；CI 的实际结果另按候选 SHA 记录。
