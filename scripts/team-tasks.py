#!/usr/bin/env python3
"""Shared task ledger with flock and atomic compare-and-swap writes."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any


def validate(state: dict[str, Any]) -> None:
    if state.get("schema_version") != 1:
        raise ValueError("Unsupported schema_version")
    if not isinstance(state.get("tasks"), list):
        raise ValueError("tasks must be a list")
    if not isinstance(state.get("contracts"), dict):
        raise ValueError("contracts must be an object")
    if not isinstance(state.get("workspaces"), dict):
        raise ValueError("workspaces must be an object")
    ids = [task["id"] for task in state["tasks"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate task IDs")


def atomic_write(path: Path, state: dict[str, Any]) -> None:
    fd, temporary = tempfile.mkstemp(prefix=".tasks-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("read", "claim", "replace"))
    parser.add_argument("--actor", help="Stable runtime agent ID")
    parser.add_argument("--task")
    parser.add_argument("--revision", type=int)
    args = parser.parse_args()
    # Consume a replacement before taking the shared lock. A producer may be
    # another ledger read; waiting for stdin while holding flock can deadlock
    # the producer when a large JSON snapshot fills its stdout pipe.
    replacement = None
    if args.command == "replace":
        if args.revision is None:
            parser.error("replace requires --revision")
        replacement = json.load(sys.stdin)
        validate(replacement)
    common = Path(subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        text=True,
    ).strip())
    board = common.parent / "tasks.json"
    lock = common / "codex-team-tasks.lock"
    # Lock a stable inode; never delete or atomically replace this lock file.
    with lock.open("a+", encoding="utf-8") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        state = json.loads(board.read_text(encoding="utf-8"))
        validate(state)
        if args.command == "claim":
            if not args.actor or not args.task:
                parser.error("claim requires --actor and --task")
            task = next(task for task in state["tasks"] if task["id"] == args.task)
            if task["status"] != "pending" or task.get("owner") is not None:
                raise ValueError("Task is already claimed or not pending")
            done = {task["id"] for task in state["tasks"] if task["status"] == "done"}
            if not set(task.get("depends_on", [])).issubset(done):
                raise ValueError("Task dependencies are incomplete")
            task.update(owner=args.actor, status="in_progress")
        elif args.command == "replace":
            if args.revision != state["revision"]:
                raise ValueError("Revision conflict: reread and retry")
            assert replacement is not None
            if replacement.get("revision") != state["revision"]:
                raise ValueError("Replacement must match the current revision")
            state = replacement
        if args.command != "read":
            state["revision"] += 1
            atomic_write(board, state)
    # stdout can block until its consumer reads. A committed/snapshotted result
    # must never retain the stable lock while waiting for that consumer.
    print(json.dumps(state, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, StopIteration, subprocess.CalledProcessError) as error:
        print(f"team-tasks: {error}", file=sys.stderr)
        sys.exit(1)
