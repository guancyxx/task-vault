import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

from scripts.tv_common import read_frontmatter, write_frontmatter


ROOT = Path(__file__).resolve().parents[1]
MOCK_SOURCE = ROOT / "tests" / "fixtures" / "mock_remindctl.py"


def task(path: Path, task_id: str, title: str, status: str, due=None, mirror=None):
    metadata = {
        "id": task_id,
        "title": title,
        "status": status,
        "created": "2026-08-19",
        "priority": "normal",
        "source": "user",
        "assignee": "user",
    }
    if due:
        metadata["due"] = due
    if mirror:
        metadata["mirror"] = {"reminders-uuid": mirror}
    write_frontmatter(path, metadata, "")


def reminder(reminder_id: str, notes: str = "", completed: bool = False) -> dict[str, object]:
    return {
        "id": reminder_id,
        "title": "Mirrored",
        "notes": notes,
        "dueDate": "2026-08-20T01:00:00Z",
        "isAllDay": True,
        "isCompleted": completed,
        "list": "待办",
    }


class ArchiveDailyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        self.tasks = self.vault / "03 Tasks"
        self.tasks.mkdir(parents=True)
        self.state = Path(self.temporary.name) / "reminders.json"
        self.mock = Path(self.temporary.name) / "remindctl"
        self.mock.write_bytes(MOCK_SOURCE.read_bytes())
        self.mock.chmod(self.mock.stat().st_mode | stat.S_IXUSR)
        self.env = {
            **os.environ,
            "MOCK_REMINDERS_STATE": str(self.state),
            "TASK_VAULT": str(self.vault),
        }
        self.env.pop("MOCK_REMINDERS_FAIL_DELETE", None)

    def tearDown(self):
        self.temporary.cleanup()

    def run_archive(self, *extra, fail_delete=False):
        env = dict(self.env)
        if fail_delete:
            env["MOCK_REMINDERS_FAIL_DELETE"] = "1"
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "archive_daily.py"), "--remindctl", str(self.mock), *extra],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )

    def mock_state(self) -> dict:
        return json.loads(self.state.read_text(encoding="utf-8"))

    def seed_state(self, reminders) -> None:
        self.state.write_text(json.dumps({"reminders": reminders, "calls": []}, ensure_ascii=False), encoding="utf-8")

    # a. done task with mirror → reminder deleted, mirror block stripped, counted
    def test_done_task_with_mirror_deletes_reminder_and_strips_mirror(self):
        reminder_id = "11111111-2222-3333-4444-555555555555"
        task_id = str(uuid.uuid4())
        task_path = self.tasks / "2026-08-19-done.md"
        task(task_path, task_id, "Done task", "done", "2026-08-20", reminder_id)
        self.seed_state([reminder(reminder_id, notes=f"task-vault-id:{task_id}", completed=True)])
        result = self.run_archive()
        self.assertIn("mirrors-deleted=1", result.stdout)
        self.assertIn("mirrors-failed=0", result.stdout)
        self.assertIn(f"mirror-deleted {task_id} {reminder_id}", result.stdout)
        state = self.mock_state()
        self.assertEqual([r["id"] for r in state["reminders"]], [])
        delete_call = next(call for call in state["calls"] if call and call[0] == "delete")
        self.assertEqual(delete_call[:3], ["delete", reminder_id, "--force"])
        archived = self.vault / "98 archive" / "03 Tasks" / "2026-08-19-done.md"
        metadata, _ = read_frontmatter(archived)
        self.assertNotIn("mirror", metadata)

    # b. done task without mirror → plain move, no delete calls
    def test_done_task_without_mirror_archives_without_delete(self):
        live_id = "99999999-8888-7777-6666-555555555555"
        task_path = self.tasks / "2026-08-19-plain.md"
        task(task_path, str(uuid.uuid4()), "Plain", "done", "2026-08-20")
        self.seed_state([reminder(live_id)])
        result = self.run_archive()
        self.assertIn("files=1", result.stdout)
        self.assertIn("mirrors-deleted=0", result.stdout)
        state = self.mock_state()
        self.assertNotIn("delete", [call[0] for call in state["calls"] if call])
        self.assertEqual([r["id"] for r in state["reminders"]], [live_id])
        self.assertTrue((self.vault / "98 archive" / "03 Tasks" / "2026-08-19-plain.md").exists())

    # c. delete failure → archive still completes, failure reported, mirror kept
    def test_delete_failure_does_not_block_archive_and_keeps_mirror(self):
        reminder_id = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
        task_id = str(uuid.uuid4())
        task_path = self.tasks / "2026-08-19-fail.md"
        task(task_path, task_id, "Failing delete", "done", "2026-08-20", reminder_id)
        self.seed_state([reminder(reminder_id, notes=f"task-vault-id:{task_id}")])
        result = self.run_archive(fail_delete=True)
        self.assertIn("mirror-delete-failed", result.stdout)
        self.assertIn("mirrors-failed=1", result.stdout)
        self.assertIn("mirrors-deleted=0", result.stdout)
        archived = self.vault / "98 archive" / "03 Tasks" / "2026-08-19-fail.md"
        self.assertTrue(archived.exists())
        metadata, _ = read_frontmatter(archived)
        self.assertEqual(metadata["mirror"]["reminders-uuid"], reminder_id)
        state = self.mock_state()
        self.assertEqual([r["id"] for r in state["reminders"]], [reminder_id])

    # c2. cancelled task with mirror → same handling as done
    def test_cancelled_task_with_mirror_deletes_reminder(self):
        reminder_id = "12121212-3434-5656-7878-909090909090"
        task_path = self.tasks / "2026-08-19-cancelled.md"
        task(task_path, str(uuid.uuid4()), "Cancelled task", "cancelled", "2026-08-20", reminder_id)
        self.seed_state([reminder(reminder_id)])
        result = self.run_archive()
        self.assertIn("mirrors-deleted=1", result.stdout)
        self.assertEqual([r["id"] for r in self.mock_state()["reminders"]], [])
        archived = self.vault / "98 archive" / "03 Tasks" / "2026-08-19-cancelled.md"
        metadata, _ = read_frontmatter(archived)
        self.assertNotIn("mirror", metadata)

    # d. dry-run → no delete, no write, file stays put
    def test_dry_run_deletes_and_writes_nothing(self):
        reminder_id = "34343434-1212-7878-5656-909090909090"
        task_path = self.tasks / "2026-08-19-dry.md"
        task(task_path, str(uuid.uuid4()), "Dry run", "done", "2026-08-20", reminder_id)
        self.seed_state([reminder(reminder_id)])
        before = task_path.read_bytes()
        result = self.run_archive("--dry-run")
        self.assertIn(f"would-delete-mirror {reminder_id}", result.stdout)
        self.assertIn("mode=dry-run", result.stdout)
        self.assertEqual(task_path.read_bytes(), before)
        state = self.mock_state()
        self.assertEqual([r["id"] for r in state["reminders"]], [reminder_id])
        self.assertNotIn("delete", [call[0] for call in state["calls"] if call])
        metadata, _ = read_frontmatter(task_path)
        self.assertEqual(metadata["mirror"]["reminders-uuid"], reminder_id)

    # e. idempotent rerun → nothing left to archive
    def test_rerun_after_archive_is_empty(self):
        task_path = self.tasks / "2026-08-19-once.md"
        task(task_path, str(uuid.uuid4()), "Once", "done")
        self.seed_state([])
        first = self.run_archive()
        self.assertIn("files=1", first.stdout)
        second = self.run_archive()
        self.assertIn("files=0", second.stdout)
        self.assertIn("mirrors-deleted=0", second.stdout)

    # f. batch of two mirrored done tasks → both deleted
    def test_batch_two_mirrored_tasks_counts_two(self):
        first_id = "55555555-6666-7777-8888-999999999999"
        second_id = "ABCDEF01-2345-6789-ABCD-EF0123456789"
        task(self.tasks / "2026-08-19-a.md", str(uuid.uuid4()), "A", "done", "2026-08-20", first_id)
        task(self.tasks / "2026-08-19-b.md", str(uuid.uuid4()), "B", "done", "2026-08-20", second_id)
        self.seed_state([reminder(first_id), reminder(second_id)])
        result = self.run_archive()
        self.assertIn("files=2", result.stdout)
        self.assertIn("mirrors-deleted=2", result.stdout)
        self.assertEqual(self.mock_state()["reminders"], [])

    # f2. live reminder without a task-vault-id note (no mirror) is untouched
    def test_unlinked_live_reminder_is_untouched(self):
        unlinked_id = "77777777-7777-7777-7777-777777777777"
        task_path = self.tasks / "2026-08-19-nomirror.md"
        task(task_path, str(uuid.uuid4()), "No mirror done", "done", "2026-08-20")
        self.seed_state([reminder(unlinked_id, notes="")])
        self.run_archive()
        state = self.mock_state()
        self.assertEqual([r["id"] for r in state["reminders"]], [unlinked_id])
        self.assertNotIn("delete", [call[0] for call in state["calls"] if call])


if __name__ == "__main__":
    unittest.main()
