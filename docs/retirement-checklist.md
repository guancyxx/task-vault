# Retirement Checklist — 旧任务链退役清单（Task 17 / FR-026）

> 2026-08-19 Task Vault 系统上线，旧链路分批退役。本清单是 FR-026 的交付物，
> 记录每条旧链的退役状态与证据。状态：✅ 已退役并验证 ｜ 🔄 部分完成 ｜ ⬜ 待办。

## 1. 任务产生/勾选方（6 个 cron）

| # | 旧链路 | 退役动作 | 状态 | 证据 |
|---|--------|----------|------|------|
| 1 | daily-github-watch（e409802cd6b1，04:00） | prompt 改写：产出 Task Vault 任务文件，不再写文本行 | ✅ | 08-21 产出 4 个合规任务文件（`03 Tasks/github-watch/2026-08-21/`），frontmatter + 执行记录 + mirror 齐全 |
| 2 | 夜间复盘（34ff6e6e4ded，01:30） | prompt 改写：查漏补缺建 `[遗漏]` 任务文件；执行逾期铁律（不改 due，只追加 [逾期] 记录） | ✅ | 08-21 run：`阅读-hermes-更新-f0ffcbc.md`、`早会-2条-action-item-归属确认.md`（均 _未分类，合规格式）；due 原样保留 |
| 3 | 早上巡查（2bbbba1b1330，05:30） | prompt 改写：巡查用 frontmatter status/due/completed | ✅ | 08-21 run 报告：due 今天 9 条列举正确，「推送 due untouched」 |
| 4 | 每日早报（ef18d17f4d60，02:00）第三步 | 学习注入改 Task Vault 格式（口语+阅读任务文件） | ✅ | 08-20 起每日产出 `03 Tasks/学习/<date>/` 任务文件；08-21 两条（口语-meta-ai-mac-app / 阅读-langgraph-multi-agent） |
| 5 | 周蒸馏（820efb7b943b，06:00） | 改读 Task Vault 任务文件（不再依赖文本行勾选） | ✅ | 08-21 run：正确读 08-14 旧归档（<08-19 用 _archive，≥08-19 用 frontmatter，分界处理正确） |
| 6 | hermes-auto-update（3416f6f6c9c0，04:00） | `write_reading_todo()` 迁 Task Vault 格式（08-20 10:13） | ✅* | 脚本已迁移（设备管理/<date>/hermes-自动更新阅读-<date>.md）；新路径尚未有产出（08-21 更新本身失败，范围外），首次产出待验 |

## 2. 每日早报第四步（健康注入）

| 旧链路 | 退役动作 | 状态 | 证据 |
|--------|----------|------|------|
| （新增产线，无旧链） | 早报 cron prompt 追加「第四步：注入每日健康任务」，从 Weight Cut 70.md 模板化当日训练任务 | 🔄 | prompt 已含第四步（08-21 上午加入）；08-21 当日任务系 08:43 手工补建（02:00 运行时 prompt 尚无第四步）；**明晨 02:00 首跑待验** |

## 2b. 会话外产线（Task 17 盘点时遗漏，Checkpoint F 补修）

| 旧链路 | 退役动作 | 状态 | 证据 |
|--------|----------|------|------|
| lark-meeting-recorder `save_review_task()`（launchd 常驻） | 旧格式：向 `03 Tasks/YYYY-MM-DD.md` 追加 `- [ ] #hermes 📅` 文本行。08-21 09:28 重写为 Task Vault 格式（`_未分类/<date>/复盘今日早会-<时长>-<HHMM>.md`，原子写，幂等），monitor 已重启加载 | 🔄 | 隔离测试通过（格式/幂等/无旧标签泄漏）；**下次早会实测待验**（下一次会议转录完成时） |

## 3. 触发/展示链

| 旧链路 | 退役动作 | 状态 | 证据 |
|--------|----------|------|------|
| #hermes→ntfy→订阅器触发链 | 不再写 #hermes 触发标签；订阅器推送已停 | ✅ | `~/.hermes/logs/ntfy-trigger.log` 08-21 全部 Skipped；新任务文件零 #hermes |
| Dashboard DQL 面板 | 全局 Dashboard.md 顶部已标迁移注记（数据源=任务文件 frontmatter，驾驶舱=侧边栏） | ✅ | Dashboard.md:7-9（08-20） |
| 旧同步器 obsidian-reminders-sync | cron ce05cd2a5b7c 已删，脚本移 cache/retired；新同步器 task-vault-reminders-sync（2f2ab59f3e28，*/5）接管 | ✅ | cron list 确认；48h 运行记录全 completed 零 error |
| obsidian-tasks 插件 | 从 vault 移除（plugins/ 目录已无），规范 §8 废弃声明 | ✅ | `.obsidian/plugins/` 无 obsidian-tasks；归档日文件在 `_archive/` 只读 |

## 4. skills 引用

| 引用方 | 退役动作 | 状态 | 证据 |
|--------|----------|------|------|
| obsidian-vault skill | §任务格式 指向新协议（02 Knowledge/任务系统规范.md 为唯一权威） | ✅ | SKILL.md:99-101（「任务系统（Task Vault 插件，2026-08-19 起）」区） |
| obsidian-task-lifecycle skill | 全文重写为 Task Vault 协议 | ✅ | SKILL.md:14-16；含 08-21 事故教训（迁移时枚举全部产线） |
| 每日知识整理 cron（ce6091995d8f）skills 引用 | 引用 ai-session-archive | ✅ | 技能存在于 `~/.hermes/skills/note-taking/ai-session-archive`（SKILL.md 有效）；03:30 首跑 ok |

## 5. 遗留物

| 遗留物 | 处置 | 状态 |
|--------|------|------|
| `03 Tasks/2026-08-20.md` 顶层日文件（08-20 09:55 写入） | 历史残留（lark 旧格式时代产物）；规范规定日文件在 `_archive/` 只读，但**不主动移动**（agent 禁动 _archive，且移动属归档动作） | ⬜ 待用户定夺：留原处（同步器会忽略它，无 frontmatter 不索引）或手动移入 _archive |
| `03 Tasks/magicedit/2026-08-19/AUDIT-pr1153.md`（无 frontmatter） | 审计报告混入任务目录，非任务文件；夜间复盘已标注「异常文件（超范围未动）」 | ⬜ 待用户定夺 |
| `03 Tasks/magicedit/2026-08-19/查-callllm-60s-超时.md` 缺 id | **已修**（08-21 09:35 补 UUID + 决策记录）；同步器下一轮自动建镜像 | ✅ |

## 6. 补验清单（终验后滚动）

- [ ] 明晨（08-22）02:00 早报第四步健康注入首跑
- [ ] 下次早会 lark 新格式任务文件实测
- [ ] auto-update 新路径首次产出验证（需一次成功的更新）
