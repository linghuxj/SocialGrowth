import type { ChildProcess } from "node:child_process";

export function stopOwnedProcessGroups(children: readonly Pick<ChildProcess, "pid" | "exitCode" | "signalCode">[]): void {
  let unexpected: unknown;
  for (const child of children) {
    // Wrapper completion does not prove its descendants left the owned group.
    if (!child.pid) continue;
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) {
      // A group can disappear before its close event updates ChildProcess.
      // Continue stopping the remaining owned groups in that race.
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) unexpected ??= error;
    }
  }
  if (unexpected !== undefined) throw unexpected;
}
