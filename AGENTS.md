# Runtime Contracts — .taskvault 与共享契约

> TS 插件（CC）与 Python 同步器（Codex）并行开发，本文件是双方唯一共享的运行时契约。
> 任何一方改这里必须 PR + 对方 review。字段 schema 权威在 docs/spec.md FR-001，本文件只定义 spec 未覆盖的运行时细节。

## 1. 目录布局

```
vault/.taskvault/
├── config.json      # hook 命令模板 + 默认参数（单一事实源，插件设置 UI 读写）
└── ledger.json      # 幂等账本 + 派发状态 + 同步 last_run（双方原子读写）
```

## 2. config.json

```json
{
  "version": 1,
  "terminal_hook": "",      // 空串 = 禁用。支持 {TASK_PATH} {TASK_ID} {TASK_STATUS} {TASK_TITLE} {TASK_ASSIGNEE} 占位符
  "dispatch_hook": "",
  "default_remind": { "allday": "09:00", "timed": "due" },
  "backstop_minutes": 30
}
```

- hook 命令执行时：占位符文本替换 + 同时设置环境变量 `TV_TASK_PATH/TV_TASK_ID/TV_TASK_STATUS/TV_TASK_TITLE/TV_TASK_ASSIGNEE`（TS 与 Python 两侧都必须支持两种传参）。
- 配置只由插件设置 UI 写；Python 侧只读。

## 3. ledger.json

```json
{
  "version": 1,
  "terminal": {
    "<task-id>": { "status": "done", "fired_at": "2026-08-19T14:32:00+08:00" }
  },
  "dispatch": {
    "<task-id>": { "count": 2, "last_at": "2026-08-19T14:35:00+08:00" }
  },
  "sync": { "last_run": "2026-08-19T14:35:00+08:00" }
}
```

- **terminal 幂等**：`terminal.<id>` 已存在 → 永不重复 fire。手动"总结"按钮不写 ledger。
- **dispatch**：`count` 累计派发次数，`last_at` 供兜底 cron 判 30min 无接单。
- **原子写铁律**：写 temp 文件（同目录）+ `os.replace`（Python）/ `rename`（Node）覆盖；**改前必重读**（TS 与 Python 可能同轮并发）。
- 时间戳统一 `YYYY-MM-DDTHH:MM:SS+08:00`（Asia/Shanghai）。

## 4. mirror frontmatter 块

```yaml
mirror:
  reminders-uuid: ABCD1234-...   # 完整 UUID 字符串
```

- **只有同步器读/写**；插件与 agent 协议禁止触碰（FR-024）。
- 无镜像（无 due）任务不写 mirror 块。

## 5. 任务文件命名与 slug

- `03 Tasks/<项目>/<YYYY-MM-DD>/<slug>.md`（项目/日期两级目录，文件名不带日期前缀）。项目文件夹解析：frontmatter `project`（剥 wikilink）→ 首个 `repo/*` 标签 → `_未分类`；日期文件夹 = created 的日期部分。
- slug = title：转小写、空白→`-`、去除非 `[a-z0-9\u4e00-\u9fff-]` 字符、连续 `-` 折叠、首尾 `-` 裁剪、截断 50 字符、空→`task`。
- 同日期同 slug 冲突 → 追加 `-2`/`-3`。

## 6. 写入规则（两侧分工，勿混用）

| 写入方 | frontmatter 修改 | body 追加/修改 |
|---|---|---|
| **TS 插件** | Obsidian `processFrontMatter()`（cache 安全，勿用裸 fs 全量重写） | `Vault.modify()` / editor API |
| **Python 外部脚本** | 读文件→改 frontmatter→原子 temp+rename | 同上原子替换 |

- 两侧都遵守：改前重读文件（防并发丢更新），写后回读验证（继承 08 文本行时代的教训）。
- Python 侧用 PyYAML 读写 frontmatter；TS 侧用 processFrontMatter + 自有最小解析（读 metadataCache 或文件）。

