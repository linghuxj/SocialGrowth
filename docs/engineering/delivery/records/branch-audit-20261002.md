# 本地分支盘点与收敛建议

## 用户确认后的第一批执行结果

2026-10-02用户明确“确认进行调整和优化”后，已实际清理原候选52个本地分支；从100降至48，stage命名从79降至40。下面原只读盘点/库存保留为清理前快照，不表示这些52个ref仍存在。

范围严格为“Developer祖先＋无upstream＋非main/Developer/当前分支”，实际 `git branch -d -- <52个精确名称>` exit0，不用-D/通配强删。删除前重新核对100个name/tip/upstream、候选完整SHA不变、Developer仍af14、HEAD02f80ec、仅当前一个worktree；原复核/QA均idle且固定SHA任务已完成，本次读进度不重发旧任务。其它相关已加载项目窗口为idle，没有据notLoaded推断在运行；保护未验范围和未提交内容。

恢复清单：[52个名称→完整SHA](branch-cleanup-20261002-refs.tsv)。已先创建一个annotated归档标签 `archive/branch-cleanup-20261002-pre`，解引用精确为02f80ec36cc020378f5e83173c0eefd7610b1b32，不新建52个标签。删除后48个剩余ref的名称、完整tip、upstream与原库存扣除52项逐项精确相同；52个原tip仍全部为Developer祖先，Developer为归档标签祖先，因此所有已删名称对应的提交历史仍可达、可恢复。

恢复单条命令（只在确有恢复需求且名称不存在时执行）：`git branch -- <清单中的branch_name> <清单中的full_commit_sha>`。恢复只是重建本地名称，不代表批准合入或改变验收。不得批量将52条恢复当作回归测试重新污染分支列表。

保留main、Developer、当前核心分支、有upstream的first-loop历史分支，以及44个尚未进入Developer的旧tip；尤其WP10 endpoint-journal/source-evidence-snapshot保持门禁定位。第二批待验收关系及引用核定后再收拢，本次不做未验收合并。工程规范CLAUDE.md已加入阶段用commit/记录而非永久分支、独立切片才建短期分支和清理核对规则。

远端缓存3refs及其完整SHA前后相同，无fetch/push/远端删除；不改配置、服务或手机。用户保护发布脚本仅PATH/STATUS，未读/diff/hash/archive/stage/run；旧queue、外来ADR、WP11本地盘点和artifacts/review均保留。本次仅读文档/修改治理记录，没有产品代码变化，不重跑或重复累计上一阶段534工程测试，更不称Web/Artemis验收通过。两原C1报告SHA仍与盘点前相同，新P2/P3未清。

## 清理前只读盘点（历史快照）

2026-10-02（Asia/Shanghai）。用户要求提交当前阶段并检查过程分支存续。本盘点为只读，不授权或执行删除、改名、合并、push、fetch 或远端分支清理。数据来自提交前 HEAD 08c48f902c59bb9e03d588f08c29643420d80c54；当前阶段提交后仍按祖先关系重新核对。

## 结论

- 本地100分支，79个名字以stage数字结尾；阶段分支被当作长期检查点保留，数量/颗粒度确实过多。
- 100/100本地分支tip均为当前核心执行分支祖先，没有本地分支承载当前分支之外的已提交历史；这是可达性，不是验收通过。
- 55/100为Developer祖先（包含Developer/main本身）；剩45包含当前执行分支，另44个历史tip尚未进入Developer。
- Developer仍af14e64381db55f4bdabbb705fbe6755664b92d4，提交前相对当前HEAD为0独有/48落后；不为了减少分支越过WP10父pending及新C1发现。
- 仅一个worktree，绑定当前codex/core-automation-loop-stage1；没有其它worktree绑定这些候选分支。聊天窗口是否仍按旧ref取固定快照，清理前须核对，不能单凭无worktree就删除。

## 建议治理

