#!/usr/bin/env python3
"""兜底派发 cron（contracts §9）。

委派时插件 fire 一次 dispatch hook。hook 没配、Obsidian 没开、终端起失败——任何一种，
任务就静静躺在那里 assignee 有值、没人干活。这个脚本是那一层保险：扫描所有任务，
把「派出去但没人接单」的重新 fire 一次。

判据：（frontmatter 有 dispatched ∨ #auto）∧ assignee ∉ {空, user} ∧ status = todo
      ∧ 距上次派发 > backstop_minutes ∧ 执行记录里上次派发之后没有「接单」记录。

无 dispatched 的普通任务仍不派发，避免把默认归属误判为委派；显式 #auto 是唯一例外。
"""

from __future__ import annotations

import argparse
import fcntl
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.tv_common import (  # noqa: E402
    DEFAULT_VAULT,
    SHANGHAI,
    load_config,
    load_ledger,
    now_shanghai,
    read_frontmatter,
    run_hook,
    update_ledger,
    write_frontmatter,
)

# ponytail: 三次还没人接单就不再开窗口——再派也是同一个坏原因（hook 配错/终端起不来），
# 每 5 分钟弹一个终端比不派更糟。人工处理后 `--force` 重新起。
MAX_ATTEMPTS = 3
# ponytail: 单轮最多派 3 个。hook 再坏一次时，坏的是「一批任务同时超时」，而每次派发
# 都会弹一个终端窗口。要一次性清空积压就手动跑几轮或 --force。
MAX_PER_RUN = 3
LOG_ENTRY = re.compile(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s")


def _parse_stamp(value: str) -> datetime | None:
    """`dispatched`（本地 ISO 分钟）或执行记录行的时间戳 → aware datetime。"""
    try:
        parsed = datetime.fromisoformat(value.strip().replace(" ", "T", 1))
    except ValueError:
        return None
    return parsed.replace(tzinfo=SHANGHAI) if parsed.tzinfo is None else parsed.astimezone(SHANGHAI)


def section(body: str, heading: str) -> str:
    """取 `## X` 区正文（到下一个 `## ` 为止）。缺区返回空串。"""
    if heading not in body:
        return ""
    rest = body[body.index(heading) + len(heading) :]
    nxt = re.search(r"^##\s+", rest, re.MULTILINE)
    return (rest[: nxt.start()] if nxt else rest).strip()


def _entries(body: str) -> list[tuple[datetime | None, str]]:
    """执行记录 → [(时间戳, 整条正文)]。一条 = 以 `- <时间戳>` 开头的行 + 其后的缩进续行
    （2026-08-19 起正文写在缩进续行上）。老的单行格式照样是一条，续行为空。"""
    out: list[tuple[datetime | None, list[str]]] = []
    for line in section(body, "## 执行记录").splitlines():
        match = LOG_ENTRY.match(line.strip())
        if match:
            out.append((_parse_stamp(match.group(1)), [line]))
        elif out and line.strip():
            out[-1][1].append(line)  # 续行归属上一条；孤立行（没有表头）直接丢弃
    return [(ts, "\n".join(lines)) for ts, lines in out]


def accepted_after(body: str, since: datetime | None) -> bool:
    """执行记录里 since 之后有「接单」记录？since 为 None 时任意接单记录都算。"""
    for stamp, text in _entries(body):
        if "接单" not in text:
            continue
        if since is None or (stamp is not None and stamp >= since):
            return True
    return False


def needs_redispatch(
    metadata: dict[str, Any], body: str, ledger: dict[str, Any], now: datetime, threshold_minutes: int
) -> bool:
    assignee = str(metadata.get("assignee") or "").strip()
    if assignee in ("", "user"):
        return False
    if metadata.get("status") != "todo":
        return False

    tags = metadata.get("tags") or []
    is_auto = "auto" in tags if isinstance(tags, list) else False

    # 委派证据通常是 delegate() 写的 dispatched；显式 #auto 是唯一允许在没有该字段时
    # 自动首派的入口。普通默认 assignee 仍不得触发 agent。
    dispatched = _parse_stamp(str(metadata.get("dispatched") or ""))
    if dispatched is None and not is_auto:
        return False

    entry = ledger.get("dispatch", {}).get(str(metadata.get("id", "")), {})
    if int(entry.get("count", 0)) >= MAX_ATTEMPTS:
        return False

    if dispatched is None:
        return not accepted_after(body, None)

    # 上次派发 = dispatched 与 ledger last_at 里更晚的那个。只看 dispatched 会让补派
    # 自己变成风暴：补派不写 dispatched（禁令），下一 tick 又满足条件。
    last_at = _parse_stamp(str(entry.get("last_at") or ""))
    last = max(s for s in (dispatched, last_at) if s)

    if accepted_after(body, last):
        return False
    return now - last > timedelta(minutes=threshold_minutes)


def _iter_tasks(tasks_dir: Path):
    for path in sorted(tasks_dir.rglob("*.md")):
        if "_archive" in path.relative_to(tasks_dir).parts:
            continue
        try:
            metadata, body = read_frontmatter(path)
        except (ValueError, OSError):
            continue
        if metadata.get("id") and metadata.get("title") and metadata.get("status"):
            yield path, metadata, body


def dispatch(
    vault: Path,
    path: Path,
    hook: str,
    dry_run: bool,
    threshold_minutes: int,
    *,
    force: bool = False,
) -> bool:
    """Atomically claim and dispatch one task; return whether a hook was/would be fired.

    The cross-process lock deliberately covers the last reread, full eligibility check,
    attempt reservation, optional #auto frontmatter claim, and hook invocation. A failed
    hook consumes its reserved attempt, preventing concurrent cron processes from racing.
    """
    lock_path = vault / ".tv-dispatch.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        metadata, body = read_frontmatter(path)
        claim_now = now_shanghai()
        current_ledger = load_ledger(vault)
        if not force and not needs_redispatch(metadata, body, current_ledger, claim_now, threshold_minutes):
            return False

        instruction = section(body, "## 委派")
        if dry_run:
            print(f"would-dispatch {metadata['title']} → {metadata.get('assignee')}")
            return True

        task_id = str(metadata["id"])
        claim_stamp = claim_now.isoformat(timespec="seconds")

        # Reserve before invoking the hook. update_ledger rereads while the dispatch lock is
        # held, so another backstop cannot pass the same eligibility/count check.
        def reserve(ledger: dict[str, Any]) -> None:
            previous = int(ledger["dispatch"].get(task_id, {}).get("count", 0))
            ledger["dispatch"][task_id] = {"count": previous + 1, "last_at": claim_stamp}

        update_ledger(vault, reserve)

        tags = metadata.get("tags") or []
        if isinstance(tags, list) and "auto" in tags and not metadata.get("dispatched"):
            # Use only the just-reread metadata/body as the write source and mutate one field.
            metadata["dispatched"] = claim_stamp
            write_frontmatter(path, metadata, body)
            metadata, body = read_frontmatter(path)  # verified source passed to the hook
            instruction = section(body, "## 委派")

        run_hook(hook, path, metadata, instruction)
        print(f"dispatched {metadata['title']} → {metadata.get('assignee')}")
        return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", type=Path, help="无视判据，立刻派发这一个任务文件（人工重试用）")
    args = parser.parse_args()

    config = load_config(args.vault)
    hook = str(config.get("dispatch_hook", ""))
    if not hook.strip():
        print("dispatch_hook 未配置——兜底派发无事可做（设置 → Task Vault → 派发 hook）")
        return 1

    if args.force:
        path = args.force if args.force.is_absolute() else args.vault / args.force
        dispatch(args.vault, path, hook, args.dry_run, int(config.get("backstop_minutes", 30)), force=True)
        return 0

    now = now_shanghai()
    ledger = load_ledger(args.vault)
    threshold = int(config.get("backstop_minutes", 30))
    actions = 0
    for path, metadata, body in _iter_tasks(args.vault / "03 Tasks"):
        if needs_redispatch(metadata, body, ledger, now, threshold):
            if actions >= MAX_PER_RUN:
                print(f"capped at {MAX_PER_RUN}/run, still eligible: {metadata['title']}")
                continue
            if dispatch(args.vault, path, hook, args.dry_run, threshold):
                ledger = load_ledger(args.vault)  # 重读：dispatch 刚写过 ledger
                actions += 1
    print(f"actions={actions}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