## 7. 执行记录格式（权威 FR-018）

块排版（2026-08-19 起）：元信息在项目符号行，正文缩进两格作为同一列表项的续行，条目之间空一行。

```
- YYYY-MM-DD HH:MM · **from→to** · `actor`      # 状态迁移
  内容

- YYYY-MM-DD HH:MM · **决策|评论|卡点** · `actor`  # 类型条目
  内容

- YYYY-MM-DD HH:MM · `actor`                     # 普通进展
  内容
```

actor ∈ hermes|cc|codex|user。新条目插在 `## 执行记录` 区**最前面**（倒序：最新在上，2026-08-19 起）；无区则建区（含标题）。已有条目永不改写。

- `- YYYY-MM-DD HH:MM ` 这个前缀是承重的：dispatch_backstop 的 LOG_ENTRY 按它认条目边界，
  换格式前先改那条正则。续行归属上一条表头，所以「接单」写在正文行里也算数。
- 旧的单行格式 `- ts [actor] [tag] 内容` 仍可解析；存量文件用 `scripts/reformat_log.py` 转换（幂等）。

## 8. Reminders 映射与 UTC 规则

- date-only due → 全天提醒，闹钟 = remindMoment（默认本地 09:00，或 due−offset 换算的时刻）。
- datetime due → 定时提醒，时刻 = due（或 due−offset）。
- **UTC 铁律（继承已修坑 2）**：remindctl 的 dueDate 是 UTC；设本地时刻 T 的定时提醒 → dueDate = T−8h 的 UTC；比较日期必须 +8h 后再取 date。
- **complete 必须传完整 UUID**（8 位前缀报 Invalid identifier）。
- 唯一清单「待办」（用户明确要求，不建分列表）。
- 无 "程序性 complete 孤儿清理"——UUID 身份下孤儿（mirror 指向不存在 id）只报告不自动删。例外（T023, 2026-08-21）：归档脚本删除终态任务自己名下 mirror 指向的提醒，属生命周期收尾而非孤儿清理。

## 9. 兜底派发 cron 判据

(`dispatched` 存在 ∨ (`tags` 含 `auto` ∧ `assignee ≠ user` ∧ `status = todo`)) ∧ `assignee ∉ {空, user}` ∧ `status = todo` ∧（有派发时）`now - max(dispatched, ledger.dispatch.<id>.last_at) > backstop_minutes` ∧ 执行记录里基准时刻之后无 `接单` 记录 → 补派；#auto 首派先写 `dispatched=now`。阈值读 config.json。

- **`dispatched` 必须存在（显式 #auto 除外）**（2026-08-19 修正）：普通任务只有 assignee 仍不算派发，避免把默认归属误判为委派；#auto 是自动首派并写入 dispatched 的唯一例外。
- **取 `last_at` 与 `dispatched` 的较晚者**：补派不写 `dispatched`（禁令），只看 `dispatched` 会让补派每 tick 重复触发。
- 上限：每任务 `count >= 3` 停手，单轮最多派 3 个（`dispatch_backstop.py` 的 `MAX_ATTEMPTS` / `MAX_PER_RUN`）。人工重试走 `--force <任务文件>`。
- `dispatch_backstop.py` 用 `.taskvault/dispatch.lock` 将最终重读与完整资格重判、ledger attempt 占位、#auto `dispatched` 写入、hook 调用包在同一排他区；attempt 在 hook 前递增，hook 失败不回退。

## 10. review 硬门禁（FR-030）

- `actor ∈ {hermes, cc, codex}` 时，状态机拒绝任何 `X → done`；agent 收尾只能写 `X → review`。
- `review → done` 仅 `actor=user` 允许。插件本地 UI 默认以 user 身份调用；Reminders 勾选完成是独立的用户确认通道，可由同步器直接写 done。