1. 保留main、Developer与当前核心执行分支；实际独立开发、固定整改/复验时才另建短期分支，不再每个stage建永久分支。正常阶段检查点用commit SHA及任务记录即可。
2. 第一批可考虑清理52个无upstream、已为Developer祖先的旧分支（见库存“候选”）。feature/first-loop-implementation虽也是Developer祖先，但有upstream，先单独核对历史协作/远端状态。本次未删任何分支。
3. 第二批的44个尚未进入Developer的旧tip，已被当前执行分支包含，可在核对固定报告、待验范围及引用后收拢；不要把Git祖先误称G1/G3通过。尤其WP10 endpoint-journal/source-evidence-snapshot仍是未清门禁定位依据。
4. 真正清理前，保存精确name→SHA清单（如需要恢复再保存可验证的标签/备份）；重新检查归属/worktree/在途任务、tip未改变及祖先关系，只删明确名单，禁止通配强删。已入Developer的祖先删除本地ref并不会删除其提交，但若当前长期分支以后重写，其他未合入tip的保护策略须再确认。
5. 删除refs须另获明确清理指令；这次“检查”不推定删除授权。若保留历史标签，也只保留有业务/门禁意义的里程碑，避免把100分支等量换成100标签。

## 远端覆盖范围

本次仅检查现有本地remote-tracking缓存：origin/main和origin/feature/first-loop-implementation两个远端分支，加origin/HEAD别名共3refs；没有fetch，不能声称服务器实时只有两个分支。本地main相对缓存origin/main为26/0，本地first-loop为14/0（左本地独有/右缓存独有）。本次只本地commit，不push。

## 同tip重复命名

- `Developer` / `feature/wp-10-endpoint-ordering-stage1` → af14e64381db55f4bdabbb705fbe6755664b92d4
- `codex/wp-11-authority-broker-stage3` / `codex/wp-13-controlled-key-custodian-stage4` → 09146dd7e6490030b3b2ca4deeb38f5c3f76de5c
- `feature/artemis-device-farm-monitoring` / `main` → 99983a0e7bf70475c36a142c08a19b6e22ca55af
- `feature/wp-15-material-read-workbench-stage11` / `feature/wp-27-snapshot-capture-stage6` → c397e6ca5864d5c8e560431ef1893a65ea24d6a7

## 完整本地ref库存

“候选”=已为Developer祖先/无upstream/非保留主线；“暂留待核”=仅当前核心分支包含的历史tip；不代表缺陷或已验收。

