# Task Vault

[![Icon](assets/icon-128.png)](https://guancyxx.cn)
[![Author](https://img.shields.io/badge/author-guancyxx%20(官小西)-blue)](https://guancyxx.cn)
[![Blog](https://img.shields.io/badge/blog-guancyxx.cn-8A2BE2)](https://guancyxx.cn)

A structured task manager for Obsidian: **one file per task**, stable UUID identity, a
eight-state machine with an agent review gate, an append-only execution log, and first-class delegation to AI
coding agents — without giving up plain-Markdown portability.

> Built by [官小西 (guancyxx)](https://guancyxx.cn) — Full-Stack Developer & AI Product
> Engineer. More open-source work: [github.com/guancyxx](https://github.com/guancyxx).

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
| No structure beyond a checkbox | 8-state machine (inbox → todo → doing → review/waiting/blocked → done/cancelled) with legal-transition-only UI |
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
- **Commands** — six task commands drive the file open in the editor with no sidebar
  round-trip. Each is greyed out unless the current file is a task Task Vault has indexed.
  Default hotkeys are `Mod+Shift`+letter (`Mod` = ⌘ on macOS, Ctrl elsewhere) and can be
  re-bound in **Settings → Hotkeys**:

  | Command | Default hotkey | Does |
  |---|---|---|
  | 记一条执行记录 | `Mod+Shift+L` | log an entry (pick 进展/决策/评论/卡点) |
  | 快捷标注 · 决策 | `Mod+Shift+D` | one-line **决策** entry |
  | 快捷标注 · 评论 | `Mod+Shift+C` | one-line **评论** entry |
  | 快捷标注 · 卡点 | `Mod+Shift+K` | one-line **卡点** entry |
  | 设置状态 | `Mod+Shift+S` | pick a legal transition target (终态 shows a notice) |
  | 委派 | `Mod+Shift+A` | pick an agent + instruction, fire the dispatch hook |
- **Execution log protocol** — `- YYYY-MM-DD HH:MM · **决策** · `actor`` blocks, newest
  first, plain Markdown, agent-friendly.
- **Delegation** — pick an agent (CC > Codex > Hermes recommended order), write the
  instruction into `## 委派`, fire your own dispatch hook; one-click "copy task prompt"
  hands any agent a ready-to-execute brief.
- **Review gate** — Hermes/CC/Codex can deliver only to `review`; only an explicit local-user
  action or a checked Reminder can confirm the task as `done`.
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

[releases]: https://github.com/guancyxx/task-vault/releases

## Data model

```yaml
---
id: <UUID>          # identity, never changes
title: 修 neutralizeFence 正则容错
status: doing       # inbox|todo|doing|review|waiting|blocked|done|cancelled
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

## For AI agents

Task Vault is built agent-first: any CLI agent (Hermes, Claude Code, Codex, …) can operate
tasks directly, and the review gate keeps agents honest. Point your agent at
[`skills/task-vault-agent/SKILL.md`](skills/task-vault-agent/SKILL.md) — the complete
protocol covering:

- task file format & folder rules (frontmatter schema, two-section body)
- the write protocol (re-read before patch, append-only log, load-bearing entry format)
- status transitions & the review gate (agents deliver to `review`, never `done`,
  unless carrying a verifiable in-chat approval citation)
- delegation protocol (dispatch hooks, acceptance entries, backstop)
- the optional built-in localhost API (planned for v0.3 — `POST /tasks`, `GET/PATCH
  /tasks/:id`, `POST /tasks/:id/log`) — routes writes through the state machine and gate

The API is not in the current release; until it ships, agents write task files directly
per the skill protocol.

## Limitations

- Desktop only (uses local hooks + file APIs).
- The execution-log headings and delegation section are Chinese (`## 执行记录`,
  `## 委派`) — they are plain headings, rename-safe, but not localized yet.

## License

MIT © [guancyxx (官小西)](https://guancyxx.cn)
