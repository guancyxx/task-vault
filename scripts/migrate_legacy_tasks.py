#!/usr/bin/env python3
"""Migrate legacy Markdown task lines into one-file-per-task Task Vault files."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from scripts.tv_common import DEFAULT_VAULT, ensure_unique_task_path, write_frontmatter
except ModuleNotFoundError:
    from tv_common import DEFAULT_VAULT, ensure_unique_task_path, write_frontmatter


TASK_LINE = re.compile(r"^\s*- \[([ xX])\]\s+(.+?)\s*$")
DATE_MARKERS = {"📅": "due", "✅": "completed", "🛫": "start", "➕": "created"}
PRIORITIES = {"🔺": "high", "⏫": "high", "🔼": "normal", "🔽": "low", "⏬": "low"}
KNOWN_PROJECTS = {"Task Vault"}


@dataclass(frozen=True)
class MigratedTask:
    source: Path
    line_number: int
    frontmatter: dict[str, Any]
    body: str
    doubts: list[str]


def _file_date(path: Path) -> str:
    match = re.search(r"(\d{4}-\d{2}-\d{2})", path.stem)
    if match:
        return match.group(1)
    return datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()


def _strip_pattern(text: str, pattern: str) -> tuple[str, list[str]]:
    values = re.findall(pattern, text)
    return re.sub(pattern, " ", text), values


def parse_legacy_line(path: Path, line_number: int, line: str) -> MigratedTask | None:
    match = TASK_LINE.match(line)
    if not match or match.group(1).lower() == "x":
        return None
    text = match.group(2)
    fields: dict[str, Any] = {}
    for marker, field in DATE_MARKERS.items():
        marker_match = re.search(re.escape(marker) + r"\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?)", text)
        if marker_match:
            fields[field] = marker_match.group(1)
            text = text[: marker_match.start()] + " " + text[marker_match.end() :]
    priority = "normal"
    for marker, value in PRIORITIES.items():
        if marker in text:
            priority = value
            text = text.replace(marker, " ")
            break
    text, comments = _strip_pattern(text, r"<!--\s*(.*?)\s*-->")
    text, sources = _strip_pattern(text, r"#src/([\w-]+)")
    hermes = bool(re.search(r"(?<![\w/])#hermes\b", text))
    text = re.sub(r"(?<![\w/])#hermes\b", " ", text)
    text, repos = _strip_pattern(text, r"#repo/([\w.-]+)")
    text, links = _strip_pattern(text, r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
    doubts: list[str] = []
    project: str | None = None
    area: str | None = None
    tags = [f"repo/{repo}" for repo in repos]
    for link in links:
        if link in KNOWN_PROJECTS or "project" in link.lower():
            project = project or link
        elif "area" in link.lower():
            area = area or link
        else:
            tags.append(link)
            doubts.append(f"wikilink:{link}")
    title = re.sub(r"\s+", " ", text).strip(" -")
    if not title:
        doubts.append("empty-title")
        title = "Untitled legacy task"
    created = fields.get("created", _file_date(path))
    frontmatter: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "title": title,
        "status": "todo",
    }
    for key in ("start", "due"):
        if key in fields:
            frontmatter[key] = fields[key]
    frontmatter.update(
        {
            "created": created,
            "priority": priority,
            "source": sources[0] if sources else "user",
            "assignee": "hermes" if hermes else "user",
        }
    )
    if project:
        frontmatter["project"] = project
    if area:
        frontmatter["area"] = area
    if tags:
        frontmatter["tags"] = tags
    body = ""
    if comments:
        created_time = created[:10] + " 00:00"
        body = "\n## 执行记录\n\n" + "\n".join(f"- {created_time} [user] {comment}" for comment in comments) + "\n"
    return MigratedTask(path, line_number, frontmatter, body, doubts)


def parse_legacy_file(path: Path) -> list[MigratedTask]:
    return [
        parsed
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if (parsed := parse_legacy_line(path, number, line)) is not None
    ]


def discover_source_files(tasks_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in tasks_dir.glob("*.md")
        if any(TASK_LINE.match(line) for line in path.read_text(encoding="utf-8").splitlines())
    )


def archive_source(path: Path, archive_dir: Path) -> None:
    archive_dir.mkdir(parents=True, exist_ok=True)
    destination = archive_dir / path.name
    if destination.exists():
        raise FileExistsError(f"archive is read-only and destination exists: {destination}")
    source_bytes = path.read_bytes()
    shutil.copyfile(path, destination)
    if hashlib.sha256(destination.read_bytes()).digest() != hashlib.sha256(source_bytes).digest():
        destination.unlink()
        raise OSError(f"archive byte verification failed: {path}")
    path.unlink()


def run(tasks_dir: Path, apply: bool) -> int:
    sources = discover_source_files(tasks_dir)
    migrated = 0
    for source in sources:
        tasks = parse_legacy_file(source)
        reserved: set[Path] = set()
        for task in tasks:
            created_date = str(task.frontmatter["created"])[:10]
            target = ensure_unique_task_path(tasks_dir, created_date, str(task.frontmatter["title"]))
            while target in reserved:
                stem, suffix = target.stem, 2
                match = re.match(r"^(.*?)-(\d+)$", stem)
                if match:
                    stem, suffix = match.group(1), int(match.group(2)) + 1
                target = target.with_name(f"{stem}-{suffix}.md")
            reserved.add(target)
            details = {key: value for key, value in task.frontmatter.items() if key != "id"}
            doubt_text = ", ".join(task.doubts) if task.doubts else "无"
            print(f"{source.name}:{task.line_number} -> {target.name} fields={details} 疑点={doubt_text}")
            if apply:
                write_frontmatter(target, task.frontmatter, task.body)
            migrated += 1
        if apply:
            archive_source(source, tasks_dir / "_archive")
    print(f"migration done: tasks={migrated} archived={len(sources) if apply else 0} mode={'apply' if apply else 'dry-run'}")
    return migrated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks-dir", type=Path, default=DEFAULT_VAULT / "03 Tasks")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    if not arguments.tasks_dir.is_dir():
        parser.error(f"tasks directory does not exist: {arguments.tasks_dir}")
    run(arguments.tasks_dir, arguments.apply)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
