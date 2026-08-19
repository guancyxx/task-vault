#!/usr/bin/env python3
"""Synchronize Task Vault task files with the single Apple Reminders list."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from scripts.tv_common import (
        DEFAULT_VAULT,
        ensure_unique_task_path,
        is_date_only,
        load_config,
        load_ledger,
        local_due_to_remindctl,
        now_shanghai,
        parse_reminders_utc,
        read_frontmatter,
        reminder_alarm_to_remindctl,
        reminders_due_to_local,
        run_hook,
        update_ledger,
        write_frontmatter,
    )
except ModuleNotFoundError:
    from tv_common import (
        DEFAULT_VAULT,
        ensure_unique_task_path,
        is_date_only,
        load_config,
        load_ledger,
        local_due_to_remindctl,
        now_shanghai,
        parse_reminders_utc,
        read_frontmatter,
        reminder_alarm_to_remindctl,
        reminders_due_to_local,
        run_hook,
        update_ledger,
        write_frontmatter,
    )


LIST_NAME = "待办"
TERMINAL_STATUSES = {"done", "cancelled"}


@dataclass
class TaskFile:
    path: Path
    metadata: dict[str, Any]
    body: str


@dataclass
class SyncStats:
    created: int = 0
    rescheduled: int = 0
    completed_reminders: int = 0
    completed_tasks: int = 0
    imported: int = 0
    orphan: int = 0

    @property
    def actions(self) -> int:
        return self.created + self.rescheduled + self.completed_reminders + self.completed_tasks + self.imported


class Remindctl:
    def __init__(self, executable: str, dry_run: bool) -> None:
        self.executable = executable
        self.dry_run = dry_run

    def _run(self, arguments: list[str]) -> Any:
        result = subprocess.run(
            [self.executable, *arguments, "--json", "--no-input"],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(result.stdout) if result.stdout.strip() else None

    def all(self) -> list[dict[str, Any]]:
        result = self._run(["show", "all", "--list", LIST_NAME])
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            for key in ("reminders", "items", "results"):
                if isinstance(result.get(key), list):
                    return result[key]
        raise ValueError("unexpected remindctl JSON list response")

    def add(self, task: dict[str, Any], due_arguments: list[str]) -> dict[str, Any] | None:
        if self.dry_run:
            return None
        arguments = [
            "add",
            "--title",
            str(task["title"]),
            "--list",
            LIST_NAME,
            "--notes",
            f"task-vault-id:{task['id']}",
            "--priority",
            # remindctl vocabulary is none|low|medium|high — map our high|normal|low onto it
            {"high": "high", "normal": "medium", "low": "low"}.get(
                str(task.get("priority", "normal")), "none"
            ),
            *due_arguments,
        ]
        result = self._run(arguments)
        if isinstance(result, dict) and isinstance(result.get("reminder"), dict):
            return result["reminder"]
        return result if isinstance(result, dict) else None

    def reschedule(self, reminder_id: str, due_arguments: list[str]) -> None:
        if not self.dry_run:
            self._run(["edit", reminder_id, *due_arguments])

    def complete(self, reminder_id: str) -> None:
        if not self.dry_run:
            self._run(["complete", reminder_id])

    def retitle(self, reminder_id: str, title: str) -> None:
        if not self.dry_run:
            self._run(["edit", reminder_id, "--title", title])


def _reminder_id(reminder: dict[str, Any]) -> str:
    for key in ("id", "identifier", "uuid"):
        if reminder.get(key):
            return str(reminder[key])
    raise ValueError("reminder is missing a full identifier")


def _reminder_completed(reminder: dict[str, Any]) -> bool:
    return bool(reminder.get("isCompleted", reminder.get("completed", False)))


def _reminder_due(reminder: dict[str, Any]) -> str | None:
    value = reminder.get("dueDate", reminder.get("due"))
    return str(value) if value else None


def _reminder_all_day(reminder: dict[str, Any]) -> bool:
    # remindctl (live-verified 2026-08-19) serializes the flag as "dueDateIsAllDay"
    return bool(reminder.get("dueDateIsAllDay", reminder.get("isAllDay", reminder.get("allDay", False))))


def _linked_task_id(reminder: dict[str, Any]) -> str | None:
    match = re.search(r"(?:^|\n)task-vault-id:([^\s]+)", str(reminder.get("notes", "")))
    return match.group(1) if match else None


def _due_arguments(due: str, allday_time: str, remind: str | None = None) -> list[str]:
    alarm = reminder_alarm_to_remindctl(due, remind, allday_time)
    if is_date_only(due):
        return ["--due", due, "--alarm", alarm]
    return ["--due", alarm, "--alarm", alarm]


def _due_matches(task_due: str, reminder: dict[str, Any], allday_time: str, remind: str | None = None) -> bool:
    reminder_due = _reminder_due(reminder)
    if not reminder_due:
        return False
    reminder_alarm = reminder.get("alarmDate", reminder.get("alarm"))
    expected_alarm = reminder_alarm_to_remindctl(task_due, remind, allday_time)
    if reminder_alarm and parse_reminders_utc(str(reminder_alarm)).strftime("%Y-%m-%dT%H:%M:%SZ") != expected_alarm:
        return False
    if is_date_only(task_due):
        return _reminder_all_day(reminder) and reminders_due_to_local(reminder_due).date().isoformat() == task_due
    expected = local_due_to_remindctl(task_due, allday_time)
    actual = parse_reminders_utc(reminder_due).strftime("%Y-%m-%dT%H:%M:%SZ")
    return not _reminder_all_day(reminder) and actual == expected


def _read_tasks(tasks_dir: Path) -> list[TaskFile]:
    tasks: list[TaskFile] = []
    # Two-level layout `03 Tasks/<project>/<YYYY-MM>/*.md` plus legacy flat files:
    # any .md under tasks_dir except _archive (rglob), one pass, deduped by path.
    for path in sorted(tasks_dir.rglob("*.md")):
        if "_archive" in path.relative_to(tasks_dir).parts:
            continue
        try:
            metadata, body = read_frontmatter(path)
        except (ValueError, OSError) as error:
            print(f"invalid-task {path.name}: {error}")
            continue
        if metadata.get("id") and metadata.get("title") and metadata.get("status"):
            tasks.append(TaskFile(path, metadata, body))
    return tasks


def _replace_task(task: TaskFile, mutate: Any) -> None:
    metadata, body = read_frontmatter(task.path)  # Reread immediately before every write.
    mutate(metadata)
    write_frontmatter(task.path, metadata, body)
    task.metadata, task.body = read_frontmatter(task.path)


def _record_transition(body: str, old: str, new: str, timestamp: datetime) -> str:
    """迁移条目写进执行记录区的最前面（2026-08-19 起倒序：最新在上）。"""
    # 排版同 executionLog.ts：元信息在项目符号行，正文缩进两格。
    entry = (
        f"- {timestamp.strftime('%Y-%m-%d %H:%M')} · **{old}→{new}** · `codex`\n"
        "  Reminders 里勾了完成，同步器落的状态\n"
    )
    heading = "## 执行记录"
    if heading not in body:
        separator = "" if not body or body.endswith("\n") else "\n"
        return body + separator + f"\n{heading}\n\n" + entry
    start = body.index(heading) + len(heading)
    rest = body[start:].lstrip("\n")
    return body[:start] + "\n" + entry + ("\n" + rest if rest else "")


def _complete_task_from_reminder(task: TaskFile, timestamp: datetime, dry_run: bool) -> bool:
    if task.metadata.get("status") in TERMINAL_STATUSES:
        return False
    if dry_run:
        return True
    metadata, body = read_frontmatter(task.path)
    old_status = str(metadata["status"])
    metadata["status"] = "done"
    metadata["completed"] = timestamp.strftime("%Y-%m-%dT%H:%M")
    body = _record_transition(body, old_status, "done", timestamp)
    write_frontmatter(task.path, metadata, body)
    task.metadata, task.body = read_frontmatter(task.path)
    return True


def _ensure_terminal_hook(vault: Path, task: TaskFile, config: dict[str, Any], timestamp: datetime, dry_run: bool) -> None:
    command = str(config.get("terminal_hook", ""))
    if not command.strip() or dry_run:
        return
    ledger = load_ledger(vault)
    task_id = str(task.metadata["id"])
    if task_id in ledger["terminal"]:
        return
    run_hook(command, task.path, task.metadata)
    update_ledger(
        vault,
        lambda latest: latest["terminal"].setdefault(
            task_id,
            {"status": str(task.metadata["status"]), "fired_at": timestamp.isoformat()},
        ),
    )


def _import_siri(tasks_dir: Path, reminder: dict[str, Any], timestamp: datetime, dry_run: bool) -> Path | None:
    title = str(reminder.get("title") or "Untitled reminder")
    created = timestamp.date().isoformat()
    target = ensure_unique_task_path(tasks_dir, created, title)
    if dry_run:
        return target
    metadata: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "title": title,
        "status": "inbox",
        "created": timestamp.strftime("%Y-%m-%dT%H:%M"),
        "priority": "normal",
        "source": "siri",
        "assignee": "user",
        "mirror": {"reminders-uuid": _reminder_id(reminder)},
    }
    due = _reminder_due(reminder)
    if due:
        local = reminders_due_to_local(due)
        metadata["due"] = local.date().isoformat() if _reminder_all_day(reminder) else local.strftime("%Y-%m-%dT%H:%M")
    write_frontmatter(target, metadata, "")
    return target


def synchronize(vault: Path, executable: str, dry_run: bool) -> SyncStats:
    tasks_dir = vault / "03 Tasks"
    if not tasks_dir.is_dir():
        raise FileNotFoundError(f"tasks directory does not exist: {tasks_dir}")
    timestamp = now_shanghai()
    config = load_config(vault)
    allday_time = str(config["default_remind"]["allday"])
    client = Remindctl(executable, dry_run)
    reminders = client.all()
    reminders_by_id = {_reminder_id(item): item for item in reminders}
    tasks = _read_tasks(tasks_dir)
    tasks_by_id = {str(task.metadata["id"]): task for task in tasks}
    mirrored_reminder_ids: set[str] = set()
    stats = SyncStats()

    for task in tasks:
        mirror = task.metadata.get("mirror") or {}
        reminder_id = mirror.get("reminders-uuid") if isinstance(mirror, dict) else None
        if reminder_id:
            reminder_id = str(reminder_id)
            mirrored_reminder_ids.add(reminder_id)
            reminder = reminders_by_id.get(reminder_id)
            if reminder is None:
                stats.orphan += 1
                print(f"orphan task={task.metadata['id']} reminder={reminder_id}")
                continue
            if _reminder_completed(reminder):
                changed = _complete_task_from_reminder(task, timestamp, dry_run)
                if changed:
                    stats.completed_tasks += 1
                    print(f"{'would-complete-task' if dry_run else 'completed-task'} {task.path.name}")
                if not dry_run and task.metadata.get("status") == "done":
                    _ensure_terminal_hook(vault, task, config, timestamp, dry_run)
                continue
            if task.metadata.get("status") in TERMINAL_STATUSES:
                client.complete(reminder_id)  # Full UUID is intentionally never shortened.
                stats.completed_reminders += 1
                print(f"{'would-complete-reminder' if dry_run else 'completed-reminder'} {reminder_id}")
                continue
            title = str(task.metadata.get("title", ""))
            if title and str(reminder.get("title", "")) != title:
                client.retitle(reminder_id, title)
                stats.rescheduled += 1
                print(f"{'would-retitle' if dry_run else 'retitled'} {reminder_id}")
            due = task.metadata.get("due")
            if due and not _due_matches(str(due), reminder, allday_time, task.metadata.get("remind")):
                client.reschedule(reminder_id, _due_arguments(str(due), allday_time, task.metadata.get("remind")))
                stats.rescheduled += 1
                print(f"{'would-reschedule' if dry_run else 'rescheduled'} {reminder_id}")
            continue

        due = task.metadata.get("due")
        if task.metadata.get("status") not in TERMINAL_STATUSES and due:
            print(f"{'would-create' if dry_run else 'creating'} {task.path.name}")
            created = client.add(task.metadata, _due_arguments(str(due), allday_time, task.metadata.get("remind")))
            stats.created += 1
            if created is not None:
                created_id = _reminder_id(created)
                _replace_task(task, lambda metadata: metadata.__setitem__("mirror", {"reminders-uuid": created_id}))
                mirrored_reminder_ids.add(created_id)

    for reminder in reminders:
        reminder_id = _reminder_id(reminder)
        linked_id = _linked_task_id(reminder)
        if linked_id and linked_id not in tasks_by_id:
            stats.orphan += 1
            print(f"orphan reminder={reminder_id} task={linked_id}")
            continue
        if reminder_id in mirrored_reminder_ids or linked_id or _reminder_completed(reminder):
            continue
        target = _import_siri(tasks_dir, reminder, timestamp, dry_run)
        stats.imported += 1
        print(f"{'would-import' if dry_run else 'imported'} {reminder_id} -> {target.name if target else ''}")

    if not dry_run:
        update_ledger(vault, lambda ledger: ledger["sync"].update({"last_run": timestamp.isoformat()}))
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--remindctl", default="remindctl")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    stats = synchronize(arguments.vault, arguments.remindctl, arguments.dry_run)
    print(
        "sync done: "
        f"actions={stats.actions} created={stats.created} rescheduled={stats.rescheduled} "
        f"reminders-completed={stats.completed_reminders} tasks-completed={stats.completed_tasks} "
        f"imported={stats.imported} orphan={stats.orphan} mode={'dry-run' if arguments.dry_run else 'apply'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
