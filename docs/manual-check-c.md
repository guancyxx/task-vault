# Manual verification — Phase C (Tasks 8 & 9)

UI cannot be automated (obsidian eval only). Run these on a real vault after
`npm run build && npm run install:vault`, then reload Obsidian.

> Verify DOM with `obsidian eval` (query real nodes/metadata — do not trust the
> plugin's own logs), per AGENTS.md 测试.

## Task 8 — sidebar cockpit (五分区 + 实时刷新)

1. Command palette → **Task Vault: Open** → a right-sidebar leaf opens titled "Task Vault".
2. Five section headers render in order: **收件箱 / 今天 / 过期 / 本周 / 已完成**, each with a count.
3. A task file with `due:` = today lands in **今天**; one with a past `due` lands in **过期**
   (red, bold badge); no `due` → **收件箱**; `done`/`cancelled` → **已完成** (folded by default).
4. A `datetime` due within 24h shows a **countdown badge** `剩 XhYm`; an overdue one shows
   `超期 …` in red.
5. A task whose `blocked-by` points at a non-terminal task renders **grayed** with a
   `被阻塞` marker; hover shows `阻塞源：<titles>`.
6. A `waiting` task shows the amber ⏳ glyph.
7. Edit a task file's `due` to today in the editor → within ~3s (200ms debounce) the row
   **moves** to 今天 without a manual refresh.
8. Set a dependency task to `done` → the dependent's row **un-grays** and a
   `[blocked→…]` line appears in its `## 执行记录`.
9. Collapse **今天** (click header) → body hides, ▸ shown; edit another file to force a
   re-render → **今天 stays collapsed** (fold state preserved).
10. Corrupt one task file (break the frontmatter) → the rest of the cockpit still renders;
    the bad file simply drops out (no crash).

## Task 9 — quick capture (捕获 → 文件 → 分区 ≤1s, SC-001)

Type each into the top capture box, press Enter, then check `03 Tasks/` + the cockpit:

1. `买牛奶` → file `YYYY-MM-DD-买牛奶.md`, `status: inbox`, no `due`, appears in **收件箱** ≤1s.
2. `!high 明天下午3点 交报告 @工作 #ddl` → `priority: high`, `project: 工作`, `tags: [ddl]`,
   `due: <tomorrow>T15:00`, `status: todo`; title is just `交报告`; lands in **本周**.
3. `周五 14:00 组会` → `due: <coming Friday>T14:00`, timed; correct bucket + countdown once near.
4. `8月25号 体检` → date-only `due: 2026-08-25`, `status: todo`, **本周**.
5. `提前30分钟提醒 明早9点 吃药` → `due: <tomorrow>T09:00`, `remind: 30m`.

For each: frontmatter has a fresh UUID `id`, `created` = now, `source: user`. Same-day same-slug
capture twice → second file gets a `-2` suffix. An empty / whitespace-only title is **rejected**
(no file created).
