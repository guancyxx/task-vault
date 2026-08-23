"""review_audit.py 的单元测试：确认通道判据 + 引用核验。

用临时 SQLite 库造 messages 表（只读连接查询）。覆盖：user actor 通道（headline-only）、
Reminders 通道（窗口内才算）、合法引用放行、伪造引用（msg 不存在 / session 不符 /
role 非 user / quote 非子串 / 时间晚于 done / 系统注入消息 / NULL 时间戳）、
quote 转义语法、宿主 TZ=UTC 下的时区回归（审计 C1）、多 citation 各自失败原因。
"""
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
try:
    from unittest import mock as unittest_mock
except ImportError:  # py<3.3
    unittest_mock = None

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.review_audit import (  # noqa: E402
    CitationChecker,
    USER_CONFIRM,
    confirmations,
    entries,
    unescape_quote,
)

SID = "20260823_064634_c34e81"
DONE_STAMP = "2026-08-23 07:10"
DONE_EPOCH = datetime.strptime(DONE_STAMP, "%Y-%m-%d %H:%M").timestamp()  # 宿主本地=上海


def make_db(tmp: Path, rows) -> Path:
    db = tmp / "state.db"
    con = sqlite3.connect(db)
    con.execute(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, "
        "content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL)"
    )
    for i, (mid, sid, role, content, ts) in enumerate(rows):
        con.execute(
            "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?,?,?,?,?)",
            (mid, sid, role, content, ts if ts is not None else DONE_EPOCH - 60),
        )
    con.commit()
    con.close()
    return db


def body_with(citation=None):
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
        groups = list(m.groups() if m else [])
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[0], SID)
        self.assertEqual(int(groups[1]), 64200)
        self.assertEqual(groups[2], "做")

    def test_regex_rejects_partial_and_empty(self):
        self.assertIsNone(USER_CONFIRM.search("user-confirm: session=x msg=1"))
        self.assertIsNone(USER_CONFIRM.search('user-confirm: session=x quote="y"'))
        self.assertIsNone(USER_CONFIRM.search('user-confirm: session=x msg=1 quote=""'))

    def test_regex_escaped_quote_and_backslash(self):
        line = 'user-confirm: session=s msg=1 quote="他说 \\"做\\""'
        m = USER_CONFIRM.search(line)
        self.assertIsNotNone(m)
        groups = list(m.groups() if m else [])
        self.assertEqual(groups[2], '他说 \\"做\\"')
        self.assertEqual(unescape_quote(groups[2]), '他说 "做"')
        self.assertEqual(unescape_quote("a\\\\b"), "a\\b")
        self.assertEqual(unescape_quote("a\\nb"), "a\\nb")  # 其余 \x 保持字面

    def test_unescape_quote_spherical(self):
        self.assertEqual(unescape_quote(""), "")
        self.assertEqual(unescape_quote("\\"), "\\")
        self.assertEqual(unescape_quote("\\\\\\"), "\\\\")


class TestConfirmations(unittest.TestCase):
    def test_window_and_channels(self):
        b = body_with('user-confirm: session=%s msg=1 quote="do"' % SID)
        es = entries(b)
        user_actor, reminders, cits = confirmations(es, 0)
        self.assertFalse(user_actor)
        self.assertFalse(reminders)
        self.assertEqual(cits, [(SID, 1, "do")])

    def test_user_actor_headline_only(self):
        # canonical headline 的 user actor 算确认
        b = (
            "## 执行记录\n\n"
            "- 2026-08-23 07:20 · **review→done** · `user`\n  确认\n"
            f"- {DONE_STAMP} · **doing→done** · `hermes`\n  x\n"
        )
        es = entries(b)
        user_actor, _, _ = confirmations(es, 1)
        self.assertTrue(user_actor)
        # 续行里的伪 actor（散文引用 `· \`user\``）不算——审计 R2
        b2 = (
            "## 执行记录\n\n"
            "- 2026-08-23 07:20 · `hermes`\n  用户说了 · `user` 这样的话\n"
            f"- {DONE_STAMP} · **review→done** · `hermes`\n  x\n"
        )
        es2 = entries(b2)
        user_actor2, _, _ = confirmations(es2, 0)
        self.assertFalse(user_actor2)

    def test_reminders_marker_only_in_window(self):
        # done 边之后（倒序区更靠前）的 Reminders 标记算确认
        b = (
            "## 执行记录\n\n"
            "- 2026-08-23 07:20 · `codex`\n  Reminders 里勾了完成\n"
            f"- {DONE_STAMP} · **review→done** · `hermes`\n  x\n"
        )
        es = entries(b)
        _, reminders, _ = confirmations(es, 0)
        self.assertTrue(reminders)
        # done 边之前（倒序区更靠后）的旧标记不算——窗口限定，审计 R2
        b2 = (
            "## 执行记录\n\n"
            f"- {DONE_STAMP} · **review→done** · `hermes`\n  x\n"
            "- 2026-08-23 06:00 · `codex`\n  Reminders 里勾了完成\n"
        )
        es2 = entries(b2)
        _, reminders2, _ = confirmations(es2, 0)
        self.assertFalse(reminders2)

    def test_citation_outside_window_ignored(self):
        b = (
            "## 执行记录\n\n"
            f"- {DONE_STAMP} · **review→done** · `hermes`\n  收尾\n"
            '- 2026-08-23 06:00 · `hermes`\n  user-confirm: session=%s msg=1 quote="做"\n' % SID
        )
        es = entries(b)
        _, _, cits = confirmations(es, 0)
        self.assertEqual(cits, [])


