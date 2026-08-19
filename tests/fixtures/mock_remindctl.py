#!/usr/bin/env python3
"""Stateful remindctl test double backed by MOCK_REMINDERS_STATE."""

import json
import os
import sys
import uuid
from pathlib import Path


state_path = Path(os.environ["MOCK_REMINDERS_STATE"])
state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {"reminders": [], "calls": []}
args = sys.argv[1:]
state["calls"].append(args)


def option(name, default=None):
    return args[args.index(name) + 1] if name in args else default


if args[:2] == ["show", "all"] and option("--list") == "待办":
    print(json.dumps(state["reminders"], ensure_ascii=False))
elif args and args[0] == "add":
    reminder = {
        "id": str(uuid.uuid4()).upper(),
        "title": option("--title", args[1] if len(args) > 1 else ""),
        "notes": option("--notes", ""),
        "dueDate": option("--due"),
        "alarmDate": option("--alarm"),
        "isAllDay": option("--alarm") != option("--due"),
        "isCompleted": False,
        "list": "待办",
    }
    state["reminders"].append(reminder)
    print(json.dumps(reminder, ensure_ascii=False))
elif args and args[0] == "edit":
    identifier = args[1]
    reminder = next(item for item in state["reminders"] if item["id"] == identifier)
    if "--due" in args:
        reminder["dueDate"] = option("--due")
    if "--alarm" in args:
        reminder["alarmDate"] = option("--alarm")
    print(json.dumps(reminder, ensure_ascii=False))
elif args and args[0] == "complete":
    identifier = args[1]
    reminder = next(item for item in state["reminders"] if item["id"] == identifier)
    reminder["isCompleted"] = True
    print(json.dumps(reminder, ensure_ascii=False))
else:
    raise SystemExit(f"unsupported mock invocation: {args}")

state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
