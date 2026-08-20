# CONTEXT.md — task-vault 术语与决策

## 术语表

| 术语 | 定义 |
|---|---|
| 任务文件 (task file) | `03 Tasks/YYYY-MM-DD-<slug>.md`，每任务一个，frontmatter 承载全部结构化字段 |
| 身份 (identity) | frontmatter `id`（UUID）。改其他任何字段不换身份——旧系统"整行文本 hash 为 key"的根治点 |
| 状态机 | inbox→todo→doing⇄waiting / blocked(推导)→done/cancelled 七态；转移表见 model/statusMachine.ts |
| blocked | 非手设状态，由 blocked-by 里存在未终态依赖推导；依赖 done/cancelled 自动解除 |
| 时间三元组 | start（计划开始，未到不进今天）/ due（DDL，date=全天 or datetime=分钟硬截止）/ remind（提前量 m\|h\|d） |
| 全天默认提醒 | date-only 任务的提醒时刻默认当天 09:00（timed 任务默认 due 时刻）；可配置 |
| 执行记录 | 任务文件 `## 执行记录` 区，`- <ts> [<actor>] ([类型]) <内容>` 追加式；类型：进展(无)/[决策]/[评论]/[卡点]；迁移落 `[from→to]` |
| 终态 hook | status 进入 done/cancelled 时 fire 的可配置 shell 命令；幂等键 = task_id+终态 |
| 派发 hook | 委派时 fire 的 hook；`dispatched` 时间戳 + `## 委派` 指令区构成派发上下文 |
| 兜底 cron | 扫描 assignee≠user ∧ status=todo ∧ 30min 无接单 → 补派（hook 失败不静默） |
| mirror 块 | frontmatter 里同步器私有的 reminders-uuid 字段；插件/agent 禁碰 |
| ledger | `vault/.taskvault/ledger.json`：hook 幂等账本 + 运行时状态，插件与 Python 同步器共用 |
| 旧系统 | 文本行 `- [ ] 描述 #hermes 📅 日期` + obsidian-tasks + Dataview + obsidian-reminders-sync.py（10 已修坑）；仅存于 `_archive/` 与退役文档 |

## 关键决策（ADR 摘要，全文见 vault/01 Projects/Task Vault.md）

- D1 每任务一文件（放弃 block ID/Dataview inline/私有索引——上限或索引漂移）
- D2 侧边栏驾驶舱为主界面；D3 保留 Reminders 双向镜像，同步器重写为 UUID 映射
- D7 终态 hook 取代 #hermes→ntfy→订阅器拉会话链（08-17 事故链路）
- D9 时间双粒度 + remind 偏移；DDL 只提醒不改状态
- 委派推荐序 CC>Codex>Hermes（用户既有铁律）；Reminders 唯一清单「待办」
- 同步器保持进程外 Python cron（Obsidian 关闭时管道仍活）
