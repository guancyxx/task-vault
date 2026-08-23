#!/usr/bin/env python3
"""Task Vault 复核审计（只报告，绝不修改任务文件）。

三类信号：
1. 危险项：assignee≠user ∧ status=done ∧ done 迁移条目 actor 是 agent
   ∧ 无有效用户确认。确认通道（与插件 reviewGate.ts 同源判据，勿漂移），
   全部只在 done 边上或之后的窗口内判定（倒序区索引 ≤ done_idx）：
   a. canonical 条目 headline 里的 `user` actor（正文续行里的 `· \\`user\\`` 是散文不算）
   b. 「Reminders 里勾了完成」标记
   c. 聊天确认引用 user-confirm: session=<sid> msg=<id> quote="…"（FR-030a）
      quote 转义：\\" → "，\\\\ → \\，其余 \\x 原样；空 quote 不匹配。
      审计侧对每条引用去 Hermes 会话库核验：msg 存在、role=user、session 吻合、
      quote 反转义后是原文子串、时间不晚于 done 边。核不过 = 危险项。
2. 待办队列：status=review（等用户复核）∧ assignee≠user
3. 卡点：最新条目含「卡点」∧ assignee≠user

时区铁律：执行记录时间戳固定 Asia/Shanghai（契约 §3），done 边换算必须显式
挂 +08:00，不随宿主 TZ 漂移（审计可能在任意 TZ 下被 cron/容器拉起）。

环境：TASK_VAULT 覆盖 vault 根；TV_STATE_DB 覆盖会话库路径（测试用）。
输出：ntfy bot 推送（无信号静默）+ 报告 ~/.hermes/cache/tv-review-audit.log。
推送失败不中断扫描，但落 stderr + 审计日志，退出码 2（可被监控观测）。

2026-08-23 收紧：旧的「正文含『复核』二字即算已复核」启发式移除——agent 笔记
里引用「复核门禁」字样即可自我洗白，判据收敛为上面 a/b/c 三条硬通道。
"""
from __future__ import annotations

import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

