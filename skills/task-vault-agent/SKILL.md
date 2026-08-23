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

Full frontmatter schema (fields beyond the basics are optional — omit rather than
write empty):

| Field | Meaning | Notes |
|---|---|---|
| `id` | UUID | identity; never change after creation |
| `title` | short verb phrase | ≤20 characters (CJK chars count as 1) |
| `status` | one of `inbox\|todo\|doing\|review\|waiting\|blocked\|done\|cancelled` | `blocked` is derived, never hand-set |
| `start` | planned start (date or datetime) | tasks not yet started stay out of Today |
| `due` | deadline (date = all-day / datetime = hard) | no explicit deadline → today 22:00 |
| `remind` | reminder offset (m/h/d) | default: due time, or 09:00 for all-day |
| `created` | creation timestamp | `YYYY-MM-DDTHH:MM` |
| `started` | first doing-transition time | maintained by the plugin — never hand-write |
| `completed` | terminal-state time | maintained by the plugin — never hand-write |
| `priority` | `high\|normal\|low` | |
| `source` | `user\|siri\|hermes\|cc\|codex\|lark\|migration` | who created it |
| `project` | `"[[名称]]"` wikilink or plain | drives the folder |
| `area` | broader area (optional) | |
| `parent` | UUID of parent task | sub-task linkage |
| `blocked-by` | list of blocking task UUIDs | drives the derived `blocked` state |
| `assignee` | current executor | `user` or an agent id |
| `dispatched` | last dispatch timestamp | written by a real dispatch only — never hand-write |
| `tags` | free tags; `repo/<name>` tags are folder fallback | |
| `mirror` | Apple Reminders sync block | **owned by the external syncer — never touch** |

```yaml
---
id: 36c00435-a56b-4dea-a355-c00c32381709
title: 修正导航高亮溢出
status: todo
due: 2026-08-20T22:00
created: 2026-08-20T02:05
priority: normal
source: hermes
project: "[[学习]]"
assignee: user
tags: [学习]
---
```

Body: two core sections — `## 任务描述` (background/links/scope) and `## 执行记录`
(append-only timeline). A delegated task additionally carries `## 委派` holding the
instruction.

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
inbox     → todo | cancelled
todo      → doing | cancelled
doing     → waiting | review | done | cancelled
review    → done | doing | cancelled
waiting   → todo | doing | cancelled
blocked   → waiting | cancelled        # entered only via unresolved blocked-by
done      → (terminal)
cancelled → todo                        # reopen
```

**Review gate (critical for agents):** actor `hermes`/`cc`/`codex` must NEVER transition a
task to `done` — the state machine rejects it. Agents deliver to `review` and stop. Only
actor `user` (plugin UI, Reminders checkbox, or an explicit in-chat approval) can confirm
`done`. The FR-030a citation channel below is the ONE exception; there are no others.

**In-chat approval exception (FR-030a):** when the user explicitly approves closure in
chat (e.g. 「做」/「do」), the agent MAY write `done`, but the done entry itself must carry a
verifiable citation as a continuation line of that entry:

```
- 2026-08-23 20:51 · **todo→done** · `hermes`
  完成标准已满足并经用户确认（msg 65363 为在席确认）。
  user-confirm: session=20260823_110322_61ec24 msg=65069 quote="PR 合并、总结交完才算 done"
```

The gate checks format only; a deployment-side auditor verifies each citation against the
originating chat store (message exists ∧ role=user ∧ session matches ∧ quote is an exact
substring ∧ the message time is not later than the done write ∧ not a system injection).
Failed verification = unreviewed.

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

## Local HTTP API (planned for v0.3, NOT yet implemented)

Once shipped, the plugin's built-in API will let agents route writes through the state
machine, the review gate, and hooks — `POST /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`,
`POST /tasks/:id/log`, Bearer-token auth, 127.0.0.1 only, off by default. Until then,
agents write task files directly following the write protocol above. Do not document
enable-steps for a feature that does not exist in the current release.

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
5. **Overdue is not auto-extension.** Tasks are never rescheduled automatically. Carrying a
   task to another day happens only when the user asks: patch `due` to the new date and
   append a log entry stating the change.

## Verification checklist (after any task-file write)

- [ ] Re-read the file: frontmatter intact (`id` untouched, no `mirror` edits)
- [ ] New log entry is at the section top, correct space-separated timestamp, typed segment
      if applicable
- [ ] No history lines were modified
- [ ] Status change (if any) went through a legal transition; agent actor never wrote `done`
      (unless carrying a valid `user-confirm:` citation)
- [ ] File path matches the folder rules (project/date); if you changed `project`, the file
      should have been relocated (or will be, by the plugin)
