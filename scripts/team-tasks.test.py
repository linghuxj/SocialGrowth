"""Regression checks on isolated ledgers; never writes the shared task board."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("team-tasks.py").resolve()


class LedgerLockTests(unittest.TestCase):
    def test_concurrent_same_revision_has_one_winner(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sg-ledger-cas-") as temporary:
            repo = Path(temporary)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            state = {"schema_version": 1, "revision": 0, "tasks": [], "contracts": {}, "workspaces": {}}
            board = repo / "tasks.json"
            board.write_text(json.dumps(state), encoding="utf-8")
            def replace(marker: str) -> subprocess.CompletedProcess[str]:
                value = {**state, "marker": marker}
                return subprocess.run([sys.executable, str(SCRIPT), "replace", "--revision", "0"],
                                      cwd=repo, input=json.dumps(value), text=True,
                                      capture_output=True, timeout=5)
            with ThreadPoolExecutor(max_workers=2) as workers:
                results = list(workers.map(replace, ["left", "right"]))
            self.assertEqual(sorted(result.returncode for result in results), [0, 1])
            winner = next(result for result in results if result.returncode == 0)
            self.assertEqual(json.loads(board.read_text()), json.loads(winner.stdout))
            self.assertEqual(json.loads(board.read_text())["revision"], 1)

    def test_large_read_pipe_and_stale_cas(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sg-ledger-test-") as temporary:
            repo = Path(temporary)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            state = {"schema_version": 1, "revision": 0, "tasks": [],
                     "contracts": {}, "workspaces": {}, "test_payload": "x" * 524288}
            board = repo / "tasks.json"
            board.write_text(json.dumps(state), encoding="utf-8")
            producer = subprocess.Popen([sys.executable, str(SCRIPT), "read"], cwd=repo,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            consumer = subprocess.Popen([sys.executable, str(SCRIPT), "replace", "--revision", "0"],
                                        cwd=repo, stdin=producer.stdout, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE)
            assert producer.stdout is not None
            producer.stdout.close()
            try:
                output, error = consumer.communicate(timeout=5)
                producer.wait(timeout=5)
                self.assertEqual(consumer.returncode, 0, error.decode())
                self.assertEqual(producer.returncode, 0)
                self.assertEqual(json.loads(output)["revision"], 1)
                stale = subprocess.run([sys.executable, str(SCRIPT), "replace", "--revision", "0"],
                                       cwd=repo, input=json.dumps(state), text=True,
                                       capture_output=True, timeout=5)
                self.assertNotEqual(stale.returncode, 0)
                self.assertIn("Revision conflict", stale.stderr)
                self.assertEqual(json.loads(board.read_text())["revision"], 1)
            finally:
                for process in (producer, consumer):
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    if process.stderr is not None:
                        process.stderr.close()


if __name__ == "__main__":
    unittest.main()
