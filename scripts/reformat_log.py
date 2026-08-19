#!/usr/bin/env python3
"""把存量 `## 执行记录` 改成 2026-08-19 的块排版 + 倒序（用户要求：更简洁大气、便于复核）。

    旧: - 2026-08-19 17:52 [hermes] [调研] 很长的一段正文……
    新: - 2026-08-19 17:52 · **调研** · `hermes`
          很长的一段正文……

只重排 `## 执行记录` 区，其他区、frontmatter 逐字节保留；`_archive/` 只读，不进。
已经是新格式的条目原样跳过、排序用稳定降序，所以脚本可重复跑。默认 --dry-run，加 --apply 才落盘。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.tv_common import DEFAULT_VAULT, atomic_write_bytes  # noqa: E402

HEADING = "## 执行记录"
# 旧格式：`- <时间戳> [actor] [tag] 正文`（tag 可缺）
OLD_ENTRY = re.compile(
    r"^-\s+(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+\[(?P<actor>[^\]]+)\](?:\s+\[(?P<tag>[^\]]+)\])?\s*(?P<text>.*)$"
)
NEW_ENTRY = re.compile(r"^-\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+·\s")


def format_entry(ts: str, actor: str, tag: str | None, text: str) -> str:
    head = f"- {ts}" + (f" · **{tag}**" if tag else "") + f" · `{actor}`"
    lines = [line.rstrip() for line in text.strip().splitlines() if line.strip()]
    return "\n".join([head] + [f"  {line}" for line in lines])


def reformat_section(section: str) -> str:
    """区正文 → 重排后的区正文。无法识别的行原样保留（挂在上一条下面）。"""
    entries: list[str] = []
    for raw in section.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        if NEW_ENTRY.match(line.strip()):
            entries.append(line)  # 已是新格式表头
            continue
        match = OLD_ENTRY.match(line.strip())
        if match:
            entries.append(
                format_entry(match["ts"], match["actor"], match["tag"], match["text"])
            )
            continue
        if entries:
            entries[-1] += "\n" + (line if line.startswith("  ") else f"  {line.strip()}")
        else:
            entries.append(line)  # 区开头的孤立行：保留，不猜
    # 倒序展示（用户要求 2026-08-19）：按时间戳稳定降序。排序而不是 reverse——
    # reverse 每跑一次翻一次，这个脚本必须能重复跑。
    entries.sort(key=_entry_stamp, reverse=True)
    return "\n\n".join(entries)


def _entry_stamp(entry: str) -> str:
    """条目表头的时间戳；认不出的排到最后（字符串比较对 `YYYY-MM-DD HH:MM` 就是时间序）。"""
    match = re.match(r"^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", entry.strip())
    return match.group(1) if match else ""


def rewrite(text: str) -> str | None:
    """整篇文档 → 重排后的文档；没有执行记录区或无变化时返回 None。"""
    if HEADING not in text:
        return None
    start = text.index(HEADING) + len(HEADING)
    rest = text[start:]
    nxt = re.search(r"^##\s+", rest, re.MULTILINE)
    end = start + (nxt.start() if nxt else len(rest))
    section = text[start:end]
    body = reformat_section(section)
    tail = "\n\n" if nxt else "\n"
    out = text[:start] + "\n" + body + tail + text[end:].lstrip("\n")
    return None if out == text else out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--vault", type=Path, default=DEFAULT_VAULT
    )
    parser.add_argument("--apply", action="store_true", help="真的写盘（默认只预演）")
    args = parser.parse_args()

    tasks = args.vault / "03 Tasks"
    changed = 0
    for path in sorted(tasks.rglob("*.md")):
        if "_archive" in path.relative_to(tasks).parts:
            continue
        text = path.read_text(encoding="utf-8")
        out = rewrite(text)
        if out is None:
            continue
        changed += 1
        if args.apply:
            atomic_write_bytes(path, out.encode("utf-8"))
        print(("rewrote " if args.apply else "would rewrite ") + str(path.relative_to(args.vault)))
    print(f"changed={changed} (apply={args.apply})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
