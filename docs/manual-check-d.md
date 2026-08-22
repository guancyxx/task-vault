# Phase D 手动验证清单

> 纯逻辑（状态机、完成折叠、hook 幂等、config 归一）已单测覆盖；本清单覆盖 DOM/obsidian 适配层。
> 在真 vault（副本已由父 agent 安装）里逐条走。每条给 期望 / 实际 两栏，实测填「实际」。

## 环境

1. `npm run build && npm run install:vault`
2. Obsidian 重载插件（或 Cmd-R）
3. 命令面板 → `Task Vault: Open` 打开侧边栏

---

## Task 11 — 设置面板 + 图例

- [ ] 设置 → Task Vault：看到「终态 hook / 派发 hook / 全天默认提醒时刻 / 兜底派发阈值」四项，初始值分别为 空 / 空 / 09:00 / 30。
- [ ] 终态 hook 填 `echo "done {TASK_ID}" >> /tmp/tv-hook.log`，切走再回设置 → 值已保存。
- [ ] 检查 `vault/.taskvault/config.json`：`terminal_hook` 已写入，格式符合 contracts §2。
- [ ] 命令面板 → `Task Vault: 图例`：弹窗列出 8 状态×图标×颜色、剩/超期两种时间徽章、委派图标；配色与侧边栏行一致。

## Task 12 — Hook 体系（配合 Task 10 触发）

- [ ] 配好终态 hook 后，把一个 doing 任务勾完成 → `/tmp/tv-hook.log` 追加一行；`vault/.taskvault/ledger.json` 的 `terminal.<id>` 出现，`fired_at` 为 `+08:00` 时间戳。
- [ ] 同一任务不会二次 fire（done 无出口，无法再次触发）；手动改 ledger 删除该条再无法复现（done 已终态）。
- [ ] 终态 hook 留空 → 勾完成不写 ledger、不执行命令（`/tmp/tv-hook.log` 无新增）。

## Task 10 — 行内操作

- [ ] **勾选完成**：doing 任务点复选框 → 状态变 done、划掉标题、移入「已完成」；文件 frontmatter `status: done` + `completed` 已写；`## 执行记录` 追加 `[doing→done]` 行。
- [ ] **todo 直接勾完成**：todo 任务勾选 → 变 done（走 todo→doing→done 合法链），frontmatter `started` 与 `completed` 均已填，执行记录只追加一条 `[todo→done]`。
- [ ] done 行复选框置灰不可再点（不可逆）。
- [ ] **被阻塞任务** 勾选 → 弹「被阻塞，无法完成」提示，状态不变。
- [ ] **状态菜单**：点状态图标 → 弹菜单只含 `TRANSITIONS[当前状态]` 合法项（如 doing 显示 等待中/已完成/已取消，不含 收件箱）；选一项 → 状态改变 + 执行记录 + 文件同步。
- [ ] cancelled 任务状态菜单含「待办」（重开），选中 → 回 todo，`completed` 被清除。
- [ ] **改期**：点日期/倒计时徽章 → 弹「改期」；切换「全天」勾选在 date / datetime-local 之间切换；保存 → due 变更、任务即时重新分区；清除 → due 移除。
- [ ] **子任务折叠**：有 `parent` 的任务缩进渲染在父行下、不再出现在自身分区顶层；父行显示 `x/y` 进度与 ▸/▾；点 ▸/▾ 折叠/展开，刷新后记忆保持。

## Task 13 — 详情弹窗与委派

- [ ] 点击行主体（非复选框/图标/徽章热区）→ 弹详情 Modal。
- [ ] **标题就地编辑**：改标题回车 → frontmatter `title` 更新。
- [ ] **快捷属性**：状态点选弹合法转移菜单；优先级点选弹 高/普通/低；开始/截止点选弹改期（复用 Task 10 组件）；提醒/项目/领域/标签为输入框，回车或失焦写入 frontmatter（标签空格分隔转数组）。
- [ ] **快速填入**（SC-010 ≤1s）：选「决策/评论/卡点/进展」+ 输入 + 回车 → `## 执行记录` 追加一条对应类型条目，格式符合 contracts §7；面板即时清空。
- [ ] **委派 hook 未配时不许谎报**（2026-08-19 回归）：清空设置里的派发 hook → 委派 → 必须弹「⚠️ 已写入 …，但派发 hook 未配置——没有 agent 被启动」，**不是**「已委派给 cc」。配上 hook 再委派 → 弹「已委派给 cc」且终端窗口起来。
- [ ] **委派**（SC-009）：agent 下拉按 CC/Codex/Hermes 顺序；填指令点「委派」→ frontmatter 写 `assignee`+`dispatched`；body 出现 `## 委派` 区含指令全文；配了 dispatch hook 时执行一次、`ledger.json` 的 `dispatch.<id>.count` +1；行上出现委派图标 ➤。
- [ ] **底部**：打开文件 → 在编辑区打开该 md；复制链接 → 剪贴板得 `obsidian://open?vault=…&file=…`；总结 → 触发终态 hook（不写 ledger，可重复）。

---

## Checkpoint D — 完整闭环演练

单条任务从捕获走到终态，验证时间线完整：

1. [ ] 捕获框输入 `!high @写作 明天下午3点 写季度复盘` → 收件箱/今天出现，due 正确。
2. [ ] 状态菜单 todo→doing（或详情弹窗改状态）→ frontmatter `started` 写入，执行记录 `[todo→doing]`。
3. [ ] 详情弹窗「决策」记一条（如「按 OKR 拆三段」）→ 执行记录出现 `[决策]` 条目。
4. [ ] 详情弹窗委派给 CC + 指令 → `## 委派` 区 + `assignee: cc` + `dispatched` + dispatch hook fire 一次。
5. [ ] 勾选完成 → `[doing→done]`、`completed` 写入、移入已完成；terminal hook fire **恰好一次**（`ledger.terminal.<id>` 出现）。
6. [ ] 打开该任务文件，确认 `## 执行记录` 时间线按序完整：`[todo→doing]` → `[决策]` → `委派给 cc` → `[doing→done]`，且无重复 fire。
7. [ ] 再次勾选/改状态无法复现 terminal fire（done 无出口 + ledger 幂等）。
