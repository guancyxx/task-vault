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


class RemindersSyncTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.vault = Path(self.temporary.name) / "vault"
        self.tasks = self.vault / "03 Tasks"
        self.tasks.mkdir(parents=True)
        self.state = Path(self.temporary.name) / "reminders.json"
        self.mock = Path(self.temporary.name) / "remindctl"
        self.mock.write_bytes(MOCK_SOURCE.read_bytes())
        self.mock.chmod(self.mock.stat().st_mode | stat.S_IXUSR)
        self.env = {**os.environ, "MOCK_REMINDERS_STATE": str(self.state)}

    def tearDown(self):
        self.temporary.cleanup()

    def run_sync(self, *extra):
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "reminders_sync.py"), "--vault", str(self.vault), "--remindctl", str(self.mock), *extra],
            check=True,
            capture_output=True,
            text=True,
            env=self.env,
        )

    def test_create_then_second_round_has_zero_actions(self):
        task_path = self.tasks / "2026-08-19-new.md"
        task(task_path, str(uuid.uuid4()), "New task", "todo", "2026-08-20")
        first = self.run_sync()
        self.assertIn("created=1", first.stdout)
        metadata, _ = read_frontmatter(task_path)
        self.assertRegex(metadata["mirror"]["reminders-uuid"], r"^[0-9A-F-]{36}$")
        before = json.loads(self.state.read_text(encoding="utf-8"))
        second = self.run_sync()
        after = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertIn("actions=0", second.stdout)
        self.assertEqual(len(after["reminders"]), len(before["reminders"]))

    def test_due_change_uses_full_uuid_and_done_completes(self):
        reminder_id = "11111111-2222-3333-4444-555555555555"
        task_path = self.tasks / "2026-08-19-linked.md"
        task(task_path, str(uuid.uuid4()), "Changed title", "todo", "2026-08-21T10:30", reminder_id)
        self.state.write_text(json.dumps({"reminders": [{
            "id": reminder_id, "title": "Old title", "notes": "", "dueDate": "2026-08-20T01:00:00Z", "isAllDay": True, "isCompleted": False, "list": "待办"
        }], "calls": []}), encoding="utf-8")
        self.run_sync()
        state = json.loads(self.state.read_text(encoding="utf-8"))
        # retitle (title drift) + reschedule (due change) are separate edits
        edits = [call for call in state["calls"] if call[0] == "edit"]
        self.assertGreaterEqual(len(edits), 1)
        due_edit = next(e for e in edits if "--due" in e)
        self.assertEqual(due_edit[1], reminder_id)
        self.assertEqual(due_edit[due_edit.index("--due") + 1], "2026-08-21T02:30:00Z")
        metadata, body = read_frontmatter(task_path)
        metadata["status"] = "done"
        write_frontmatter(task_path, metadata, body)
        self.run_sync()
        state = json.loads(self.state.read_text(encoding="utf-8"))
        complete = next(call for call in state["calls"] if call[0] == "complete")
        self.assertEqual(complete[1], reminder_id)

    def test_title_change_retitles_but_keeps_stable_identity(self):
        reminder_id = "12121212-3434-5656-7878-909090909090"
        task_path = self.tasks / "2026-08-19-stable.md"
        task(task_path, str(uuid.uuid4()), "Changed title", "todo", "2026-08-20", reminder_id)
        self.state.write_text(json.dumps({"reminders": [{
            "id": reminder_id, "title": "Original title", "notes": "", "dueDate": "2026-08-20T01:00:00Z", "isAllDay": True, "isCompleted": False, "list": "待办"
        }], "calls": []}), encoding="utf-8")
        self.run_sync()
        calls = json.loads(self.state.read_text(encoding="utf-8"))["calls"]
        # title drift → one retitle edit; identity stays: no new "add" for the same task
        self.assertEqual([call[0] for call in calls if call[0] != "show"], ["edit"])
        self.assertNotIn("add", [call[0] for call in calls])

    def test_review_with_uncompleted_reminder_stays_review(self):
        reminder_id = "13131313-3434-5656-7878-909090909090"
        task_path = self.tasks / "2026-08-19-review.md"
        task(task_path, str(uuid.uuid4()), "Needs review", "review", "2026-08-20", reminder_id)
        self.state.write_text(json.dumps({"reminders": [{
            "id": reminder_id, "title": "Needs review", "notes": "", "dueDate": "2026-08-20T01:00:00Z",
            "isAllDay": True, "isCompleted": False, "list": "待办"
        }], "calls": []}), encoding="utf-8")
        self.run_sync()
        metadata, _ = read_frontmatter(task_path)
        self.assertEqual(metadata["status"], "review")
        calls = json.loads(self.state.read_text(encoding="utf-8"))["calls"]
        self.assertNotIn("complete", [call[0] for call in calls])

    def test_review_with_completed_reminder_becomes_done(self):
        reminder_id = "14141414-3434-5656-7878-909090909090"
        task_path = self.tasks / "2026-08-19-review.md"
        task(task_path, str(uuid.uuid4()), "Approved", "review", "2026-08-20", reminder_id)
        self.state.write_text(json.dumps({"reminders": [{
            "id": reminder_id, "title": "Approved", "notes": "", "dueDate": "2026-08-20T01:00:00Z",
            "isAllDay": True, "isCompleted": True, "list": "待办"
        }], "calls": []}), encoding="utf-8")
        self.run_sync()
        metadata, body = read_frontmatter(task_path)
        self.assertEqual(metadata["status"], "done")
        self.assertIn("· **review→done** · `codex`", body)

    def test_reminder_completion_writes_done_fires_hook_once_and_siri_flows_back(self):
        linked_id = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
        task_id = str(uuid.uuid4())
        task_path = self.tasks / "2026-08-19-linked.md"
        task(task_path, task_id, "Linked", "todo", "2026-08-20", linked_id)
        hook_log = Path(self.temporary.name) / "hook.log"
        state = {"reminders": [
            {"id": linked_id, "title": "Linked", "notes": f"task-vault-id:{task_id}", "dueDate": "2026-08-20T01:00:00Z", "isAllDay": True, "isCompleted": True, "list": "待办"},
            {"id": "99999999-8888-7777-6666-555555555555", "title": "Siri task", "notes": "", "dueDate": "2026-08-22T01:00:00Z", "isAllDay": True, "isCompleted": False, "list": "待办"},
            {"id": "00000000-1111-2222-3333-444444444444", "title": "Orphan", "notes": "task-vault-id:missing", "dueDate": None, "isAllDay": False, "isCompleted": False, "list": "待办"},
        ], "calls": []}
        self.state.write_text(json.dumps(state), encoding="utf-8")
        config_dir = self.vault / ".taskvault"
        config_dir.mkdir()
        config_dir.joinpath("config.json").write_text(json.dumps({
            "version": 1, "terminal_hook": f"printf '%s\\n' '{{TASK_ID}}' >> '{hook_log}'"
        }), encoding="utf-8")
        result = self.run_sync()
        self.assertIn("orphan=1", result.stdout)
        metadata, body = read_frontmatter(task_path)
        self.assertEqual(metadata["status"], "done")
        self.assertIn("· **todo→done** · `codex`", body)
        self.assertEqual(hook_log.read_text(encoding="utf-8").splitlines(), [task_id])
        siri = [path for path in self.tasks.rglob("*.md") if path != task_path]
        self.assertEqual(len(siri), 1)
        siri_metadata, _ = read_frontmatter(siri[0])
        self.assertEqual((siri_metadata["status"], siri_metadata["source"]), ("inbox", "siri"))
        self.assertEqual(siri_metadata["mirror"]["reminders-uuid"], "99999999-8888-7777-6666-555555555555")
        second = self.run_sync()
        self.assertIn("actions=0", second.stdout)
        self.assertEqual(hook_log.read_text(encoding="utf-8").splitlines(), [task_id])

    def test_dry_run_reconciles_without_mutating_files_or_reminders(self):
        task_path = self.tasks / "2026-08-19-new.md"
        task(task_path, str(uuid.uuid4()), "New", "todo", "2026-08-20")
        before = task_path.read_bytes()
        result = self.run_sync("--dry-run")
        self.assertIn("would-create", result.stdout)
        self.assertEqual(task_path.read_bytes(), before)
        state = json.loads(self.state.read_text(encoding="utf-8"))
        self.assertEqual(state["reminders"], [])
        self.assertEqual(state["calls"], [["show", "all", "--list", "待办", "--json", "--no-input"]])


if __name__ == "__main__":
    unittest.main()
