import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from unittest.mock import patch

import yaml

from scripts.dispatch_backstop import MAX_ATTEMPTS, accepted_after, dispatch, needs_redispatch, section
from scripts.tv_common import SHANGHAI, load_ledger, read_frontmatter

NOW = datetime(2026, 8, 19, 18, 0, tzinfo=SHANGHAI)


def meta(**over):
    base = {"id": "t1", "title": "任务", "status": "todo", "assignee": "cc"}
    base.update(over)
    return base


def body(log_lines=(), delegate="建pr修复"):
    log = "\n".join(log_lines)
    return f"## 任务描述\n\n背景\n\n## 执行记录\n{log}\n\n## 委派\n{delegate}\n"


def stamp(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M")


def ledger(count=0, last_at=None):
    entry = {"count": count}
    if last_at:
        entry["last_at"] = last_at
    return {"dispatch": {"t1": entry}} if count or last_at else {"dispatch": {}}


class Eligibility(unittest.TestCase):
    def test_unassigned_and_self_assigned_are_never_redispatched(self):
        for assignee in ("", None, "user"):
            self.assertFalse(needs_redispatch(meta(assignee=assignee), body(), ledger(), NOW, 30))

    def test_only_todo_is_redispatched(self):
        for status in ("doing", "waiting", "done", "cancelled"):
            self.assertFalse(needs_redispatch(meta(status=status), body(), ledger(), NOW, 30))

    def test_assignee_without_dispatched_is_not_a_delegation(self):
        # `assignee: hermes` 是创建时的默认归属，vault 里 12 个任务如此。有主人 ≠ 派发过。
        self.assertFalse(needs_redispatch(meta(), body(), ledger(), NOW, 30))

    def test_auto_task_without_dispatched_is_claimed(self):
        self.assertTrue(needs_redispatch(meta(tags=["auto"]), body(), ledger(), NOW, 30))

    def test_task_without_auto_or_dispatched_is_not_claimed(self):
        self.assertFalse(needs_redispatch(meta(tags=["project/x"]), body(), ledger(), NOW, 30))

    def test_auto_task_already_accepted_is_not_claimed_again(self):
        accepted = f"- {(NOW - timedelta(minutes=5)).strftime('%Y-%m-%d %H:%M')} · `cc`\n  接单：已开始"
        self.assertFalse(needs_redispatch(meta(tags=["auto"]), body([accepted]), ledger(), NOW, 30))

    def test_inside_threshold_waits(self):
        m = meta(dispatched=stamp(10))
        self.assertFalse(needs_redispatch(m, body(), ledger(), NOW, 30))

    def test_past_threshold_with_no_pickup_fires(self):
        m = meta(dispatched=stamp(40))
        self.assertTrue(needs_redispatch(m, body(), ledger(), NOW, 30))

    def test_pickup_after_dispatch_stops_it(self):
        m = meta(dispatched=stamp(40))
        b = body([f"- {(NOW - timedelta(minutes=35)).strftime('%Y-%m-%d %H:%M')} [cc] [todo→doing] 接单：开始改"])
        self.assertFalse(needs_redispatch(m, b, ledger(), NOW, 30))

    def test_pickup_from_an_earlier_round_does_not_count(self):
        m = meta(dispatched=stamp(40))
        b = body([f"- {(NOW - timedelta(days=2)).strftime('%Y-%m-%d %H:%M')} [cc] 接单：上一轮的"])
        self.assertTrue(needs_redispatch(m, b, ledger(), NOW, 30))

    def test_ledger_last_at_without_frontmatter_dispatch_still_needs_evidence(self):
        recent = (NOW - timedelta(minutes=90)).isoformat(timespec="seconds")
        self.assertFalse(needs_redispatch(meta(), body(), ledger(count=1, last_at=recent), NOW, 30))

    def test_ledger_last_at_counts_as_a_dispatch(self):
        # 补派不写 frontmatter dispatched（禁令）——只看 dispatched 会每 tick 重派一次
        m = meta(dispatched=stamp(600))
        recent = (NOW - timedelta(minutes=5)).isoformat(timespec="seconds")
        self.assertFalse(needs_redispatch(m, body(), ledger(count=1, last_at=recent), NOW, 30))

    def test_gives_up_after_max_attempts(self):
        m = meta(dispatched=stamp(600))
        old = (NOW - timedelta(hours=5)).isoformat(timespec="seconds")
        self.assertFalse(needs_redispatch(m, body(), ledger(count=MAX_ATTEMPTS, last_at=old), NOW, 30))


class Sections(unittest.TestCase):
    def test_section_stops_at_next_heading(self):
        self.assertEqual(section(body(delegate="建pr修复"), "## 委派"), "建pr修复")

    def test_missing_section_is_empty(self):
        self.assertEqual(section("正文没有区", "## 委派"), "")

    def test_accepted_after_ignores_unstamped_lines(self):
        self.assertFalse(accepted_after(body(["接单 但这行没有时间戳"]), NOW - timedelta(hours=1)))

    def test_acceptance_counts_when_it_sits_on_the_indented_continuation_line(self):
        # 2026-08-19 起正文写在缩进续行上，「接单」多半不在表头那一行。
        head = f"- {(NOW - timedelta(minutes=35)).strftime('%Y-%m-%d %H:%M')} · **todo→doing** · `cc`"
        b = body([head, "  接单：开始改"])
        self.assertTrue(accepted_after(b, NOW - timedelta(hours=1)))
        self.assertFalse(accepted_after(b, NOW - timedelta(minutes=5)))


class AtomicDispatch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.vault = Path(self.tmp.name)
        self.path = self.vault / "03 Tasks" / "task.md"
        self.path.parent.mkdir(parents=True)
        self._write(meta(tags=["auto"]), body())

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, metadata, task_body):
        frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).rstrip()
        self.path.write_text(f"---\n{frontmatter}\n---\n{task_body}", encoding="utf-8")

    def _dispatch(self):
        with patch("scripts.dispatch_backstop.now_shanghai", return_value=NOW):
            return dispatch(self.vault, self.path, "hook", False, 30)

    def test_reread_status_changed_to_doing_skips_without_write(self):
        changed = meta(status="doing", tags=["auto"])
        self._write(changed, body())
        with patch("scripts.dispatch_backstop.run_hook") as hook:
            self.assertFalse(self._dispatch())
            hook.assert_not_called()
        self.assertNotIn("dispatched", read_frontmatter(self.path)[0])

    def test_reread_tags_changed_skips_without_write(self):
        self._write(meta(tags=[]), body())
        with patch("scripts.dispatch_backstop.run_hook") as hook:
            self.assertFalse(self._dispatch())
            hook.assert_not_called()
        self.assertNotIn("dispatched", read_frontmatter(self.path)[0])

    def test_reread_acceptance_skips_without_write(self):
        accepted = f"- {NOW.strftime('%Y-%m-%d %H:%M')} · `cc`\n  接单：开始"
        self._write(meta(tags=["auto"]), body([accepted]))
        with patch("scripts.dispatch_backstop.run_hook") as hook:
            self.assertFalse(self._dispatch())
            hook.assert_not_called()
        self.assertNotIn("dispatched", read_frontmatter(self.path)[0])

    def test_attempt_is_reserved_before_hook(self):
        def assert_reserved(*_args):
            self.assertEqual(load_ledger(self.vault)["dispatch"]["t1"]["count"], 1)

        with patch("scripts.dispatch_backstop.run_hook", side_effect=assert_reserved):
            self.assertTrue(self._dispatch())

    def test_attempts_advance_zero_to_three_then_stop(self):
        with patch("scripts.dispatch_backstop.run_hook") as hook:
            for expected in (1, 2, 3):
                # Each retry must be past the threshold and have no acceptance after it.
                current, current_body = read_frontmatter(self.path)
                current["dispatched"] = stamp(600)
                self._write(current, current_body)
                ledger_data = load_ledger(self.vault)
                if expected > 1:
                    ledger_data["dispatch"]["t1"]["last_at"] = (NOW - timedelta(hours=2)).isoformat()
                    ledger_path = self.vault / ".taskvault" / "ledger.json"
                    ledger_path.write_text(json.dumps(ledger_data), encoding="utf-8")
                self.assertTrue(self._dispatch())
                self.assertEqual(load_ledger(self.vault)["dispatch"]["t1"]["count"], expected)
            self.assertFalse(self._dispatch())
            self.assertEqual(hook.call_count, 3)

    def test_failed_hook_still_consumes_reserved_attempt(self):
        with patch("scripts.dispatch_backstop.run_hook", side_effect=RuntimeError("boom")):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                self._dispatch()
        self.assertEqual(load_ledger(self.vault)["dispatch"]["t1"]["count"], 1)


if __name__ == "__main__":
    unittest.main()
