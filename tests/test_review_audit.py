"""review_audit.py 的单元测试：确认通道判据 + 引用核验。

用临时 SQLite 库造 messages 表（只读连接查询），fixture 任务文件走 tmp vault。
覆盖：user actor 通道、Reminders 通道、合法引用放行、伪造引用（msg 不存在 /
session 不符 / role 非 user / quote 非子串 / 时间晚于 done / 系统注入消息）
全部拦下、无确认拦下。
"""
import re
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.review_audit import (  # noqa: E402
    AGENT_ACTORS,
    CitationChecker,
    USER_CONFIRM,
    confirmations,
    entries,
)

SID = "20260823_064634_c34e81"
DONE_STAMP = "2026-08-23 07:10"


def make_db(tmp: Path, rows) -> Path:
    db = tmp / "state.db"
    con = sqlite3.connect(db)
    con.execute(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, "
        "content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL)"
    )
    # timestamp: epoch seconds — done 边 2026-08-23 07:10 local 之前
    done_epoch = datetime.strptime(DONE_STAMP, "%Y-%m-%d %H:%M").timestamp()
    for i, (mid, sid, role, content, ts) in enumerate(rows):
        con.execute(
            "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?,?,?,?,?)",
            (mid, sid, role, content, ts if ts is not None else done_epoch - 60),
        )
    con.commit()
    con.close()
    return db


def body_with(citation: Optional[str]) -> str:
    cite = f"\n  {citation}" if citation else ""
    return (
        "## 执行记录\n\n"
        f"- {DONE_STAMP} · **review→done** · `hermes`\n"
        f"  用户确认，收尾{cite}\n"
        f"- 2026-08-23 06:49 · **doing→review** · `hermes`\n"
        "  核查完毕\n"
    )


class TestCitationRegex(unittest.TestCase):
    def test_regex_matches_canonical(self):
        line = 'user-confirm: session=20260823_064634_c34e81 msg=64200 quote="做"'
        m = USER_CONFIRM.search(line)
        self.assertIsNotNone(m)
        groups = list(m.groups() if m else [])
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[0], SID)
        self.assertEqual(int(groups[1]), 64200)
        self.assertEqual(groups[2], "做")

    def test_regex_rejects_partial(self):
        self.assertIsNone(USER_CONFIRM.search("user-confirm: session=x msg=1"))
        self.assertIsNone(USER_CONFIRM.search('user-confirm: session=x quote="y"'))


class TestConfirmations(unittest.TestCase):
    def test_window_and_channels(self):
        b = body_with('user-confirm: session=%s msg=1 quote="do"' % SID)
        es = entries(b)
        user_actor, reminders, cits = confirmations(es, 0)
        self.assertFalse(user_actor)
        self.assertFalse(reminders)
        self.assertEqual(cits, [(SID, 1, "do")])

    def test_user_actor_channel(self):
        b = "## 执行记录\n\n- 2026-08-23 07:20 · `user`\n  确认\n- " + DONE_STAMP + " · **review→done** · `hermes`\n  x\n"
        es = entries(b)
        user_actor, _, _ = confirmations(es, 0)
        self.assertTrue(user_actor)


class TestCitationChecker(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def checker(self, rows) -> CitationChecker:
        db = make_db(self.dir, rows)
        return CitationChecker(db)

    def test_valid_citation_passes(self):
        c = self.checker([(64200, SID, "user", "do", None)])
        self.assertTrue(c.verify((SID, 64200, "do"), DONE_STAMP))
        self.assertEqual(c.fail_reason, "")

    def test_msg_not_found(self):
        c = self.checker([(1, SID, "user", "do", None)])
        self.assertFalse(c.verify((SID, 999, "do"), DONE_STAMP))

    def test_session_mismatch(self):
        c = self.checker([(64200, "other_session", "user", "do", None)])
        self.assertFalse(c.verify((SID, 64200, "do"), DONE_STAMP))

    def test_role_not_user(self):
        c = self.checker([(64200, SID, "assistant", "do", None)])
        self.assertFalse(c.verify((SID, 64200, "do"), DONE_STAMP))

    def test_quote_not_substring(self):
        c = self.checker([(64200, SID, "user", "做", None)])
        self.assertFalse(c.verify((SID, 64200, "确认过了"), DONE_STAMP))

    def test_later_than_done_edge(self):
        done_epoch = datetime.strptime(DONE_STAMP, "%Y-%m-%d %H:%M").timestamp()
        c = self.checker([(64200, SID, "user", "do", done_epoch + 3600)])
        self.assertFalse(c.verify((SID, 64200, "do"), DONE_STAMP))

    def test_injected_message_rejected(self):
        c = self.checker([(64200, SID, "user", "[ASYNC DELEGATION COMPLETE — deleg_x] blah", None)])
        self.assertFalse(c.verify((SID, 64200, "blah"), DONE_STAMP))

    def test_missing_db(self):
        c = CitationChecker(self.dir / "nope.db")
        self.assertFalse(c.verify((SID, 1, "x"), DONE_STAMP))
        self.assertIn("not found", c.fail_reason)


if __name__ == "__main__":
    unittest.main()
