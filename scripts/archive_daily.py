#!/usr/bin/env python3
"""Daily archive (98 archive): move completed tasks into `98 archive/` preserving
the original directory structure.

Source (relative to the vault):
  - `03 Tasks/**` — task files with status done/cancelled

AI-conversation files (`02 Knowledge/AI 对话/**`, `AI/**`) are NOT handled here —
they are cleaned into structured docs and archived by the single owner of all
archiving: the `每日归档任务` agent cron (skill `ai-session-archive`).

Archive root: `98 archive/` (mirrors the source's relative path).

Idempotent + dry-run first. Never touches `03 Tasks/_archive/` or the archive root itself.
"""
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tv_common import read_frontmatter

from tv_common import DEFAULT_VAULT
VAULT = DEFAULT_VAULT
ARCHIVE = VAULT / "98 archive"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report moves without doing them")
    args = ap.parse_args()

    moves: list[tuple[Path, Path]] = []

    # completed tasks (status done/cancelled), preserving project/date structure
    tasks_dir = VAULT / "03 Tasks"
    for f in sorted(tasks_dir.rglob("*.md")):
        rel = f.relative_to(VAULT)
        if rel.parts[0] == "98 archive" or "_archive" in rel.parts:
            continue
        try:
            meta, _ = read_frontmatter(f)
        except Exception:
            continue
        if meta.get("status") in ("done", "cancelled"):
            moves.append((f, ARCHIVE / rel))

    for src, dst in moves:
        if args.dry_run:
            print(f"would-archive {src.relative_to(VAULT)}")
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            print(f"archived {src.relative_to(VAULT)}")

    print(f"archive done: files={len(moves)} mode={'dry-run' if args.dry_run else 'apply'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
