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
9. **Two-step lock order for agent `done` (FR-030a, 2026-08-25).** When closing a task via
   the chat-confirmation channel, the two writes must land in this order — body first,
   frontmatter second. ① patch the body: insert the done-edge entry carrying the
   `user-confirm:` citation; ② patch the frontmatter: `status: done` + `completed`.
   Writing the frontmatter first opens a window where the review gate ingests a
   "done task with no citation in the body", reverts it to `review`, and writes its own
   intervention entry — which the agent's follow-up body patch may then clobber (this
   actually happened 2026-08-24 08:28). Both steps individually follow rule 1: re-read
   before patch, read back after.

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
  完成标准已满足并经用户确认（「继续」为在席确认）。
  user-confirm: session=20260823_110322_61ec24 msg=65069 quote="PR 合并、总结交完才算 done"
```

The citation must live inside the done entry, or in an entry written no earlier than the
done boundary (both are legal per the authoritative spec). The gate checks format only; a
deployment-side auditor verifies each citation against the originating chat store (message
exists ∧ role=user ∧ session matches ∧ quote is an exact substring ∧ the message time is
not later than the done write ∧ not a system injection). Failed verification = unreviewed.

When writing this done, follow the two-step lock order (write-protocol rule 9): body
(citation) first, frontmatter (`status: done`) second — never the reverse.

## Delegation protocol

1. Pick the agent (recommended order: CC > Codex > Hermes).
2. Write the instruction into the `## 委派` section, set `assignee`, and dispatch through
   the plugin's delegate action (UI, or the API when it ships) so the dispatch hook fires
   and `dispatched` is stamped. Hand-writing `dispatched` is forbidden.
3. A dispatch whose hook is unconfigured writes frontmatter but starts NO agent — the
   delegator must surface that honestly.
4. The delegated agent picks the task up by appending `接单` (acceptance) in its first log
   entry; the backstop cron re-dispatches after 30 min without acceptance.
5. The task prompt handed to the agent should include: task file path (absolute or
   obsidian:// URI), the instruction, and this protocol (or a pointer to this file).

## Decision-point write protocol (FR-050)

When the work hits a fork the USER must settle (not a technical choice the agent can make
alone), write the options into a `## 决策点` body section — one checkbox line per option,
prefixed by a `Dn` group id:

```
## 决策点
- [ ] D1 方案A：本地缓存
- [ ] D1 方案B：直连远端
```

Rules:

1. **One `Dn` per question.** Lines sharing the same `Dn` prefix are one mutually exclusive
   option group — exactly one of them gets checked. Number groups sequentially within the
   file (`D1`, `D2`, …); reuse a number only when appending options to that same question.
2. **Line format is load-bearing**: `- [ ] Dn <option description>` (a space after `]` and
   after the group id). The plugin's parser tolerates junk lines but only this shape is read.
3. **The check gesture belongs to the user.** Checking flips the line to
   `- [x] Dn <描述> ✅ YYYY-MM-DD` (the plugin UI does the flip + date stamp and auto-logs
   a `**决策**` entry with `actor=user`). Agents never pre-check an option for the user —
   not even the one they recommend; state the recommendation in `## 任务描述` or a log
   entry instead.
4. **Checked lines are settled history — never rewrite them.** Do not edit, re-order,
   re-date, or un-check a `- [x]` decision line (same iron rule as 执行记录). If the user
   changes their mind, add a NEW option line under a new `Dn` group and let them check it.
5. The section is optional and append-only in spirit: create it when the first fork appears,
   keep it after the choice is made (the checked line is the audit trail), and drop the
   section only on task archival.
6. Non-terminal tasks with an unchecked option surface in the sidebar 「待你决策」 zone —
   one row per task, clickable into the detail popover's decision buttons. A task whose
   every group is checked drops out of the zone automatically.

## Local HTTP API

The plugin ships a built-in localhost HTTP API so agents can route writes through the state
machine, the FR-030 review gate, and hooks instead of editing files by hand. Desktop-only,
**off by default**. Enable it in the plugin settings → *Local API*: turn it on, keep the port
(default `39187`), and generate a token per agent. Each token maps to one actor
(`hermes`/`cc`/`codex`); the **actor is taken from the token, never from the request body**.

- Bind: `127.0.0.1` only (never `0.0.0.0`); no CORS; 64 KB body cap.
- Auth: `Authorization: Bearer <token>`; a missing/unknown/blank token → `401 {"error":...}`.
- Errors are English JSON `{ "error": ... }` (machine-consumed, not localized).

| Method | Path | Body | Success | Notes |
|--------|------|------|---------|-------|
| POST | `/tasks` | `{ text }` | `201 { path, title }` | `text` runs through capture parsing (`!high @project #tag` + NL date); `source` is stamped to the token's actor |
| GET | `/tasks/:id` | — | `200 { path, task, log }` | `task` = frontmatter, `log` = raw `## 执行记录` body |
| PATCH | `/tasks/:id` | `{ status?, due?, priority? }` | `200 { ok }` | `status` goes through the machine; an illegal target (or agent→`done`) → `409 { error, legal: [...] }` |
| POST | `/tasks/:id/log` | `{ text, kind? }` | `201 { ok }` | `kind` ∈ `决策`/`评论`/`卡点`; omit for plain progress |

An unknown `:id` → `404`. **Agents cannot set `done`** — PATCH to `done` is refused with `409`;
deliver into `review` and let the user confirm (FR-030). Example:

```bash
TOKEN=…; API=http://127.0.0.1:39187
curl -s -XPOST $API/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"写周报 !high 明天"}'
curl -s -XPATCH $API/tasks/<id> -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"status":"review"}'
curl -s -XPOST $API/tasks/<id>/log -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"text":"拉起分支","kind":"决策"}'
```

Tokens are stored in plaintext in `.taskvault/config.json` — single-user, local-only design.
When the API is off, agents write task files directly following the write protocol above.

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
