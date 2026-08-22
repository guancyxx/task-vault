#!/usr/bin/env python3
"""Task Vault 复核审计（只报告，绝不修改任务文件）。

三类信号：
1. 危险项：assignee≠user ∧ status=done ∧ done 迁移条目 actor 是 agent
   ∧ 无有效用户确认。确认通道（与插件 reviewGate.ts 同源判据，勿漂移）：
   a. done 边上或之后（倒序区索引 ≤ doneIndex）的 `user` actor 条目
   b. 「Reminders 里勾了完成」标记
   c. 聊天确认引用 user-confirm: session=<sid> msg=<id> quote="…"（FR-030a）
      —— 审计侧对每条引用去 Hermes 会话库核验：msg 存在、role=user、
      session 吻合、quote 是原文子串、时间不晚于 done 边。核不过 = 危险项。
2. 待办队列：status=review（等用户复核）∧ assignee≠user
3. 卡点：最新条目含「卡点」∧ assignee≠user

环境：TASK_VAULT 覆盖 vault 根；TV_STATE_DB 覆盖会话库路径（测试用）。
输出：ntfy bot 推送（无信号静默）+ 报告 ~/.hermes/cache/tv-review-audit.log

2026-08-23 收紧：旧的「正文含『复核』二字即算已复核」启发式移除——agent 笔记
里引用「复核门禁」字样即可自我洗白，判据收敛为上面 a/b/c 三条硬通道。
"""
from __future__ import annotations

import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