class TestCitationChecker(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def checker(self, rows):
        db = make_db(self.dir, rows)
        return CitationChecker(db)

    def test_valid_citation_passes(self):
        c = self.checker([(64200, SID, "user", "do", None)])
        ok, reason = c.verify((SID, 64200, "do"), DONE_STAMP)
        self.assertTrue(ok, reason)
        self.assertEqual(reason, "")

    def test_msg_not_found(self):
        c = self.checker([(1, SID, "user", "do", None)])
        ok, reason = c.verify((SID, 999, "do"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("not found", reason)

    def test_session_mismatch(self):
        c = self.checker([(64200, "other_session", "user", "do", None)])
        ok, reason = c.verify((SID, 64200, "do"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("mismatch", reason)

    def test_role_not_user(self):
        c = self.checker([(64200, SID, "assistant", "do", None)])
        ok, reason = c.verify((SID, 64200, "do"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("role", reason)

    def test_quote_not_substring(self):
        c = self.checker([(64200, SID, "user", "做", None)])
        ok, reason = c.verify((SID, 64200, "确认过了"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("substring", reason)

    def test_escaped_quote_roundtrip(self):
        content = '他说"做"就做'
        c = self.checker([(64200, SID, "user", content, None)])
        ok, reason = c.verify((SID, 64200, '他说\\"做\\"'), DONE_STAMP)
        self.assertTrue(ok, reason)

    def test_empty_quote_rejected(self):
        c = self.checker([(64200, SID, "user", "do", None)])
        ok, reason = c.verify((SID, 64200, ""), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("empty", reason)

    def test_later_than_done_edge(self):
        c = self.checker([(64200, SID, "user", "do", DONE_EPOCH + 3600)])
        ok, reason = c.verify((SID, 64200, "do"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("later", reason)

    def test_null_timestamp(self):
        db = self.dir / "null.db"
        con = sqlite3.connect(db)
        con.execute(
            "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, "
            "content TEXT, timestamp REAL)"
        )
        con.execute("INSERT INTO messages VALUES (1, ?, 'user', 'do', NULL)", (SID,))
        con.commit()
        con.close()
        c = CitationChecker(db)
        ok, reason = c.verify((SID, 1, "do"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("NULL", reason)

    def test_injected_message_rejected(self):
        c = self.checker([(64200, SID, "user", "[ASYNC DELEGATION COMPLETE — deleg_x] blah", None)])
        ok, reason = c.verify((SID, 64200, "blah"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("injected", reason)

    def test_missing_db(self):
        c = CitationChecker(self.dir / "nope.db")
        ok, reason = c.verify((SID, 1, "x"), DONE_STAMP)
        self.assertFalse(ok)
        self.assertIn("not found", reason)

    def test_distinct_reasons_per_citation(self):
        # 两条引用各自失败、原因不互相覆盖——审计 R3
        c = self.checker([(1, SID, "user", "ok", None)])
        ok1, r1 = c.verify(("nope", 1, "ok"), DONE_STAMP)
        ok2, r2 = c.verify((SID, 999, "x"), DONE_STAMP)
        self.assertFalse(ok1)
        self.assertFalse(ok2)
        self.assertIn("mismatch", r1)
        self.assertIn("not found", r2)


class TestTimezonePinned(unittest.TestCase):
    """审计 C1 回归：done 边固定 +08:00，宿主 TZ=UTC 下时序判定不漂移。"""

    def test_utc_host_rejects_later_message(self):
        code = """
import sys, sqlite3, datetime
sys.path.insert(0, {root!r})
from scripts.review_audit import CitationChecker
from datetime import timezone, timedelta
SH = timezone(timedelta(hours=8))
db_path, sid = {db!r}, {sid!r}
con = sqlite3.connect(db_path)
con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
# done 边 2026-08-23 07:10+08:00 = epoch(X)；消息 07:11+08:00 = X+60（在 60s 宽限内，过）
# 再造 07:15+08:00 = X+300（超出宽限，必须拒）
done_epoch = datetime.datetime(2026, 8, 23, 7, 10, tzinfo=SH).timestamp()
con.execute("INSERT INTO messages VALUES (1, ?, 'user', 'do', ?)", (sid, done_epoch + 60))
con.commit(); con.close()
c = CitationChecker(__import__('pathlib').Path(db_path))
grace_ok, _ = c.verify((sid, 1, 'do'), '2026-08-23 07:10')
print('GRACE', grace_ok)
con = sqlite3.connect(db_path)
con.execute("UPDATE messages SET timestamp=?", (done_epoch + 300,))
con.commit(); con.close()
c2 = CitationChecker(__import__('pathlib').Path(db_path))
later_ok, later_reason = c2.verify((sid, 1, 'do'), '2026-08-23 07:10')
print('LATER', later_ok, later_reason)
""".format(root=str(ROOT), db=None, sid=SID)
        with tempfile.TemporaryDirectory() as td:
            db = Path(td) / "tz.db"
            code = code.replace("db_path, sid = None, {sid!r}".format(sid=SID), f"db_path, sid = {str(db)!r}, {SID!r}")
            env = dict(os.environ, TZ="UTC", PYTHONPATH=str(ROOT))
            r = subprocess.run(
                [sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=60
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            grace_line = [l for l in r.stdout.splitlines() if l.startswith("GRACE")][0]
            later_line = [l for l in r.stdout.splitlines() if l.startswith("LATER")][0]
            self.assertTrue(grace_line.startswith("GRACE True"), grace_line)
            self.assertTrue(later_line.startswith("LATER False"), later_line)


class TestNoEdgeAndAnchoring(unittest.TestCase):
    """审计 R1 闭环（全行锚定）+ C2（无边形态）。"""

    def test_citation_rejects_junk(self):
        for line in (
            'xx user-confirm: session=s msg=1 quote="做"',       # 前缀垃圾
            'user-confirm: session=s msg=1 quote="做" trailing',  # 尾随垃圾
        ):
            self.assertIsNone(USER_CONFIRM.search(line), line)

    def test_citation_accepts_standalone_line(self):
        line = 'user-confirm: session=s msg=1 quote="做"'
        self.assertIsNotNone(USER_CONFIRM.search(line))
        # 缩进两格（执行记录条目正文形态）也算独立行
        self.assertIsNotNone(USER_CONFIRM.search("  " + line))

    def test_no_edge_body_citation_not_a_confirmation(self):
        # 无 done 迁移边：正则能匹配到 citation，但主流程的无边路径只认 user actor /
        # Reminders 标记（防复用历史 citation）——这里锁定正则行为，无边路径在 main() 里，
        # 由 test_main_no_edge_done_without_user_confirmation 覆盖。
        b = (
            "## 执行记录\n\n"
            "- 2026-08-23 07:00 · `hermes`\n  user-confirm: session=%s msg=1 quote=\"做\"\n" % SID
        )
        es = entries(b)
        self.assertIsNotNone(USER_CONFIRM.search(es[0][2]))


class TestMainNoEdgePaths(unittest.TestCase):
    """main() 的无边 done 路径：无用户确认 → 危险项；有 Reminders → 放过。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.vault = Path(self.tmp.name)

    def _write_task(self, name, body):
        d = self.vault / "03 Tasks" / "proj"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{name}.md"
        p.write_text(
            "---\nid: %s\ntitle: %s\nstatus: done\nassignee: hermes\n---\n%s" % (name, name, body),
            encoding="utf-8",
        )
        return p

    def test_no_edge_done_without_user_confirmed_flagged(self):
        self._write_task("t1", "## 执行记录\n\n- 2026-08-23 07:00 · `hermes`\n  直接写 done\n")
        with unittest_mock.patch("scripts.review_audit.TASKS", self.vault / "03 Tasks"):
            import contextlib, io
            from scripts import review_audit as ra
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = ra.main()
        self.assertEqual(rc, 0)
        self.assertIn("done 无迁移边且无用户确认", buf.getvalue())

    def test_no_edge_done_with_reminders_not_flagged(self):
        self._write_task(
            "t2", "## 执行记录\n\n- 2026-08-23 07:00 · `hermes`\n  Reminders 里勾了完成\n"
        )
        with unittest_mock.patch("scripts.review_audit.TASKS", self.vault / "03 Tasks"):
            import contextlib, io
            from scripts import review_audit as ra
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = ra.main()
        self.assertEqual(rc, 0)
        self.assertIn("clean", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
