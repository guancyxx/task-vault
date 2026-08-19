# Task Vault

A structured task manager for Obsidian: **one file per task**, stable UUID identity, a
seven-state machine, an append-only execution log, and first-class delegation to AI
coding agents — without giving up plain-Markdown portability.

> Every task is still a normal note. Frontmatter carries the structure (`id` / `status` /
> `due` / `priority` / `project` …); the body holds `## 任务描述` and `## 执行记录`. Your
> data outlives the plugin.

## Why

Checklist plugins make a task a fragile line of text: edit one word and its identity
changes, sync layers break, and there is nowhere to record *why* a decision was made.
Task Vault fixes the data model first:

| Pain | Fix |
|---|---|
| Text-line identity is fragile | UUID in frontmatter; title/dates/tags freely editable |
| No structure beyond a checkbox | 7-state machine (inbox → todo → doing → waiting/blocked → done/cancelled) with legal-transition-only UI |
| Decisions live nowhere | Append-only execution log with typed entries (decision / comment / blocker) and state-migration records |
| AI agents edit tasks blindly | Delegation section + `assignee`/`dispatched` fields + dispatch hooks; agents read the task file like a spec |
| "Today / overdue / this week" requires queries | Sidebar cockpit buckets with countdown badges and per-project folding |

## Features

- **Sidebar cockpit** — capture bar (`!high @project #tag 明天3点`), Today / Overdue /
  This week / Done-today buckets, project sub-groups (folded by default), countdown and
  overdue badges.
- **Row actions** — checkbox complete (walks the legal chain to done in one gesture),
  reschedule via the date chip (date & datetime), right-click detail popover.
- **Detail popover** — legal-transition status menu, quick-fill log entry, delegation.
- **记一条执行记录** command (default `Cmd+Shift+L`) — log an entry against the task
  file open in the editor, no sidebar round-trip.
- **Execution log protocol** — `- YYYY-MM-DD HH:MM · **决策** · `actor`` blocks, newest
  first, plain Markdown, agent-friendly.
- **Delegation** — pick an agent (CC > Codex > Hermes recommended order), write the
  instruction into `## 委派`, fire your own dispatch hook; one-click "copy task prompt"
  hands any agent a ready-to-execute brief.
- **Hooks** — terminal-state hook (e.g. notify on done) and dispatch hook, both plain
  shell commands you configure.
- **Natural-language capture** — `!high`, `@project`, `#tag`, and Chinese/English date
  phrases (`明天3点`, `friday`).

## Install

### From Community Market (pending review)

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from [releases].
2. Put them in `<vault>/.obsidian/plugins/task-vault/`.
3. Enable "Task Vault" in Settings → Community plugins.

[releases]: https://github.com/guancyxx/obsidian-task-vault/releases

## Data model

```yaml
---
id: <UUID>          # identity, never changes
title: 修 neutralizeFence 正则容错
status: doing       # inbox|todo|doing|waiting|blocked|done|cancelled
due: 2026-08-20T22:00
priority: high      # high|normal|low
project: "[[magicedit]]"
tags: [watch]
---
## 任务描述
…
## 执行记录
- 2026-08-20 09:40 · **todo→doing** · `user`
  接单：……
```

See the full spec (Chinese) in `docs/任务系统规范.md`.

## Limitations

- Desktop only (uses local hooks + file APIs).
- The execution-log headings and delegation section are Chinese (`## 执行记录`,
  `## 委派`) — they are plain headings, rename-safe, but not localized yet.

## License

MIT