VAULT = Path(os.environ.get("TASK_VAULT", Path.home() / "Documents" / "Obsidian Vault"))
TASKS = VAULT / "03 Tasks"
STATE_DB = Path(os.environ.get("TV_STATE_DB", Path.home() / ".hermes" / "state.db"))
AGENT_ACTORS = {"hermes", "cc", "codex"}
REMINDERS_MARK = "Reminders 里勾了完成"
# 迁移条目行：- 2026-08-22 19:20 · **doing→done** · `hermes`
MIGRATION = re.compile(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*\*\*(\w+)→(\w+)\*\*\s*·\s*`(\w+)`")
ANY_ENTRY = re.compile(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s")
# 与插件 reviewGate.ts 的 USER_CONFIRM 同源，勿漂移
USER_CONFIRM = re.compile(r'user-confirm:\s*session=([\w.-]+)\s+msg=(\d+)\s+quote="([^"\n]+)"')
# 系统注入的伪 user 消息（非用户亲手输入）不算确认
INJECTED_PREFIXES = ("[ASYNC", "[OUT-OF-BAND")


def read_task(path: Path):
    text = path.read_text(encoding="utf-8", errors="replace")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return None
    fm, body = m.group(1), m.group(2)

    def field(name: str) -> str:
        mm = re.search(rf"^{name}:\s*(.+)$", fm, re.M)
        return mm.group(1).strip() if mm else ""

    assignee = field("assignee")
    if assignee in ("", "user"):
        return None
    status = field("status")
    title = field("title").strip("\"'")
    return {"path": path, "assignee": assignee, "status": status, "title": title, "body": body}


def entries(body: str):
    """按条目边界切执行记录区，返回 [(stamp, headline, text)]，倒序区里保持文件顺序。"""
    sec = body.find("## 执行记录")
    if sec < 0:
        return []
    rest = body[sec:]
    out, cur = [], None
    for line in rest.splitlines():
        mm = ANY_ENTRY.match(line)
        if mm:
            if cur:
                out.append(cur)
            cur = [mm.group(1), line, ""]
        elif cur is not None:
            cur[2] += line + "\n"
    if cur:
        out.append(cur)
    return out


class CitationChecker:
    """核验 user-confirm 引用是否真实。只在首次用到时打开 state.db（只读）。"""

    def __init__(self, db: Path = STATE_DB):
        self.db = db
        self._con: sqlite3.Connection | None = None
        self.fail_reason = ""

    def _connect(self) -> sqlite3.Connection | None:
        if self._con is None:
            if not self.db.exists():
                self.fail_reason = f"state db not found: {self.db}"
                return None
            try:
                self._con = sqlite3.connect(f"file:{self.db}?mode=ro", uri=True)
            except sqlite3.Error as e:
                self.fail_reason = f"state db open failed: {e}"
                return None
        return self._con

    def verify(self, cited: tuple[str, int, str], done_stamp: str) -> bool:
        """cited = (session, msg_id, quote)。返回 True 才算有效确认。"""
        session, msg_id, quote = cited
        con = self._connect()
        if con is None:
            return False
        try:
            row = con.execute(
                "SELECT session_id, role, content, timestamp FROM messages WHERE id=?",
                (msg_id,),
            ).fetchone()
        except sqlite3.Error as e:
            self.fail_reason = f"state db query failed: {e}"
            return False
        if row is None:
            self.fail_reason = f"msg {msg_id} not found"
            return False
        db_session, role, content, ts = row
        if db_session != session:
            self.fail_reason = f"msg {msg_id} session mismatch: {db_session} != {session}"
            return False
        if role != "user":
            self.fail_reason = f"msg {msg_id} role={role}"
            return False
        stripped = (content or "").lstrip()
        if any(stripped.startswith(p) for p in INJECTED_PREFIXES):
            self.fail_reason = f"msg {msg_id} is system-injected"
            return False
        if quote not in (content or ""):
            self.fail_reason = f"msg {msg_id} quote not substring"
            return False
        # 用户确认必须不晚于 done 边（本地分钟戳 vs epoch）
        try:
            done_epoch = datetime.strptime(done_stamp, "%Y-%m-%d %H:%M").timestamp()
        except ValueError:
            self.fail_reason = f"bad done stamp {done_stamp}"
            return False
        if ts > done_epoch + 60:
            self.fail_reason = f"msg {msg_id} is later than done edge"
            return False
        return True


def confirmations(es, done_idx: int):
    """done 边上或之后的确认证据。es 倒序（新在上），≤ done_idx 即时间上不早于 done。"""
    window = es[: done_idx + 1]
    user_actor = any("`user`" in h for _, h, _ in window)
    reminders = any(REMINDERS_MARK in tx for _, _, tx in window)
    citations = []
    for _, _, tx in window:
        for m in USER_CONFIRM.finditer(tx):
            citations.append((m.group(1), int(m.group(2)), m.group(3)))
    return user_actor, reminders, citations


def main() -> int:
    dangers, review_q, stuck_q = [], [], []
    checker = CitationChecker()
    for path in sorted(TASKS.rglob("*.md")):
        if "_archive" in path.parts:
            continue
        t = read_task(path)
        if not t:
            continue
        es = entries(t["body"])
        if t["status"] == "done":
            for idx, (stamp, headline, text) in enumerate(es):
                mm = MIGRATION.match(headline)
                if mm and mm.group(3) == "done":
                    actor = mm.group(4)
                    if actor in AGENT_ACTORS:
                        user_actor, reminders, citations = confirmations(es, idx)
                        if user_actor or reminders:
                            break
                        if citations:
                            done_stamp = mm.group(1)
                            bad = [c for c in citations if not checker.verify(c, done_stamp)]
                            if not bad:
                                break  # 引用全部核验通过 = 用户已确认
                            detail = "; ".join(
                                f"msg={c[1]}({checker.fail_reason})" for c in bad
                            )
                            dangers.append((stamp, t["title"], actor, f"引用核验失败 {detail}"))
                            break
                        dangers.append((stamp, t["title"], actor, "无用户确认"))
                    break
        elif t["status"] == "review":
            review_q.append(t["title"])
        else:
            if es and "卡点" in es[0][1]:
                stuck_q.append(t["title"])

    lines = []
    if dangers:
        lines.append(f"⚠️ agent自行done未复核 {len(dangers)} 项:")
        for stamp, title, actor, why in dangers[:8]:
            lines.append(f"  · [{stamp}] {title} (by {actor}, {why})")
    if review_q:
        lines.append(f"👁 待复核 {len(review_q)} 项: " + "；".join(review_q[:6]))
    if stuck_q:
        lines.append(f"⛔ agent卡点 {len(stuck_q)} 项: " + "；".join(stuck_q[:6]))

    now = datetime.now().strftime("%F %T")
    if lines:
        report = f"[{now}] " + " | ".join(lines)
        log_path = Path.home() / ".hermes/cache/tv-review-audit.log"
        log_path.parent.mkdir(exist_ok=True)
        with open(log_path, "a") as f:
            f.write(report + "\n")
        msg = "\n".join(lines)
        try:
            subprocess.run(
                ["ntfy", "publish", "--tags", "bot,eyes", "tv-guancyxx", "Task复核审计", msg[:1500]],
                capture_output=True, timeout=15, check=False,
            )
        except Exception:
            pass
        print(report)
    else:
        print(f"[{now}] clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
