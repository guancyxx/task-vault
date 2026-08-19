import json
import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from scripts.tv_common import (
    ensure_unique_task_path,
    load_config,
    load_ledger,
    local_due_to_remindctl,
    reminder_alarm_to_remindctl,
    read_frontmatter,
    reminders_due_to_local_date,
    run_hook,
    slugify,
    update_ledger,
    write_frontmatter,
)


class TvCommonTest(unittest.TestCase):
    def test_frontmatter_round_trip_preserves_body_and_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "task.md"
            path.write_text("---\nid: fixed-id\ntitle: Old\n---\n\nBody\n", encoding="utf-8")
            frontmatter, body = read_frontmatter(path)
            frontmatter["title"] = "New"
            write_frontmatter(path, frontmatter, body)
            reread, reread_body = read_frontmatter(path)
            self.assertEqual(reread["id"], "fixed-id")
            self.assertEqual(reread["title"], "New")
            self.assertEqual(reread_body, "\nBody\n")

    def test_slug_and_collision_contract(self):
        self.assertEqual(slugify("  Hello，世界! -- A  "), "hello世界-a")
        self.assertEqual(slugify("!!!"), "task")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            pre = directory / "_未分类" / "2026-08-19"
            pre.mkdir(parents=True)
            (pre / "name.md").touch()
            self.assertEqual(
                ensure_unique_task_path(directory, "2026-08-19", "Name").name,
                "name-2.md",
            )

    def test_time_conversion_uses_fixed_eight_hour_rule(self):
        self.assertEqual(
            local_due_to_remindctl("2026-08-20T09:30"),
            "2026-08-20T01:30:00Z",
        )
        self.assertEqual(
            local_due_to_remindctl("2026-08-20", allday_time="09:00"),
            "2026-08-20T01:00:00Z",
        )
        self.assertEqual(
            reminders_due_to_local_date("2026-08-19T17:30:00Z"),
            date(2026, 8, 20),
        )
        self.assertEqual(reminder_alarm_to_remindctl("2026-08-20T09:30", "30m"), "2026-08-20T01:00:00Z")
        self.assertEqual(reminder_alarm_to_remindctl("2026-08-20T09:30", "2h"), "2026-08-19T23:30:00Z")
        self.assertEqual(reminder_alarm_to_remindctl("2026-08-20", "1d"), "2026-08-19T01:00:00Z")

    def test_config_defaults_and_ledger_update_rereads_latest(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault = Path(temporary)
            self.assertEqual(load_config(vault)["default_remind"]["allday"], "09:00")
            first = load_ledger(vault)
            first["dispatch"]["x"] = {"count": 1}
            update_ledger(vault, lambda ledger: ledger["terminal"].update({"y": {"status": "done"}}))
            ledger = load_ledger(vault)
            self.assertNotIn("x", ledger["dispatch"])
            self.assertIn("y", ledger["terminal"])

    def test_hook_substitutes_placeholders_and_sets_environment(self):
        task = {"id": "id-1", "title": "A title", "status": "done", "assignee": "codex"}
        with patch("scripts.tv_common.subprocess.run") as call:
            run_hook("printf {TASK_ID}", Path("/vault/task.md"), task)
        args, kwargs = call.call_args
        self.assertEqual(args[0], "printf id-1")
        self.assertEqual(kwargs["env"]["TV_TASK_TITLE"], "A title")
        self.assertTrue(kwargs["check"])


if __name__ == "__main__":
    unittest.main()
