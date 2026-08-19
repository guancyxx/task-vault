#!/usr/bin/env python3
"""Shared filesystem, hook, slug, and time helpers for Task Vault scripts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import yaml


SHANGHAI = timezone(timedelta(hours=8))
UTC = timezone.utc
# Vault root resolution: TASK_VAULT env var wins, then ~/Documents/Obsidian Vault.
# No absolute personal paths — keep the repo portable.
DEFAULT_VAULT = Path(os.environ.get("TASK_VAULT", Path.home() / "Documents" / "Obsidian Vault"))
DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "terminal_hook": "",
    "dispatch_hook": "",
    "default_remind": {"allday": "09:00", "timed": "due"},
    "backstop_minutes": 30,
}
DEFAULT_LEDGER: dict[str, Any] = {
    "version": 1,
    "terminal": {},
    "dispatch": {},
    "sync": {},
}


def _normalise_yaml(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat(timespec="minutes") if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, dict):
        return {str(key): _normalise_yaml(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalise_yaml(item) for item in value]
    return value


def read_frontmatter(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", text, re.DOTALL)
    if not match:
        raise ValueError(f"missing YAML frontmatter: {path}")
    loaded = yaml.safe_load(match.group(1)) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"frontmatter must be a mapping: {path}")
    return _normalise_yaml(loaded), text[match.end() :]


def _serialise_frontmatter(frontmatter: dict[str, Any], body: str) -> str:
    yaml_text = yaml.safe_dump(
        frontmatter,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    ).rstrip()
    return f"---\n{yaml_text}\n---\n{body}"


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_frontmatter(path: Path, frontmatter: dict[str, Any], body: str) -> None:
    original_id: str | None = None
    if path.exists():
        current, _ = read_frontmatter(path)
        original_id = current.get("id")
    if original_id is not None and frontmatter.get("id") != original_id:
        raise ValueError(f"task id is immutable: {path}")
    expected = _normalise_yaml(frontmatter)
    atomic_write_bytes(path, _serialise_frontmatter(expected, body).encode("utf-8"))
    verified, verified_body = read_frontmatter(path)
    if verified != expected or verified_body != body:
        raise OSError(f"frontmatter write verification failed: {path}")


def _read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return deepcopy(default)
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict) or loaded.get("version") != 1:
        raise ValueError(f"unsupported JSON contract: {path}")
    return loaded


def load_config(vault: Path) -> dict[str, Any]:
    config = deepcopy(DEFAULT_CONFIG)
    loaded = _read_json(vault / ".taskvault" / "config.json", DEFAULT_CONFIG)
    config.update(loaded)
    config["default_remind"] = {**DEFAULT_CONFIG["default_remind"], **loaded.get("default_remind", {})}
    return config


def load_ledger(vault: Path) -> dict[str, Any]:
    ledger = _read_json(vault / ".taskvault" / "ledger.json", DEFAULT_LEDGER)
    for key in ("terminal", "dispatch", "sync"):
        ledger.setdefault(key, {})
    return ledger


def update_ledger(vault: Path, mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    path = vault / ".taskvault" / "ledger.json"
    ledger = load_ledger(vault)  # Required reread immediately before mutation/write.
    mutate(ledger)
    atomic_write_bytes(path, (json.dumps(ledger, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    verified = load_ledger(vault)
    if verified != ledger:
        raise OSError(f"ledger write verification failed: {path}")
    return verified


def run_hook(command_template: str, task_path: Path, task: dict[str, Any], instruction: str = "") -> None:
    if not command_template.strip():
        return
    values = {
        "TASK_PATH": str(task_path),
        "TASK_ID": str(task.get("id", "")),
        "TASK_STATUS": str(task.get("status", "")),
        "TASK_TITLE": str(task.get("title", "")),
        "TASK_ASSIGNEE": str(task.get("assignee", "")),
        "TASK_INSTRUCTION": instruction,
    }
    command = command_template
    for name, value in values.items():
        command = command.replace("{" + name + "}", value)
    environment = os.environ.copy()
    environment.update({f"TV_{name}": value for name, value in values.items()})
    subprocess.run(command, shell=True, check=True, env=environment)


def slugify(title: str) -> str:
    slug = re.sub(r"\s+", "-", title.lower())
    slug = re.sub(r"[^a-z0-9\u4e00-\u9fff-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")[:50].rstrip("-")
    return slug or "task"


def ensure_unique_task_path(tasks_dir: Path, created_date: str, title: str) -> Path:
    # Siri imports have no project → `_未分类/<YYYY-MM-DD>/<slug>.md` (2026-08-19: day folder,
    # date lives in the folder name, not the filename/title).
    folder = tasks_dir / "_未分类" / created_date
    stem = slugify(title)
    candidate = folder / f"{stem}.md"
    suffix = 2
    while candidate.exists():
        candidate = folder / f"{stem}-{suffix}.md"
        suffix += 1
    return candidate


def is_date_only(value: str) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value))


def parse_local_due(value: str, allday_time: str = "09:00") -> datetime:
    if is_date_only(value):
        return datetime.combine(date.fromisoformat(value), time.fromisoformat(allday_time), SHANGHAI)
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=SHANGHAI) if parsed.tzinfo is None else parsed.astimezone(SHANGHAI)


def local_due_to_remindctl(value: str, allday_time: str = "09:00") -> str:
    utc_value = parse_local_due(value, allday_time).astimezone(UTC)
    return utc_value.strftime("%Y-%m-%dT%H:%M:%SZ")


def reminder_alarm_to_remindctl(value: str, remind: str | None, allday_time: str = "09:00") -> str:
    moment = parse_local_due(value, allday_time)
    if remind and remind != "due":
        match = re.fullmatch(r"(\d+)([mhd])", remind)
        if not match:
            raise ValueError(f"invalid remind offset: {remind}")
        amount = int(match.group(1))
        unit = {"m": "minutes", "h": "hours", "d": "days"}[match.group(2)]
        moment -= timedelta(**{unit: amount})
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_reminders_utc(value: str) -> datetime:
    normalised = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalised)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def reminders_due_to_local(value: str) -> datetime:
    return parse_reminders_utc(value).astimezone(SHANGHAI)


def reminders_due_to_local_date(value: str) -> date:
    return reminders_due_to_local(value).date()


def now_shanghai() -> datetime:
    return datetime.now(SHANGHAI).replace(microsecond=0)
