# Task Vault Agent Skill

Unified protocol for AI agents (Hermes / Claude Code / Codex / any CLI agent) operating on a
Task Vault vault: creating tasks, logging progress, transitioning status, and delegating.
Load this skill whenever you need to read or write Task Vault task files.

## What Task Vault is

Every task is one Markdown note with a UUID in frontmatter. The file IS the task: frontmatter
carries all structured fields, the body carries `## 任务描述` (spec) and `## 执行记录`
(append-only timeline). Your data outlives the plugin; agents are first-class writers.

## Task file format

Path: `03 Tasks/<project>/<YYYY-MM-DD>/<slug>.md` — project folder derives from the
`project` field (strip `[[]]`), else the first `repo/*` tag, else `_未分类`; the date folder
is the `created` date; filename = title slug (no date prefix; `-2`/`-3` on collision).

```yaml
---
id: <UUID>                    # never change after creation
title: 简短动词短语            # ≤20 chars
status: todo                  # inbox|todo|doing|review|waiting|blocked(derived)|done|cancelled
due: 2026-08-20T22:00         # no explicit deadline → today 22:00, never tomorrow
created: 2026-08-20T02:05
priority: normal              # high|normal|low
source: hermes                # user|siri|hermes|cc|codex|lark|migration
project: "[[学习]]"           # optional
assignee: user                # who owns execution now
tags: [学习]
---
```

Body has exactly two sections: `## 任务描述` (background/links/scope) and `## 执行记录`
(append-only timeline). A delegated task also carries `## 委派` holding the instruction.

## Write protocol (hard rules)

1. **Re-read before patch.** Multiple agents and cron jobs write `03 Tasks/` concurrently
   (especially 01:00–06:00). Always re-read the file immediately before editing; write, then
   read back to verify.
2. **Execution log is append-only.** New entries are inserted at the TOP of the
   `## 执行记录` section (newest first). Never rewrite, reorder, or delete history lines.
3. **Entry format is load-bearing.**
   ```
   - 2026-08-20 09:40 · **todo→doing** · `hermes`
     接单：从 T-1 结果继续

   - 2026-08-20 09:10 · `cc`
     [创建] 来源：早报 cron 注入
   ```
   The meta line is `- YYYY-MM-DD HH:MM ` with a **space** separator (NOT `T` — the space
   form is what the dispatch backstop and the plugin's parser treat as an entry boundary).
   Typed segments: `**决策**` / `**评论**` / `**卡点**` / state migration `**from→to**`;
   plain progress has no segment. Actor ∈ hermes|cc|codex|user. Body indented two spaces,
   blank line between entries.
4. **Never touch `mirror:`** — the Apple Reminders sync block is owned by the external
   syncer only.
5. **Never hand-write `started` / `completed` / `dispatched`** — the plugin's state machine
   (or a real dispatch) maintains them. `id` is immutable.
6. **Frontmatter edits**: use precise key replacement, not whole-file rewrites. Timestamps:
   `created` uses `T` separator; log entries use space (see pitfall above).
7. **Blocked is derived** — from unresolved `blocked-by` dependencies. Never set
   `status: blocked` by hand.
8. **DDL rule**: a task without an explicit deadline gets `due` = today 22:00. Never push
   to tomorrow unless the user literally said "tomorrow". Overdue tasks are never
   auto-rescheduled — carrying a task over means patching `due` to the new date (append a
   log entry saying so). Never copy task files (copies leak into the Reminders mirror as
   duplicates).

## Status transitions & the review gate

Legal transitions (state machine, enforced):

```
inbox → todo | cancelled        todo → doing | cancelled
doing → waiting | review | done | cancelled
review → done | doing | cancelled
waiting → todo | doing | cancelled
cancelled → todo (reopen)
```

**Review gate (critical for agents):** actor `hermes`/`cc`/`codex` can NEVER transition any
task to `done` — the state machine rejects it. Agents deliver to `review` and stop. Only
actor `user` (plugin UI, Reminders checkbox, or an explicit in-chat approval) can confirm
`done`.

**In-chat approval channel:** when the user explicitly approves closure in chat
(e.g. 「做」/「do」), the agent MAY write `done`, but must include a verifiable citation line
inside (or after) the done entry:

```
user-confirm: session=<sid> msg=<id> quote="<exact substring of the user message>"
```

Gate checks format only; an audit script verifies the citation against the agent's session
store (message exists ∧ role=user ∧ session matches ∧ quote is a substring ∧ time precedes
the done write ∧ not a system injection). Failed verification = unreviewed.

## Delegation protocol

1. Pick the agent (recommended order: CC > Codex > Hermes).
2. Write the instruction into the `## 委派` section, set `assignee`, and dispatch through
   the plugin's delegate action (UI or API) so the dispatch hook fires and `dispatched` is
   stamped. Hand-writing `dispatched` is forbidden.
3. A dispatch whose hook is unconfigured writes frontmatter but starts NO agent — the
   delegator must surface that honestly.
4. The delegated agent picks the task up by appending `接单` (acceptance) in its first log
   entry; the backstop cron re-dispatches after 30 min without acceptance.
5. The task prompt handed to the agent should include: task file path (absolute or
   obsidian:// URI), the instruction, and this protocol (or a pointer to this file).

## Local HTTP API (v0.3+, if enabled)

Prefer the plugin's built-in API over raw file writes when available — it routes through
the state machine, the review gate, and hooks:

- `POST /tasks` — create (body: capture-syntax line, parsed by the plugin)
- `GET  /tasks/:id` — read one task
- `PATCH /tasks/:id` — patch fields (`status` transitions are validated; agent tokens
  cannot reach `done`)
- `POST /tasks/:id/log` — append an execution-log entry

Auth: `Authorization: Bearer <token>`; bound to 127.0.0.1 only; off by default (enable in
the plugin settings, which also issues per-agent tokens). Raw file writes remain legal for
agents without API access — follow the write protocol above exactly.

## Pitfalls (learned the hard way)

1. **Space vs `T` in timestamps**: `created: ...T22:00` (frontmatter) vs
   `- 2026-08-20 22:00 · ...` (log entries). Sharing one variable between both produced
   entries the parsers ignored. Always take log timestamps from a live clock, not memory.
2. **Fuzzy multi-hunk patches polluted adjacent history lines** — after writing, diff-check
   that neighboring entries' timestamps are unchanged; repair immediately if not.
3. **Migration/refresh must enumerate every producer**: when the task pipeline changes,
   list ALL daily task producers (learning / health / finance / watch …) and confirm each
   has an owner, or a line silently stops being generated.
4. **The running Obsidian may hold an old plugin build** — after redeploying the plugin,
   reload Obsidian (or disable/enable the plugin) before trusting new gate behavior.
5. **External file writes don't fire editor events** — the plugin indexes them via a
   low-level `vault.on('raw')` watcher; if a just-written file doesn't appear in the
   sidebar, it's usually the debounce/burst path, not data loss.

## Verification checklist (after any task-file write)

- [ ] Re-read the file: frontmatter intact (`id` untouched, no `mirror` edits)
- [ ] New log entry is at the section top, correct space-separated timestamp, typed segment
      if applicable
- [ ] No history lines were modified
- [ ] Status change (if any) went through a legal transition; agent actor never wrote `done`
      (unless carrying a valid `user-confirm:` citation)
- [ ] File path matches the folder rules (project/date); if you changed `project`, the file
      should have been relocated (or will be, by the plugin)