VAULT = Path(os.environ.get("TASK_VAULT", Path.home() / "Documents" / "Obsidian Vault"))
TASKS = VAULT / "03 Tasks"
STATE_DB = Path(os.environ.get("TV_STATE_DB", Path.home() / ".hermes" / "state.db"))
AGENT_ACTORS = {"hermes", "cc", "codex"}
REMINDERS_MARK = "Reminders 里勾了完成"
# 执行记录时间戳固定 +08:00（契约 §3）——不随宿主 TZ 漂移
SHANGHAI = timezone(timedelta(hours=8))
# 系统注入的伪 user 消息（非用户亲手输入）不算确认
INJECTED_PREFIXES = ("[ASYNC", "[OUT-OF-BAND")
# 迁移条目行：- 2026-08-22 19:20 · **doing→done** · `hermes`
MIGRATION = re.compile(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*·\s*\*\*(\w+)→(\w+)\*\*\s*·\s*`(\w+)`")
ANY_ENTRY = re.compile(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s")
# 与插件 reviewGate.ts 的 USER_CONFIRM 同源，勿漂移。全行锚定：前后垃圾拒收（审计 R1 闭环）。
# quote 转义：\" → "，\\ → \
USER_CONFIRM = re.compile(
    r'^[ \t]*user-confirm:\s*session=([\w.-]+)\s+msg=(\d+)\s+quote="((?:[^"\\\n]|\\.)+)"[ \t]*$',
    re.M,
)


def unescape_quote(raw: str) -> str:
    """反转义 quote 字段：\\\\ → \\，\\\\" → \\"，其余 \\\\x 保持字面。"""
    out, i = [], 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw) and raw[i + 1] in ('"', "\\"):
            out.append(raw[i + 1])
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


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

    def verify(self, cited: tuple, done_stamp: str) -> tuple:
        """cited = (session, msg_id, raw_quote)。返回 (ok, fail_reason)。"""
        self.fail_reason = ""
        session, msg_id, raw_quote = cited
        quote = unescape_quote(raw_quote)
        if not quote:
            return False, "empty quote"
        con = self._connect()
        if con is None:
            return False, self.fail_reason
        try:
            row = con.execute(
                "SELECT session_id, role, content, timestamp FROM messages WHERE id=?",
                (msg_id,),
            ).fetchone()
        except sqlite3.Error as e:
            return False, f"state db query failed: {e}"
        if row is None:
            return False, f"msg {msg_id} not found"
        db_session, role, content, ts = row
        if db_session != session:
            return False, f"msg {msg_id} session mismatch: {db_session} != {session}"
        if role != "user":
            return False, f"msg {msg_id} role={role}"
        stripped = (content or "").lstrip()
        if any(stripped.startswith(p) for p in INJECTED_PREFIXES):
            return False, f"msg {msg_id} is system-injected"
        if quote not in (content or ""):
            return False, f"msg {msg_id} quote not substring"
        if ts is None:
            return False, f"msg {msg_id} has NULL timestamp"
        try:
            ts = float(ts)
        except (TypeError, ValueError):
            return False, f"msg {msg_id} non-numeric timestamp"
        # done 边固定 Asia/Shanghai，显式挂 +08:00，不随宿主 TZ 漂移
        try:
            done_epoch = datetime.strptime(done_stamp, "%Y-%m-%d %H:%M").replace(
                tzinfo=SHANGHAI
            ).timestamp()
        except ValueError:
            return False, f"bad done stamp {done_stamp}"
        if ts > done_epoch + 60:
            return False, f"msg {msg_id} is later than done edge"
        return True, ""


def confirmations(es, done_idx: int):
    """done 边上或之后的确认证据。es 倒序（新在上），≤ done_idx 即时间上不早于 done。

    与 reviewGate.ts 的 hasUserDoneConfirmation 同源：actor 只认 canonical headline，
    Reminders/citation 认整条 entry；全部限定在本窗口内。"""
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
            done_edge = None  # C2 修复：无 done 边的退化形态同步入审计（不能只信插件放行）
            for idx, (stamp, headline, text) in enumerate(es):
                mm = MIGRATION.match(headline)
                if mm and mm.group(3) == "done":
                    done_edge = (idx, stamp, mm.group(4))
                    break
            if done_edge is None:
                # 无 done 迁移边但 status=done（同步器直改/外部裸写）：整日志窗口，
                # 只认 user actor 与 Reminders 标记——citation 必须锚定 done 边，
                # 无边时不可用（防止复用历史 citation）。
                user_actor = any("`user`" in h for _, h, _ in es)
                reminders = any(REMINDERS_MARK in tx for _, _, tx in es)
                if not (user_actor or reminders):
                    latest = es[0][0] if es else "?"
                    dangers.append((latest, t["title"], "external", "done 无迁移边且无用户确认"))
            else:
                idx, stamp, actor = done_edge
                if actor in AGENT_ACTORS:
                    user_actor, reminders, citations = confirmations(es, idx)
                    if user_actor or reminders:
                        pass
                    elif citations:
                        bad = []
                        for c in citations:
                            ok, reason = checker.verify(c, stamp)
                            if not ok:
                                bad.append(f"msg={c[1]}({reason})")
                        if bad:
                            dangers.append(
                                (stamp, t["title"], actor, "引用核验失败 " + "; ".join(bad))
                            )
                    else:
                        dangers.append((stamp, t["title"], actor, "无用户确认"))
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
    push_failures = []
    if lines:
        report = f"[{now}] " + " | ".join(lines)
        log_path = Path.home() / ".hermes/cache/tv-review-audit.log"
        log_path.parent.mkdir(exist_ok=True)
        with open(log_path, "a") as f:
            f.write(report + "\n")
        # ntfy bot 推送（铁律：Tags 含 bot，只通知不触发订阅器）。
        # 推送失败不中断扫描，但必须可观测：stderr + 审计日志 + 退出码 2。
        msg = "\n".join(lines)
        try:
            r = subprocess.run(
                ["ntfy", "publish", "--tags", "bot,eyes", "tv-guancyxx", "Task复核审计", msg[:1500]],
                capture_output=True, timeout=15, check=False,
            )
            if r.returncode != 0:
                push_failures.append(f"ntfy rc={r.returncode}: {r.stderr.decode(errors='replace')[:120]}")
        except Exception as e:
            push_failures.append(f"ntfy exception: {e}")
        print(report)
    else:
        print(f"[{now}] clean")
    if push_failures:
        for pf in push_failures:
            line = f"[{now}] PUSH FAILED {pf}"
            print(line, file=sys.stderr)
            try:
                log_path = Path.home() / ".hermes/cache/tv-review-audit.log"
                log_path.parent.mkdir(exist_ok=True)
                with open(log_path, "a") as f:
                    f.write(line + "\n")
            except Exception:
                pass
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
