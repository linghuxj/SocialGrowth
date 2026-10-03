# Independent owned process stop review

Reviewer: `/root/adversary`

Base: `2c7910eee3d6e597c8310b692b7631e067734e60`

Head: `dba7b344de5d55d304b50ed650abb5c9aefd34e4`

Verdict: **approved**, limited to the three-file local service stop helper delta. The whole parent tree and subsequent integration are not approved by this report.

The helper iterates the caller's registered detached child process groups, attempts SIGTERM even after a wrapper's exit, tolerates ESRCH, and continues to remaining groups before rethrowing other failures. It does not enumerate or kill by port/name, and the caller still supplies only children it spawned. Existing once-only shutdown behavior and service/database/device boundaries remain unchanged.

Independent exact-source tests passed 2/2 using newly spawned disposable child processes: an already-gone group does not prevent stopping another group; an exited wrapper's live descendant is stopped. Diff --check passed. No running product service, database, device or private configuration was accessed or changed during this reviewer run. Actual product restart behavior is root-reported evidence and does not establish business UI acceptance.
