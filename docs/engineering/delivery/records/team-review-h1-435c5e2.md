# 独立安全复审：H1 UID和安装恢复

- reviewer：`/root/adversary`
- 整体 base：`09765d8ca9c17beacc3ab6a5054c05c74659cf72`
- head：`435c5e2a0a6af87443bdb0806ef59aaae650e3b6`
- 本轮整改 diff base：`a1aed365d056193048abdcb6428031b7160eb2ce`
- verdict：**approved**，仅此精确候选的三文件工程安全范围；新/剩余阻断finding为0。

H1-RESTORE-01已修复：主/测试APK恢复独立try/catch，每项保留succeeded/unknown_or_failed/not_needed等明确状态；恢复失败不会跳过另一恢复。独立从精确head提取finally控制流，用纯函数ADB替代验证主失败/测试成功、主成功/测试失败、均失败、均成功四种组合；四种均分别尝试两个恢复且状态符合实际。原安装成功事实独立保留，不再被恢复后的mainUpdated抹去。该探针只验证失败控制流，没有触碰手机。

独立UID helper/test 2/2通过（来自前候选相同字节），当前修复diff及`git diff --check`通过。已审完整三文件范围及增量；无新API契约，无主包clear/uninstall。未执行USB、11项手机协议、真实安装/恢复或Playwright；实际运行仍由主会话串行核查候选APK、参与/在途状态并保留恢复结果。批准不代表这些边界通过，任何后续代码变化须重审。