| 分支 | 完整tip | 当前处理建议 |
| --- | --- | --- |
| Developer | af14e64381db55f4bdabbb705fbe6755664b92d4 | 保留主线 |
| codex/core-automation-loop-stage1 | 08c48f902c59bb9e03d588f08c29643420d80c54 | 保留主线 |
| codex/wp-11-authority-broker-stage3 | 09146dd7e6490030b3b2ca4deeb38f5c3f76de5c | 暂留待核 |
| codex/wp-13-controlled-credentials-api-stage3 | 3c0ce79c940dca13c23bf2d7d8c955049794764d | 暂留待核 |
| codex/wp-13-controlled-key-custodian-stage4 | 09146dd7e6490030b3b2ca4deeb38f5c3f76de5c | 暂留待核 |
| codex/wp-13-controlled-media-credentials-stage2 | 6555a5aa5cb34dbd781893fe8a9478cb713972cd | 暂留待核 |
| codex/wp-13-resource-preparation-stage1 | a42bc1501d2b12784ae5208031d1646398d25d02 | 暂留待核 |
| feature/artemis-device-farm-monitoring | 99983a0e7bf70475c36a142c08a19b6e22ca55af | 第一批候选 |
| feature/b2-b3-foundation-integration | 447eda52fbf8bfb94364cb0a8abb318d2e2d5b4b | 第一批候选 |
| feature/b2-b4-next-foundation-integration | da06e9fe59fdb6a58b34cf164458c44197b5ddc2 | 第一批候选 |
| feature/first-loop-implementation | 23cbd8816c3ce2da1ed49d9d41d33609fac04a3e | 有upstream，单独核对 |
| feature/operator-cookie-boundary-hardening | 8c2bc97d4d022d21cd614cb9dd754b330664f6e0 | 暂留待核 |
| feature/wp-00-formal-product-foundation | d380c1f58ef8a3bae66c4ddc546caa0845c34a3b | 第一批候选 |
| feature/wp-01-authoritative-model-contracts | cd70c138f5eb9755f5c53b85d732c2cfa4a4b232 | 第一批候选 |
| feature/wp-02-operator-auth | 79c0c55058528993f3585909fd4c7c2004e7c1d8 | 第一批候选 |
| feature/wp-03-provider-invitations | 172be71ae3fc4d53c9fc14d4afe89c8acdb1effa | 第一批候选 |
| feature/wp-03-provider-invitations-stage2 | b75dfc2599374e68520417ce270521dafa0bc8ef | 第一批候选 |
| feature/wp-03-provider-invitations-stage3 | 8096a301bdf91aa32a1ade20af70d0a0fa5bb81f | 第一批候选 |
| feature/wp-04-provider-registration-stage1 | 8821c95284b534d871556db3dbaec795dd751246 | 第一批候选 |
| feature/wp-04-provider-registration-stage2 | b70ab2f2c51c9511d519dc9e22bdddea94f1e14a | 第一批候选 |
| feature/wp-04-provider-registration-stage3 | 7a1375ee847486ae177af42d113bbe3c243a24da | 第一批候选 |
| feature/wp-05-device-association-stage1 | 2f2daef7a5c8023b89bade6ea80df6d19420ea4d | 第一批候选 |
| feature/wp-05-device-association-stage2 | 65083f6cb0cdcd736eea00c301e957bb78a6ef96 | 第一批候选 |
| feature/wp-05-device-association-stage3 | baa3212a486ef9a1bea8fed8166fe69ccff61db3 | 第一批候选 |
| feature/wp-06-three-view-facts-stage1 | 043e479ff03937008e8e20e1708f82b9bd50fa4b | 第一批候选 |
| feature/wp-06-three-view-facts-stage2 | 10c527e5aeff453daeaf0bde410d2641df847c30 | 第一批候选 |
| feature/wp-06-three-view-facts-stage3 | c38817e2d158903fe6289012567cfa7ec72db6c0 | 第一批候选 |
| feature/wp-06-three-view-facts-stage4 | 3e616be85fc5d0e8caeb8bd9e654f35e40062767 | 第一批候选 |
| feature/wp-06-three-view-facts-stage5 | 02b7ed55643268936186c5f2ec1ea2fac7b1aa5d | 第一批候选 |
| feature/wp-07-b1-acceptance-stage1 | d0683b6146d376e4d194c4f4a9fb4f482ed70a85 | 第一批候选 |
| feature/wp-07-b1-acceptance-stage2 | a6cb238fb40f093c400af4da33aef406e3423053 | 第一批候选 |
| feature/wp-08-installation-key-stage3 | 7f95e5e4eccec888f2765921d7adbccd48b6c0b0 | 第一批候选 |
| feature/wp-08-reconciliation-stage4 | ab3d6bf679a3ebd7bc1b62d3af75271d51e84b8c | 第一批候选 |
| feature/wp-08-trusted-enrollment-stage1 | a7bc4dfe37df9aa83745f005abe6cda1cdfbbef1 | 第一批候选 |
| feature/wp-08-trusted-enrollment-stage2 | 95a6c2561be03fff1d08611c8c6e59ed212eb64a | 第一批候选 |
| feature/wp-09-native-discovery-stage1 | 69630b9291bbf1c6224f44a1a5b67c18d1d099cb | 第一批候选 |
| feature/wp-10-endpoint-journal-stage2 | b60ad242c069c00b386be289603c8d77b5b97972 | 暂留待核 |
| feature/wp-10-endpoint-ordering-stage1 | af14e64381db55f4bdabbb705fbe6755664b92d4 | 第一批候选 |
| feature/wp-10-joint-reservation-stage5 | df700b82d4138ee767e74e68328c2a6ff5fa652f | 暂留待核 |
| feature/wp-10-maintenance-budget-stage3 | 40a6833610070e9269c2ea06ca709a2143701d2b | 暂留待核 |
| feature/wp-10-maintenance-journal-stage4 | a068530288a383d5b39346e065353f44e8585734 | 暂留待核 |
| feature/wp-11-action-permission-stage1 | 018169ec1e779d24f1360ce6f6d53be03042285f | 第一批候选 |
| feature/wp-11-control-journal-stage2 | d8d9bcf341ee630bc53f8af8b735a3590c22a012 | 第一批候选 |
| feature/wp-14-planning-drafts-stage3 | c03940733c91f8d4f9a355b887a9af54700bb073 | 第一批候选 |
| feature/wp-14-project-foundation-stage1 | 31c6095b255e9bf3c489e9170ec3092fe694ee7c | 第一批候选 |
| feature/wp-14-resource-reservations-stage2 | 5227127b555881a53587e9dddaeb10d173e270d5 | 第一批候选 |
| feature/wp-15-authenticated-byte-transport-stage6 | bf5c8cf6f2f6ccfe9329ddeeab7e636331b070e8 | 暂留待核 |
| feature/wp-15-authenticated-material-api-stage5 | 1486eafb3050e814e05cc7155d8719b4fc8e757e | 暂留待核 |
| feature/wp-15-authenticated-object-upload-stage4 | be02bd793b5a13ea8a97c9b10404e6c299abaefb | 暂留待核 |
| feature/wp-15-batch-history-api-stage8 | 02a030a4fe5751302812c263db5a885fbee4442a | 暂留待核 |
| feature/wp-15-content-quota-stage2 | 523a6109e700605918d7ee1e324cad07b4d4f0f5 | 第一批候选 |
| feature/wp-15-material-admission-stage1 | 65d5928379c600cccb426a7430a756218bf6e2a8 | 第一批候选 |
| feature/wp-15-material-batch-client-stage15 | 18b7cbbc8b8123b4c65b9a59be982cb7a874af4d | 暂留待核 |
| feature/wp-15-material-bytes-client-stage14 | 947efeff736089f0f5725ac25b5f158416e8feb1 | 暂留待核 |
| feature/wp-15-material-declaration-api-stage7 | 14cc7aaa65c9d413bea655329e2d868f51b940b5 | 暂留待核 |
| feature/wp-15-material-library-api-stage9 | e00685162e3339b24cea98c3f22515b48003202a | 暂留待核 |
| feature/wp-15-material-read-client-stage11 | 7f08c79a44a360158fd5f8cfc3ff85e522823d14 | 暂留待核 |
| feature/wp-15-material-read-workbench-stage11 | c397e6ca5864d5c8e560431ef1893a65ea24d6a7 | 暂留待核 |
| feature/wp-15-material-registry-stage3 | 747a9ceb1b6e7ea9ba8f54925f9d772e5a2fe39d | 暂留待核 |
| feature/wp-15-material-save-client-stage12 | 49f2142b76a07748e1dd2ea3440955c44715925b | 暂留待核 |
| feature/wp-15-reviewed-content-foundation | a47a620b3d3b6b73fff73e7228967ace461e184d | 第一批候选 |
| feature/wp-15-upload-inventory-api-stage10 | 2639d7bf7d0db63a7dbe7eab9155012ac53fb547 | 暂留待核 |
| feature/wp-15-upload-ticket-client-stage13 | 430c56544b8d30a1db87d05e11dc30ee8eb833d5 | 暂留待核 |
| feature/wp-16-pending-recheck-outbox-stage5 | cc41881629dc0654a71fb1ec16baaec22b31daba | 暂留待核 |
| feature/wp-16-recheck-queue-stage4 | 145c3c5c9754182ac1f2f597e654cc12855293dc | 暂留待核 |
| feature/wp-16-recovery-budget-stage1 | 90ab452bb5156527d422cb0dc94ed28a377e9afa | 第一批候选 |
| feature/wp-16-recovery-budget-stage2 | 98db9105621915d883de10b88128312771c4bf8c | 第一批候选 |
| feature/wp-16-task-contract-stage3 | b0b8cb27c0ae86b85770d5996bdccb5efec4eab8 | 暂留待核 |
| feature/wp-17-model-coordinator-stage2 | c347d2813b2f1b042801ad7aa4d389c9fa1cd57f | 暂留待核 |
| feature/wp-17-suggestion-boundary-stage1 | a6e239a2eff6fdd5db14bb06df92e3a7cddf5e4e | 暂留待核 |
| feature/wp-20-assistance-notes-stage3 | 2ffa860de2e5255286cab034522250efdb190044 | 第一批候选 |
| feature/wp-20-authenticated-feed-stage2 | 662718f89cda2f0e959c4be1633c3acf083570e0 | 第一批候选 |
| feature/wp-20-global-todo-stage1 | 67f2352dcb580d308515247d03fd7c7d09397249 | 第一批候选 |
| feature/wp-20-note-history-stage5 | 7f0ee9760c02995bc6b3a91db3b0f61d4d6dc037 | 第一批候选 |
| feature/wp-20-provider-projection-stage4 | 6fc8c30b15baba597e37391820f8a3badd93e75a | 第一批候选 |
| feature/wp-21-task-impact-stage1 | f55792014ab88c431d3188eb2d1445f10b8cc7fa | 暂留待核 |
| feature/wp-22-metric-snapshots-stage1 | 3dec68a3b57ad53c71c9c3909f611c1f8ab56503 | 第一批候选 |
| feature/wp-23-tracking-link-stage1 | d2538373efb27bad1b00f37611fcc790f2ea98ca | 第一批候选 |
| feature/wp-24-cycle-counting-stage1 | 4448849ca00519a74359d67b2aa452f014ca5ccb | 第一批候选 |
| feature/wp-24-observation-readiness-stage2 | 6a6a6d8f07af309c8603984763fb5e52e2f6b98d | 第一批候选 |
| feature/wp-24-runtime-calendar-stage3 | ccc4707980841e4640731264a1d0af412ab5d893 | 暂留待核 |
| feature/wp-25-commission-core-stage1 | 18446ea098f251609052d43adc2d5d2235670e1a | 暂留待核 |
| feature/wp-25-income-journal-stage2 | 7cf8878fcf97eac93608518dd21984944618037a | 暂留待核 |
| feature/wp-25-provider-projection-stage3 | ab2bc2b40323f472a8d369439d4a1a887292e5ff | 暂留待核 |
| feature/wp-27-encrypted-backup-stage1 | 546d35b3057402755c0174f635c1c5df28f4d4e2 | 暂留待核 |
| feature/wp-27-encrypted-file-store-stage4 | 525a0628cf58106d3edc05278841b6273ba167c3 | 暂留待核 |
| feature/wp-27-file-store-fault-recovery-stage5 | 4e1827e318da61eaad29d89db69cac60d637eb7a | 暂留待核 |
| feature/wp-27-inventory-bound-backup-stage3 | e4988c005f74c2794732c902e8b5bdf24bf7cd85 | 暂留待核 |
| feature/wp-27-restore-inventory-stage2 | 63b9cae4c57473e20d7ac3fd95bd3962b3b58d57 | 暂留待核 |
| feature/wp-27-snapshot-capture-stage6 | c397e6ca5864d5c8e560431ef1893a65ea24d6a7 | 暂留待核 |
| fix/wp-09-ipv4-link-local | b9b198384060f073c6b67afe23988ddf438b8184 | 第一批候选 |
| fix/wp-10-source-evidence-snapshot | 0d7ae826019c42943b36a5caa2a9cd35c7d8d734 | 暂留待核 |
| fix/wp-14-case-sensitive-timezones | 28276f2455444bc5790bacad347c2a9d6faba17e | 第一批候选 |
| fix/wp-14-unknown-project-response | 6394cde8e7afc01e02737127dbf0056ea5880c43 | 第一批候选 |
| fix/wp-16-queue-config-redaction | 9f5812f905c325bf99626bfdcbbab8537f78abcc | 暂留待核 |
| fix/wp-20-note-timestamp-precision | fad821c4eadeaae5ead7426f713e1abe80678e6c | 第一批候选 |
| fix/wp-24-calendar-range-boundary | a761ea49b3f4c1e7eab986732451f3d0518066d4 | 暂留待核 |
| fix/wp-27-inheritance-inventory | c147ef8a8e52def2fbe94d0c30a25927698626e9 | 暂留待核 |
| main | 99983a0e7bf70475c36a142c08a19b6e22ca55af | 保留主线 |
| refactor/web-console-ui-unification | cd949bb3419f09a943304cde75f82a9d16a787d3 | 第一批候选 |

## 与当前工程的关系

Artemis本次只是默认关闭的提交前调用编排，不是生产接线/手机验收。C1新P2/P3未修、C2a未交独立新批次、真实浏览器/视觉仍未验，详见core-automation-loop-c3.md及原报告；收敛分支不能隐藏这些状态。原报告/首RED/用户脏文件保留，不改变Developer。
