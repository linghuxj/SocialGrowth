import type { ChildProcess } from "node:child_process";

export function stopOwnedProcessGroups(children: readonly Pick<ChildProcess, "pid" | "exitCode" | "signalCode">[]): void {
  let unexpected: unknown;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) {
      // A group can disappear before its close event updates ChildProcess.
      // Continue stopping the remaining owned groups in that race.
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) unexpected ??= error;
    }
  }
  if (unexpected !== undefined) throw unexpected;
}
