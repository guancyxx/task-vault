#!/usr/bin/env python3
"""Daily archive (98 archive): move completed tasks into `98 archive/` preserving
the original directory structure.

Source (relative to the vault):
  - `03 Tasks/**` — task files with status done/cancelled

AI-conversation files (`02 Knowledge/AI 对话/**`, `AI/**`) are NOT handled here —
they are cleaned into structured docs and archived by the single owner of all
archiving: the `每日归档任务` agent cron (skill `ai-session-archive`).

Archive root: `98 archive/` (mirrors the source's relative path).

Mirror cleanup (T023 root-cause fix, FR-023/FR-026): when archiving a terminal
task that still carries a `mirror.reminders-uuid`, delete the mirrored reminder
(`remindctl delete <FULL-UUID> --force`) and strip the mirror block from the
file before it moves into the archive. Delete failures never block archiving.
Already-archived files are never touched retroactively.

Idempotent + dry-run first. Never touches `03 Tasks/_archive/` or the archive root itself.

Move-time reread (audit N3 fast-follow): every candidate is reread immediately
before its mirror delete/move. A file that left the terminal state (concurrent
writer revived/edited it) or became unreadable is skipped, counted as
`skipped=` in the summary, and left in place — the TOCTOU window between the
scan pass and the move loop is closed.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tv_common import read_frontmatter, write_frontmatter

from tv_common import DEFAULT_VAULT
VAULT = DEFAULT_VAULT
ARCHIVE = VAULT / "98 archive"

DELETE_TIMEOUT_SECONDS = 30


def _delete_mirror(remindctl: str, reminder_id: str) -> tuple[bool, str]:
    """Delete a mirrored reminder. Returns (ok, stderr_summary).

    Never raises — a failed delete must not block archiving. The reminder then
    surfaces as an orphan in the next reminders_sync dry-run report.
    """
    try:
        result = subprocess.run(
            [remindctl, "delete", reminder_id, "--force", "--json", "--no-input"],
            check=False,  # deliberate: deletion failure must not abort the archive run
            capture_output=True,
            text=True,
            timeout=DELETE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if result.returncode != 0:
        return False, (result.stderr or result.stdout or "").strip().replace("\n", " ")[:200]
    return True, ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report moves without doing them")
    ap.add_argument("--remindctl", default="remindctl", help="remindctl executable (test injection)")
    args = ap.parse_args()

    moves: list[tuple[Path, Path, tuple[dict, str]]] = []
    mirrors_deleted = 0
    mirrors_failed = 0
    skipped = 0

    # completed tasks (status done/cancelled), preserving project/date structure
    tasks_dir = VAULT / "03 Tasks"
    for f in sorted(tasks_dir.rglob("*.md")):
        rel = f.relative_to(VAULT)
        if rel.parts[0] == "98 archive" or "_archive" in rel.parts:
            continue
        try:
            meta, body = read_frontmatter(f)
        except Exception:
            continue
        if meta.get("status") in ("done", "cancelled"):
            moves.append((f, ARCHIVE / rel, (meta, body)))

    for src, dst, (meta, body) in moves:
        # N3 (audit fast-follow): reread the file right before touching it.
        # The scan pass read (meta, body) up to a full vault traversal earlier;
        # a concurrent writer (syncer/plugin) may have changed the file since.
        # Terminal status is the archive precondition — if it no longer holds,
        # or the file became unreadable, skip the move entirely.
        try:
            meta, body = read_frontmatter(src)
        except Exception as error:
            skipped += 1
            print(f"archive-skip-unreadable {src.relative_to(VAULT)} {str(error)[:120]}")
            continue
        if meta.get("status") not in ("done", "cancelled"):
            skipped += 1
            print(f"archive-skip-not-terminal {src.relative_to(VAULT)} status={meta.get('status')!r}")
            continue
        task_id = str(meta.get("id", src.stem))
        mirror = meta.get("mirror")
        reminder_id = str(mirror.get("reminders-uuid", "")).strip() if isinstance(mirror, dict) else ""
        strip_mirror = False
        if reminder_id:
            if args.dry_run:
                print(f"would-delete-mirror {reminder_id}")
                strip_mirror = True  # reported only; nothing is written in dry-run
            else:
                ok, error = _delete_mirror(args.remindctl, reminder_id)
                if ok:
                    mirrors_deleted += 1
                    print(f"mirror-deleted {task_id} {reminder_id}")
                    strip_mirror = True
                else:
                    mirrors_failed += 1
                    # watchdog tv-archive.sh floats on stdout lines
                    print(f"mirror-delete-failed {task_id} {reminder_id} {error}")
        if args.dry_run:
            print(f"would-archive {src.relative_to(VAULT)}")
        else:
            if strip_mirror:
                meta.pop("mirror", None)  # terminal + archived: mirror link is severed
                write_frontmatter(src, meta, body)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            print(f"archived {src.relative_to(VAULT)}")

    # files= counts what actually moved (or would move in dry-run): candidates skipped
    # by the move-time reread are excluded so the number stays truthful.
    print(
        f"archive done: files={len(moves) - skipped} mode={'dry-run' if args.dry_run else 'apply'}"
        f" mirrors-deleted={mirrors_deleted} mirrors-failed={mirrors_failed} skipped={skipped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
