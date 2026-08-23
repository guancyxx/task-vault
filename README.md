# Task Vault

[![Icon](assets/icon-128.png)](https://guancyxx.cn)
[![Author](https://img.shields.io/badge/author-guancyxx%20(官小西)-blue)](https://guancyxx.cn)
[![Blog](https://img.shields.io/badge/blog-guancyxx.cn-8A2BE2)](https://guancyxx.cn)

> Built by [官小西 (guancyxx)](https://guancyxx.cn) — Full-Stack Developer & AI Product
> Engineer. More open-source work: [github.com/guancyxx](https://github.com/guancyxx).

**English** | [简体中文](#简体中文)

# English

A structured task manager for Obsidian: **one file per task**, stable UUID identity, an
eight-state machine with an agent review gate, an append-only execution log, and first-class delegation to AI
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
| No structure beyond a checkbox | 8-state machine (inbox → todo → doing → review/waiting/blocked → done/cancelled) with legal-transition-only UI |
| Decisions live nowhere | Append-only execution log with typed entries (decision / comment / blocker) and state-migration records |
| AI agents edit tasks blindly | Delegation section + `assignee`/`dispatched` fields + dispatch hooks; agents read the task file like a spec |
| "Today / overdue / this week" requires queries | Sidebar cockpit buckets with countdown badges and per-project folding |

The eight states remain explicit and portable in frontmatter:

| Status | Meaning | Indicator |
|---|---|---|
| `inbox` | Newly captured, not yet triaged (no `due`) | ○ grey |
| `todo` | Scheduled | ◻ blue |
| `doing` | In progress | ◐ green |
| `review` | Agent delivery awaiting user review | 👁 purple |
| `waiting` | Waiting on a person, CI, or an upstream dependency | ⏳ yellow |
| `blocked` | Blocked by a dependency (derived state) | ⛔ muted |
| `done` | Completed | ✓ dimmed |
| `cancelled` | Cancelled with history preserved | ✕ dimmed, strikethrough |

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
  | 设置状态 | `Mod+Shift+S` | pick a legal transition target (no-target states show a notice) |
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
- the built-in localhost API (`POST /tasks`, `GET/PATCH /tasks/:id`,
  `POST /tasks/:id/log`) — routes writes through the state machine and gate; off by
  default, enabled per-agent Bearer tokens in Settings → Task Vault

## Apple Reminders sync

Obsidian has no official Apple Reminders integration: Obsidian Sync synchronizes vault
files, not the Reminders database. Existing integrations in the ecosystem are
third-party macOS apps. Task Vault instead offers an optional DIY route through
[`scripts/reminders_sync.py`](scripts/reminders_sync.py), a Python synchronizer that runs
outside Obsidian on a cron schedule.

The synchronizer is bidirectional between vault tasks and the single Apple Reminders
list named **待办**. Tasks with a `due` value are mirrored into that list; tasks without
`due` are not mirrored. Reminders created in **待办** can be imported into the vault,
and checking a mirrored reminder on an iPhone writes the task back as `done` and fires
the terminal hook if it has not already fired.

Setup requires macOS:

1. Install a compatible `remindctl` CLI and make sure both `remindctl` and `python3` are
   available on the scheduler's `PATH`. Run `remindctl` once in Terminal and allow the
   macOS Reminders/AppleScript access prompt before scheduling unattended runs.
2. Add a five-minute cron entry, replacing the repository and vault placeholders with
   your own absolute paths (cron has a minimal environment, so explicit executable
   paths are recommended):

   ```cron
   */5 * * * * cd /path/to/task-vault && /usr/bin/python3 scripts/reminders_sync.py --vault /path/to/vault >> /tmp/task-vault-reminders.log 2>&1
   ```

3. Keep the Apple Reminders list name **待办** unchanged; it is the synchronizer's only
   mirror list.

This integration is self-hosted/DIY and macOS-only. Not installing it has no effect on
the plugin's core task-management features.

## Permissions & capabilities

Task Vault uses several desktop capabilities that community-market security scans may
flag:

- **Direct Node.js filesystem access** — reads and atomically writes
  `.taskvault/config.json` and `.taskvault/ledger.json` at the vault root for hook
  settings and idempotency/dispatch state. Leaving both hooks empty disables hook-related
  activity; disabling the plugin stops this local file access entirely.
- **Shell execution through `child_process`** — runs the terminal and dispatch hook
  commands configured by the user. Both hooks are empty (disabled) by default, and
  leaving them empty disables all plugin-initiated shell commands.
- **Full vault enumeration** — enumerates Markdown files in the vault, then filters to
  `03 Tasks/` to build the task index used by the sidebar and commands. Disable this
  capability by disabling the Task Vault plugin.
- **Clipboard write access** — powers the “copy task prompt” and “copy link” buttons. It
  is used only when one of those buttons is clicked; avoid those actions to leave the
  clipboard untouched. The plugin never reads the clipboard.

Task Vault includes no telemetry and makes no network requests, apart from any network
behavior performed by hook commands that the user explicitly configures.

## What's new in 0.3.0

- **Projects panel** — all-project stats cards (open / overdue / done-this-week /
  running agents); click through to a status-grouped project detail view.
- **Agenda & calendar** — today's schedule timeline in the sidebar; a full month-grid
  calendar view (status-colored chips, overdue highlighting, prev/next navigation).
  Replaces daily-note-based calendar plugins for task scheduling.
- **Built-in local HTTP API** — `POST /tasks`, `GET/PATCH /tasks/:id`,
  `POST /tasks/:id/log` on `127.0.0.1`, per-agent Bearer tokens, every write routed
  through the state machine and the review gate. Off by default.
- **Six commands with default hotkeys** — log/annotate (decision/comment/blocker),
  set status, delegate: `Cmd/Ctrl+Shift+L/D/C/K/S/A` (rebindable).
- **Status color rails** — the left rail now encodes status with a dedicated color per
  state (cancelled = diagonal stripe); row tooltips name the state.
- **Bilingual README & UI localization** — full English/中文 README; UI strings in
  English or 简体中文 following your Obsidian language (Settings → Task Vault to
  override).
- **Agent skill shipped in-repo** — `skills/task-vault-agent/SKILL.md` is the complete
  agent protocol, now including the local API contract.
- **Release hygiene** — a dozen static-analysis warnings from the community directory
  scorecard fixed (unnecessary assertions, control chars, declarative settings API,
  CONTRIBUTING guide added); release assets are attested.

## Install

### From Community Market (pending review)

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from [releases].
2. Put them in `<vault>/.obsidian/plugins/task-vault/`.
3. Enable "Task Vault" in Settings → Community plugins.

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

## Limitations

- Desktop only (uses local hooks + file APIs).
- The execution-log headings and delegation section are Chinese (`## 执行记录`,
  `## 委派`) — they are plain headings, rename-safe, but not localized yet.

## License

MIT © [guancyxx (官小西)](https://guancyxx.cn)

---

[English](#english) | **简体中文**

# 简体中文

Task Vault 是一款结构化 Obsidian 任务管理器：**每个任务一个文件**，以稳定的 UUID
标识任务，提供带 agent 复核门禁的八态状态机、只追加的执行记录，以及面向 AI 编程
agent 的一等委派能力，同时保留纯 Markdown 的可移植性。

> 每个任务仍是一篇普通笔记。Frontmatter 承载结构化字段（`id` / `status` / `due` /
> `priority` / `project` …），正文包含 `## 任务描述` 和 `## 执行记录`。即使不再使用
> 插件，你的数据依然完整可用。

## Why · 为什么

清单类插件把任务变成一行脆弱的文本：改一个字就可能改变任务身份、破坏同步关系，
也没有合适的位置记录一项决策背后的原因。Task Vault 首先从数据模型上解决这些问题：

| 痛点 | 解决方式 |
|---|---|
| 文本行作为身份标识不可靠 | 在 frontmatter 中保存 UUID；标题、日期和标签可自由编辑 |
| 除复选框外没有结构 | 八态状态机（inbox → todo → doing → review/waiting/blocked → done/cancelled），界面只允许合法状态迁移 |
| 决策无处沉淀 | 只追加的执行记录，支持类型条目（决策 / 评论 / 卡点）和状态迁移记录 |
| AI agent 只能盲改任务 | 委派区 + `assignee`/`dispatched` 字段 + 派发 hook；agent 可像读规格一样读取任务文件 |
| “今天 / 逾期 / 本周”需要查询 | 侧边栏驾驶舱按时间分组，显示倒计时，并支持按项目折叠 |

八种状态在 frontmatter 中明确记录，且不依赖插件也可读取：

| 状态 | 含义 | 图例 |
|---|---|---|
| `inbox` | 刚捕获、尚未加工（无 `due`） | ○ 灰 |
| `todo` | 已排期 | ◻ 蓝 |
| `doing` | 进行中 | ◐ 绿 |
| `review` | agent 交付后待用户复核 | 👁 紫 |
| `waiting` | 等待外部人员、CI 或上游 | ⏳ 黄 |
| `blocked` | 被依赖卡住（推导状态） | ⛔ 置灰 |
| `done` | 已完成 | ✓ 暗淡 |
| `cancelled` | 已取消但保留记录 | ✕ 暗淡删除线 |

## Features · 功能

- **侧边栏驾驶舱** — 快速创建栏（`!high @project #tag 明天3点`），按今天 / 逾期 /
  本周 / 今日完成分组；项目子组默认折叠，并显示倒计时和逾期标记。
- **任务行操作** — 点击复选框可一次完成合法状态链并置为 done；点击日期可改期
  （支持日期与日期时间）；右键打开详情弹窗。
- **详情弹窗** — 合法状态迁移菜单、快速填写执行记录、委派。
- **命令** — 六个任务命令可直接操作编辑器中打开的任务文件，无需返回侧边栏。仅当
  当前文件已被 Task Vault 索引为任务时，命令才可用。默认快捷键为
  `Mod+Shift`+字母（macOS 上 `Mod` 为 ⌘，其他平台为 Ctrl），可在
  **设置 → 快捷键**中重新绑定：

  | 命令 | 默认快捷键 | 功能 |
  |---|---|---|
  | 记一条执行记录 | `Mod+Shift+L` | 记录一条执行记录（选择进展/决策/评论/卡点） |
  | 快捷标注 · 决策 | `Mod+Shift+D` | 记录一行**决策** |
  | 快捷标注 · 评论 | `Mod+Shift+C` | 记录一行**评论** |
  | 快捷标注 · 卡点 | `Mod+Shift+K` | 记录一行**卡点** |
  | 设置状态 | `Mod+Shift+S` | 选择合法迁移目标（无可迁移状态时显示提示） |
  | 委派 | `Mod+Shift+A` | 选择 agent、填写指令并触发派发 hook |
- **执行记录协议** — 使用 `- YYYY-MM-DD HH:MM · **决策** · `actor`` 块，最新记录
  在前；格式是纯 Markdown，方便 agent 读写。
- **委派** — 选择 agent（推荐顺序为 CC > Codex > Hermes），将指令写入 `## 委派`
  并触发自定义派发 hook；一键“复制任务提示词”即可把可直接执行的任务简报交给任意 agent。
- **复核门禁** — Hermes/CC/Codex 只能交付到 `review`；只有本地用户的明确操作或
  勾选对应的 Reminder，才能确认任务为 `done`。
- **Hooks** — 终态 hook（例如任务完成时通知）与派发 hook，均为用户自行配置的
  普通 shell 命令。
- **自然语言创建** — 支持 `!high`、`@project`、`#tag`，以及中英文日期表达
  （如 `明天3点`、`friday`）。

## For AI agents · 面向 AI agent

Task Vault 以 agent 优先的方式设计：任何 CLI agent（Hermes、Claude Code、Codex 等）
都能直接操作任务，复核门禁则保证交付仍需确认。让 agent 阅读
[`skills/task-vault-agent/SKILL.md`](skills/task-vault-agent/SKILL.md)，即可获得完整协议，
包括：

- 任务文件格式与目录规则（frontmatter schema、两段式正文）
- 写入协议（修改前重读、执行记录只追加、承重的条目格式）
- 状态迁移与复核门禁（agent 只能交付到 `review`，绝不直接置为 `done`；唯一例外是
  携带可验证的当前会话用户批准引用）
- 委派协议（派发 hook、接单记录、兜底派发）
- 内置 localhost API（`POST /tasks`、`GET/PATCH /tasks/:id`、`POST /tasks/:id/log`），
  所有写入都会经过状态机与门禁；默认关闭，在 设置 → Task Vault 中启用并签发各 agent
  的 Bearer token

## Apple Reminders sync · Apple 提醒事项同步

Obsidian 没有官方的 Apple 提醒事项集成：Obsidian Sync 同步的是 vault 文件，而不是
提醒事项数据库；生态中的现有集成则是第三方 macOS 应用。Task Vault 提供一条可选的
DIY 路径：使用 [`scripts/reminders_sync.py`](scripts/reminders_sync.py) 这个在 Obsidian
外部运行的 Python 同步器，通过 cron 定时执行。

同步器在 vault 任务与 Apple 提醒事项中唯一名为 **待办** 的清单之间双向同步。带 `due`
的任务会镜像到该清单，不带 `due` 的任务不会创建镜像；在 **待办** 中新建的提醒事项
可以导入 vault。在 iPhone 上勾选已镜像的提醒事项，会将任务写回为 `done`，并在终态
hook 尚未触发过时触发它。

设置过程需要 macOS：

1. 安装兼容的 `remindctl` CLI，并确保调度器的 `PATH` 中能找到 `remindctl` 和
   `python3`。安排无人值守任务之前，先在终端运行一次 `remindctl`，并允许 macOS
   弹出的提醒事项/AppleScript 访问请求。
2. 添加一个每五分钟执行一次的 cron 条目，将仓库与 vault 占位路径替换为你自己的
   绝对路径（cron 环境变量很少，建议明确填写可执行文件路径）：

   ```cron
   */5 * * * * cd /path/to/task-vault && /usr/bin/python3 scripts/reminders_sync.py --vault /path/to/vault >> /tmp/task-vault-reminders.log 2>&1
   ```

3. 不要修改 Apple 提醒事项清单名 **待办**；这是同步器唯一使用的镜像清单。

此集成需要自行托管/配置，且仅支持 macOS。不安装它不会影响插件的核心任务管理功能。

## Permissions & capabilities · 权限与能力

Task Vault 使用了几项可能被社区市场安全扫描标记的桌面端能力：

- **直接访问 Node.js 文件系统** — 在 vault 根目录读取并原子写入
  `.taskvault/config.json` 与 `.taskvault/ledger.json`，用于保存 hook 设置以及
  幂等/派发状态。两个 hook 留空即可禁用 hook 相关活动；禁用插件会完全停止这类
  本地文件访问。
- **通过 `child_process` 执行 shell** — 运行用户配置的终态与派发 hook 命令。
  两个 hook 默认均为空（即禁用）；保持为空即可禁止插件发起任何 shell 命令。
- **枚举整个 vault** — 枚举 vault 中的 Markdown 文件，再筛选 `03 Tasks/`，构建
  侧边栏与命令使用的任务索引。禁用 Task Vault 插件即可停用此能力。
- **写入剪贴板** — 用于“复制任务提示词”和“复制链接”按钮。仅在点击对应按钮时写入；
  不使用这些操作即可保持剪贴板不变。插件从不读取剪贴板。

Task Vault 不含遥测，也不会发起网络请求；唯一例外是用户明确配置的 hook 命令自身
可能产生的网络行为。

## 0.3.0 更新内容

- **项目面板** —— 全库项目统计卡片（开放 / 过期 / 本周完成 / 在跑 agent），点开进入
  按状态分组的项目详情视图。
- **日程面板与日历** —— 侧边栏今日日程时间轴；完整月历视图（状态色 chip、过期高亮、
  前后月导航）。以任务为数据源，取代基于日记的日历插件。
- **内置本地 HTTP API** —— `127.0.0.1` 上的 `POST /tasks`、`GET/PATCH /tasks/:id`、
  `POST /tasks/:id/log`，按 agent 签发 Bearer token，所有写入经过状态机与复核门禁。
  默认关闭。
- **六命令默认热键** —— 记录 / 快捷标注（决策/评论/卡点）、设置状态、委派：
  `Cmd/Ctrl+Shift+L/D/C/K/S/A`（可改绑）。
- **状态色条** —— 左侧色条按状态独立配色（cancelled 为斜纹）；行悬浮提示状态名。
- **双语 README 与界面本地化** —— README 中英双语；界面文案跟随 Obsidian 语言
  （可在 设置 → Task Vault 覆盖）。
- **仓库内 agent skill** —— `skills/task-vault-agent/SKILL.md` 完整 agent 协议，
  已含本地 API 契约。
- **发布卫生** —— 修复社区目录记分卡的十余条静态分析告警（冗余断言、控制字符、
  声明式设置 API、补 CONTRIBUTING）；发布资产已签名（attestations）。

## Install · 安装

### 从社区市场安装（审核中）

### 手动安装

1. 从 [releases] 下载 `main.js`、`manifest.json`、`styles.css`。
2. 将它们放入 `<vault>/.obsidian/plugins/task-vault/`。
3. 在设置 → 第三方插件中启用 “Task Vault”。

## Data model · 数据模型

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

完整中文规范见 `docs/任务系统规范.md`。

## Limitations · 局限

- 仅支持桌面端（依赖本地 hook 与文件 API）。
- 执行记录和委派区使用中文标题（`## 执行记录`、`## 委派`）；它们只是普通标题，
  可安全重命名，但目前尚未本地化。

## License · 许可证

MIT © [guancyxx (官小西)](https://guancyxx.cn)

[releases]: https://github.com/guancyxx/task-vault/releases
