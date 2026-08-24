# Spec: Task Vault — 自研 Obsidian 任务插件 v1

> 需求基线：Obsidian Vault/01 Projects/Task Vault.md（v1.1，2026-08-19 定稿）。
> 本 spec 是代码仓的实现契约；FR/SC 为稳定 ID，任务与 PR 必须 Traces-to 这些 ID。

## Objective

替换 obsidian-tasks + Dataview Dashboard + 文本行任务约定，为单人（guancyxx）单机场景构建 Obsidian 任务插件：每任务一文件、frontmatter 承载全部结构化字段、UUID 唯一身份、八态全生命周期状态机、分钟级 DDL 时间控制、侧边栏驾驶舱、执行过程留痕、终态总结/派发 hook、Apple Reminders 双向镜像重写、31 条存量任务迁移。

用户：本人 + 本机 agent 生态（Hermes/CC/Codex 的 6 个 cron 直接读写任务文件）。成功 = 四大痛点（视图弱/文本脆弱/交互摩擦/缺硬功能）全部消除，且不引入新的同步事故面。

## Tech Stack

- TypeScript (strict)，Obsidian Plugin API（target Obsidian ≥1.13.7，desktop only）
- 构建 esbuild（官方模板），测试 vitest
- 零运行时第三方依赖（纯逻辑模块与 obsidian API 适配层解耦，保证可单测）
- 外围脚本 Python 3（迁移脚本、Reminders 同步器重写），沿用现有 remindctl CLI
- 插件 id：`task-vault`，安装至 vault `.obsidian/plugins/task-vault/`

## Commands

```
开发热载:     npm run dev            # esbuild watch + 复制到 vault（配 Hot Reload 插件）
构建:         npm run build          # esbuild → main.js + manifest/styles 复制
类型检查:     npm run typecheck      # tsc --noEmit
测试:         npm test               # vitest run（单测+语料）
装进 vault:   npm run install:vault  # 复制 main.js/manifest.json/styles.css 到插件目录
迁移(一次性): python3 scripts/migrate_legacy_tasks.py --dry-run | --apply
同步器(手动轮): python3 scripts/reminders_sync.py            # cron */5 调同一脚本
```

## Project Structure

```
task-vault/
├── manifest.json / styles.css / esbuild.config.mjs
├── AGENTS.md / CONTEXT.md / docs/{spec.md, tasks.md}
├── src/
│   ├── main.ts                 # 插件入口：注册 view/命令/设置，装配 store
│   ├── settings.ts             # hook 命令模板、默认提醒时刻、兜底参数
│   ├── model/
│   │   ├── types.ts            # Task/Status/字段 schema 常量（单一事实源）
│   │   └── statusMachine.ts    # 八态转移表 + actor review 门禁 + 时间戳维护（纯函数）
│   ├── store/taskStore.ts      # 索引构建、文件监听、查询分区（薄适配 obsidian）
│   ├── time/
│   │   ├── timeRules.ts        # due/start/remind 语义、今天/过期/倒计时推导（纯函数）
│   │   └── nlDateParser.ts     # 中文自然语言时间解析（封闭模式集，纯函数）
│   ├── view/
│   │   ├── sidebarView.ts      # 驾驶舱五分区 + 捕获框 + 图例面板
│   │   ├── taskRow.ts          # 行内操作：勾选/改期/状态菜单/子任务折叠
│   │   ├── detailPopover.ts    # 详情弹窗：快捷属性 + 快速填入 + 委派
│   │   └── legend.ts           # 状态图标/颜色体系
│   ├── log/executionLog.ts     # 执行记录追加协议（四类条目格式）
│   ├── hooks/hookRunner.ts     # 终态/派发 hook + 幂等 ledger（.taskvault/ledger.json）
│   └── util/frontmatter.ts     # 经 processFrontmatter 的原子字段读写
├── scripts/
│   ├── migrate_legacy_tasks.py # 03 Tasks 文本行 → 任务文件（--dry-run/--apply）
│   └── reminders_sync.py       # Reminders 同步器重写（cron */5）
└── tests/                      # vitest：纯逻辑单测 + 解析/时间边界语料
```

## Code Style

TypeScript strict；核心域（model/time/log/hooks 逻辑）为零依赖纯函数，obsidian API 只出现在 store/view/main 适配层。注释英文。示例（状态机的形状）：

```typescript
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  inbox:    ['todo', 'cancelled'],
  todo:     ['doing', 'cancelled'],
  doing:    ['waiting', 'review', 'done', 'cancelled'],
  review:   ['done', 'doing', 'cancelled'],
  waiting:  ['todo', 'doing', 'cancelled'],
  blocked:  ['waiting', 'cancelled'],   // blocked 仅由依赖推导进入，出口人工
  done:     [],
  cancelled:['todo'],                    // 重开
};

// 每次迁移返回新字段补丁 + 一条执行记录，由调用方原子落盘
export function transition(t: Task, to: Status, actor: Actor, now: Date): TransitionResult;
```

命名：文件 camelCase，类型 PascalCase，`FR-xxx` 注释标注需求来源。日期一律本地时区 ISO（`YYYY-MM-DD` / `YYYY-MM-DDTHH:MM`），与 Reminders 交互时显式 +8h 处理。

## Testing Strategy

- vitest 单测覆盖全部纯逻辑模块：statusMachine（全转移表×非法转移）、timeRules（date/datetime 边界、跨日、过期、remind 偏移）、nlDateParser（≥60 条中文语料，含否定例）、executionLog 格式、migration 脚本（样本行→frontmatter 快照）
- UI 不做自动化：每个 view 任务带手动验证清单（步骤+预期），实机验证用 `obsidian eval` 查 DOM/元数据（用户偏好：看实际状态非工具返回值）
- 同步器：`--dry-run` 全量对账模式 + 稳态断言（`sync done: +0 ...`）
- 覆盖率：纯逻辑模块行覆盖 ≥80%（statements）

## Boundaries

- **Always**：提交前跑 `npm test && npm run typecheck`；任务文件写入走原子替换（temp+rename）；`id` 字段一经创建永不改写；所有时间比较带时区显式处理
- **Ask first**：新增任何运行时依赖；改动 `03 Tasks/` 之外的 vault 结构；触碰其他插件的配置/数据；修改 cron 计划
- **Never**：向 `.obsidian/plugins/*/`（本插件除外）写任何数据；DDL 到点自动改 status；自动删除/改写 `03 Tasks/_archive/` 归档文件；把 secrets 写进仓库或任务文件

## Success Criteria（SC，验收即测）

- SC-001 捕获框输入→任务文件落盘并出现在收件箱 ≤1s，无需刷新
- SC-002 对已有 Reminders 镜像的任务改 title/due/tags 任意字段，同步器稳态零新建零误勾（身份不变）
- SC-003 31 条存量任务全部迁移：due/priority/来源解析正确，历史日文件移入 `03 Tasks/_archive/` 且逐字节不变
- SC-004 同一任务达到终态，terminal hook 恰好 fire 一次（含 Obsidian 重启、手机端 Reminders 完成两条路径）
- SC-005 侧边栏六分区与全库人工盘点一致（抽查 ≥10 条，含 review/blocked/waiting/timed 混合）
- SC-006 nlDateParser 在 ≥60 条封闭语料上通过率 ≥95%，否定例（解析失败）原文落 inbox 不丢字
- SC-007 倒计时/过期显示在 date↔datetime、跨日、超期≥1d 等边界用例上全部正确（语料断言）
- SC-008 blocked 为纯推导：依赖完成即自动解除并刷新，无需手动干预
- SC-009 委派写入 `## 委派` + assignee + dispatched 并 fire dispatch hook；模拟无接单 30min 后兜底 cron 补派一次
- SC-010 弹窗快速填入（决策/评论/卡点）→1s 内按协议格式追加进执行记录区
- SC-011 命令「Task Vault: 记一条执行记录」：当前文件为已索引任务文件时可用了（非任务文件时命令置灰）；提交后条目按协议格式落盘区首，与侧边栏弹窗写入逐字符一致

v0.3 增补（对应 FR-031~037）：

- SC-012 色条语义：八态各渲染独立色条（含 cancelled 斜纹），行 tooltip 报状态，图例面板色条样本与行渲染同源（STATUS_META），抽 3 态实机核对
- SC-013 六命令热键：默认绑定 L/D/C/K/S/A（Mod+Shift）注册成功，热键面板可改绑；非任务文件时全部置灰；决策/评论/卡点命令提交后条目带对应类型段
- SC-014 发布卫生：manifest/package/README 无「7-state」残留；社区页 Scorecard 的可修 Warning（as 断言/空 interface/正则控制字符/getSettingDefinitions/onload 返回，共 12 条）清零；CONTRIBUTING.md 存在；release 资产带 attestations
- SC-015 agent skill：仓库 skills/task-vault-agent/SKILL.md 必须含以下封闭章节，逐节核对——任务文件格式（frontmatter 字段表/两区结构/路径规则）、写入协议（改前重读/执行记录只追加/条目时间戳空格分隔/迁移条目格式）、委派协议、review 门禁与 FR-030a citation 格式、坑清单（≥5 条）；README 有「For AI agents」入口
- SC-016 内置 API：默认关；开启后 curl 四端点全通（POST /tasks 建档、GET 读、PATCH 走状态机与门禁——agent token 置 done 被拒转 review、POST log 落协议条目）；无 token 401；非本机回环拒连
- SC-017 面板：项目面板卡片统计与库内实测一致（抽 2 项目）；日程面板今日时间轴正确（timed/all-day 排序、过期红）；日历月网格前后月导航正确、chip 点击开文档
- SC-018 文档：README 含「Apple Reminders sync」章节与权限披露章节；无内部路径/个人 cron 泄漏（发布前 grep 扫描）
- SC-019 双语 README：语言切换锚点可用（点击跳转对应语言区）；十个固定一级章节（Why/The workflow/Features/For AI agents/Apple Reminders sync/Permissions & capabilities/Install/Data model/Limitations/License）在两版中一一对应（比对一级标题数与锚点）；英文版含 H9 全部两章内容；无内部信息泄漏。（2026-08-24 修订：九→十，Why 后新增 The workflow 章，FR-042；What's new 仍视为发版瞬态章不入固定清单）
- SC-020 i18n：设置页语言下拉（auto/zh-CN/en）生效——切换后无需重启：侧边栏分区标题、图例、弹窗、命令面板命令名、Notice 在下一次 render/重开面板即变语言；auto 模式跟随 Obsidian 界面语言、未知语言回退 en；任务文件数据层标题（## 执行记录 等）与条目格式在任何语言下不变；npm test 含字典键完整性测试（en/zh 键集相等）
- SC-021 review 双统计口径（PR#3 审计债定稿）：分区口径（bucketOf）与统计口径并存不悖——①侧边栏六分区互斥：status=review 抢先返回 review 分区，today/overdue/week 分区计数不含 review（展示语义）；②统计口径（isOverdue/projectStats/FR-035 面板）按 due 覆盖全部非终态，review 照常计入过期数/开放数。review+过期 due 须同时满足 bucketOf=review ∧ isOverdue=true；聚合测试按本 SC 断言两口径并存结果
- SC-022 创建命令（FR-040/041）：命令面板出现「新建任务」「新建项目」，任意非任务文件（如普通笔记）下不灰、可直接执行；默认热键 Mod+Shift+N / Mod+Shift+J（2026-08-24 人力修订：N 被「新窗格笔记」遮蔽改 M、P 被 quick switcher 遮蔽改 J）注册成功且热键面板可改绑，与六条标注命令（L/D/C/K/S/A）无字母冲突；新建任务表单（标题/项目下拉/优先级/到期NL+预览）建档后侧边栏出现该任务、文件内容与捕获框建档字节一致；项目下拉名与 03 Tasks 磁盘文件夹 1:1；到期留空=今天22:00、解析失败拒提交；新建项目落盘三件套=主笔记（type:project）+同名 Dashboard（type:dashboard，两段 dataview 均按 project="<名>" 过滤）+根 Dashboard「独立项目」行追加 `· [[<名> Dashboard]]`；项目名含 / " [ ] 或换行被拒（Notice）；同名笔记已存在时拒绝并 Notice；dashboard_file 配置留空时只建笔记不登记；npm test 含 CREATE_COMMAND_ROWS 与模板/登记/config 硬断言
- SC-023 侧边栏 UI/UX 第二轮（FR-043~047）：①吸顶：侧边栏滚动任意深度，review/overdue/today 分区头始终可见且不遮挡行内容，week/done 头不吸顶；②心跳：等 61s 倒计时徽章数字变化、折叠/展开状态不丢（fake-timer 单测 + 实机抽查）；③捕获命令：Mod+Shift+I 触发后侧边栏视图激活且捕获框聚焦全选，热键面板可改绑，与既有命令字母无冲突；placeholder 每次 render 轮换语法示例（i18n capture.examples zh/en 键集相等）；④行降噪：p1/p2/p3 任务行不再常驻优先级 chip（p0 常驻）、project/area/#tag chips 不在常驻层（hover 显影层可读）、标题在第一行、行内与分组头无项目名双重显示；#tag hover 展开后不可点击触发其它行为（纯展示）；⑤计数语义化：overdue ≥1 红底、review ≥1 紫底、today ≥1 accent 底、week/done 与 0 计数保持灰。npm test：现有套件全绿 + 新增单测（placeholder 轮换纯函数、心跳注册纯断言、行分层渲染断言——不依赖 DOM 渲染测试，沿用 obsidian stub 模式）

## Requirements（FR，稳定 ID）

数据与状态：
- FR-001 任务文件格式：每任务一 md 文件（`03 Tasks/<项目>/<YYYY-MM-DD>/<slug>.md` 项目/日期两级目录，文件名不带日期前缀；项目文件夹 = project 字段剥 wikilink → 首个 `repo/*` 标签 → `_未分类`，日期文件夹 = created 的日期部分），frontmatter 按 schema v1.1 §4（id/title/status/start/due/remind/created/started/completed/priority/source/assignee/dispatched/project/area/parent/blocked-by/tags/mirror）
- FR-002 身份不变性：除 `id` 外任意字段/正文编辑不改变任务身份；镜像映射只认 id
- FR-003 八态状态机（inbox/todo/doing/review/waiting/blocked/done/cancelled）+ 合法转移表 + created/started/completed 自动维护
- FR-004 blocked 由 blocked-by 推导（依赖未终态即 blocked），不可手设；依赖终态自动解除
- FR-005 子任务：parent 指针，父行折叠展示 + x/y 进度

时间控制：
- FR-006 时间字段语义：due 双粒度（date=全天 / datetime=分钟硬截止）；start 计划开始（未到不进今天）；remind 偏移（m/h/d，默认 timed=due 时刻、全天=当天 09:00）
- FR-007 分区推导：收件箱/今天/过期/本周/已完成 由 status+start+due 实时计算，跨全库
- FR-008 时间可视化：timed<24h 倒计时徽章（琥珀/<1h 红），超期红粗置顶；过期不自动消失不顺延；DDL 到点绝不改 status
- FR-009 捕获框中文 NL 时间解析（封闭模式集：相对日/时刻/组合/偏移/绝对），失败原文进 inbox
- FR-010 捕获语法：`!high` 优先级、`@project` 归属、`#tag` 标签 + NL 时间共存

侧边栏与交互：
- FR-011 侧边栏驾驶舱（ItemView leaf，五分区+图例面板，实时刷新）
- FR-012 顶部快速捕获框
- FR-013 行内操作：勾选完成、日历改期（双粒度）、状态菜单、子任务折叠
- FR-014 详情弹窗：标题就地编辑、快捷属性点选（status/priority/start/due/remind/project/area/tags）、快速填入（决策/评论/卡点→执行记录）
- FR-015 委派：agent 单选（默认推荐序 CC>Codex>Hermes）+ 指令框 → 写 `## 委派` 区 + assignee/dispatched + fire dispatch hook
- FR-016 图例体系：状态×图标×颜色规范 + 侧边栏图例面板
- FR-017 《任务系统规范》文档（状态机/字段/时间语义/写入协议/委派协议），随插件交付并同步进 vault
- FR-027 记一条执行记录：命令面板/热键入口，对编辑器当前打开的任务文件唤出快速填入框（类型+一行文本），走 appendQuick canonical 通道落盘——侧边栏行外（编辑器中的任务文档）也有合规写入入口，免手写固定格式
- FR-028 agent 执行态推导与侧边栏徽章：dispatched/working/stuck/review 四相，接单/卡点文本判定与 backstop 同源
- FR-029 #auto 自动领取：backstop 判据扩展，#auto+todo+assignee≠user 无 dispatched 也派发
- FR-030 review 复核状态：第八态 doing→review→done/doing/cancelled；状态机硬门禁按 actor 执行：hermes/cc/codex 任何状态均不得直达 done，只能 X→review；仅 actor=user（含插件本地 UI 与 Reminders 勾选确认通道）可 doing/review→done
- FR-030a 聊天确认引用通道：用户在聊天里明确批准收尾（如「做」「do」）时，agent 可据此直接置 done，但必须在 done 条目内（或时间上晚于 done 边的条目里）写引用行 `user-confirm: session=<sid> msg=<id> quote="原文子串"`。插件门禁只认格式放行；审计脚本（scripts/review_audit.py）对每条引用核验 Hermes 会话库 state.db：msg 存在 ∧ role=user ∧ session 吻合 ∧ quote 是原文子串 ∧ 消息时间不晚于 done 边 ∧ 非系统注入（[ASYNC…/[OUT-OF-BAND… 前缀拒收）。核验不过 = 未复核，按危险项告警

留痕与 hook：
- FR-018 执行记录协议：`- <时间戳> [<执行者>] ([类型]) <内容>` 追加式，四类条目（进展/决策/评论/卡点）+ `[from→to]` 迁移记录
- FR-019 终态 hook：done/cancelled 时 fire 可配置 shell 命令（参数 TASK_PATH/TASK_ID/TASK_STATUS/TASK_TITLE/TASK_ASSIGNEE），幂等（ledger：task_id+终态 唯一）
- FR-020 手动"总结"按钮（任意状态可触发，不占幂等名额）
- FR-021 派发 hook：dispatch 事件 fire + 更新 dispatched；兜底 cron 规格（assignee≠user ∧ status=todo ∧ 无接单记录 ∧ dispatched>30min → 补派，#auto 首派扩展见 FR-029）随交付文档化
- FR-022 hook 命令模板、默认提醒时刻、兜底阈值均在设置面板可配

同步与迁移：
- FR-023 Reminders 同步器重写（scripts/reminders_sync.py）：task.id↔Reminders UUID（frontmatter mirror 块）；date→全天提醒（09:00 或 due−offset）、datetime→定时；UTC +8h 规则；双向完成回写（Reminders 完成→回写 done+补 fire terminal hook，含 Obsidian 关闭场景）；Siri/Reminders 新增回流→inbox 任务（source:siri）；唯一清单「待办」；程序性 complete 与用户动作区分；孤儿（身份不明残留）只报告不自动删——归档脚本删除自己名下 mirror 属生命周期收尾非孤儿清理（T023, 2026-08-21）
- FR-024 mirror 块仅同步器读写，插件与 agent 协议禁止触碰
- FR-025 迁移脚本：31 条开放任务→任务文件（UUID 生成、emoji 日期/`#src`/优先级→frontmatter、dry-run 报告先行）；历史日文件→`03 Tasks/_archive/` 只读
- FR-026 cron/agent 写入协议适配：6 个 cron 中产生/勾选任务者改写为新协议；obsidian-vault / obsidian-task-lifecycle skill 更新；Dashboard DQL 面板与 #hermes→ntfy→订阅器触发链标记退役

v0.3 增补（2026-08-23 六需求）：

- FR-031 色条状态语义（扩展 FR-016）：侧边栏条目左侧色条为状态主视觉通道。八态全差异化：inbox=灰、todo=accent、doing=蓝、review=紫、waiting=琥珀、blocked=红、done=绿、cancelled=灰斜纹（CSS repeating-linear-gradient，与 inbox 区分）；色条 4px。行加 title tooltip（`状态：<label>（<status>）`）。图例面板改渲染真实色条样本，复用 STATUS_META 单一事实源
- FR-032 命令体系与默认热键（扩展 FR-027）：六命令全部注册默认热键（用户 2026-08-23 拍板 L/D/C/K/S/A 字母组，README 注明可改绑）：记一条进展 Cmd+Shift+L（修复 08-19 遗留的默认热键缺失）、快捷标注·决策 Cmd+Shift+D、快捷标注·评论 Cmd+Shift+C、快捷标注·卡点 Cmd+Shift+K、设置状态 Cmd+Shift+S（合法转移目标点选，复用 TRANSITIONS）、委派 Cmd+Shift+A（agent 选择+指令，复用委派面板逻辑）。全部 checkCallback 门控（当前文件为已索引任务才可用），写路径统一走 appendQuick/setStatus/delegate canonical seam
- FR-033 发布卫生（R3）：manifest.json / package.json / README 描述与八态事实对齐；TS 源清掉社区市场自动扫描的 14 条 Warning 中可修的 12 条（多余 as 断言×7、\u0000 正则字面量×1、空 interface×2、getSettingDefinitions 声明式设置×1、onload 返回类型×1；fs 直访与 child_process 为架构能力不在此列）；补 CONTRIBUTING.md；发布流程加 gh attestation（artifact attestations）。fs/child_process/vault 枚举/clipboard 属架构能力（hooks/索引/复制），README「权限与能力」章节披露，不消除
- FR-034 agent skill + 内置接口（R4，两阶段）：阶段一=仓库内 `skills/task-vault-agent/SKILL.md`（任务文件格式、写入协议改前重读/执行记录只追加/条目时间戳空格分隔、委派协议、review 门禁与 FR-030a citation、坑清单）+ README「For AI agents」章节；本地 Hermes skill（obsidian-task-lifecycle）保留个人生态部分（cron/state.db 取证）分层不合并。阶段二=插件内置 localhost HTTP API（node:http 零依赖，desktop-only，默认关，设置页开关+token+端口）：POST /tasks（新建，走 capture 解析）、GET /tasks/:id、PATCH /tasks/:id（status 等字段，走 transition）、POST /tasks/:id/log（进展条目，走 appendQuick）；actor 固定为 agent 身份（hermes/cc/codex 按 token 映射）——门禁、状态机、hook 全部生效，agent 不得绕过 review。鉴权 Bearer token；仅绑 127.0.0.1；CORS 关闭；错误 JSON 化
- FR-035 项目面板（R5a）：右侧栏 ItemView（与驾驶舱并列）。打开时展示全库项目统计：每项目一卡片——开放数（inbox+todo+doing+review+waiting）、过期数、本周完成数、在跑 agent 数、按开放数降序。点卡片在中间区开项目详情（按状态分组渲染 renderTaskRow 树）。项目管理交互（委派/状态/日志）从侧边栏行操作进
- FR-036 日程面板 + 日历视图（R5b）：日程面板=右侧栏 ItemView，今日全部日程时间轴（timed 按时刻升序在前、all-day 靠后），过期标红；顶部「完整日历」按钮在中间区开日历视图。日历视图=中间区 ItemView 月网格：格内任务 chip（色条同 FR-031 语义，优先级角标），前/后月导航+回今天，点 chip 开任务文档。数据源=Task Vault 任务（due/完成日集合），非 daily notes。取代 Calendar 插件（用户拍板 2026-08-23：上线稳定后删除 vault 内 Calendar 插件）
- FR-037 Reminders 同步对外说明（R6）：README 新章「Apple Reminders sync」：如实说明 Obsidian 无官方 Reminders 同步；本仓提供 Python 同步器（scripts/reminders_sync.py，macOS + remindctl + cron */5 + 唯一清单「待办」）自建路线的完整配置步骤与依赖清单。代码不改动（remindctl 依赖的解除排为后续任务）
- FR-038 README 双语（用户需求 2026-08-23 第二轮）：README.md 中英双语。结构=顶部语言切换行（English | 简体中文 链接互跳锚点）+ 逐章中英对照（同文件内先英后中，各章以 `<hr>` 分隔；或标题双语并列——实现时二选一并保持全篇一致）。双语对齐范围固定为九个一级章节并使用显式锚点：Why / Features / For AI agents / Apple Reminders sync / Permissions & capabilities / Install / Data model / Limitations / License。maintainer 视角中文为准、对外发布视图英文为准的歧义句，以英文版为契约文本。README_zh.md 单独文件方案否决（社区市场只渲染根 README，双语必须在主文件内）
- FR-039 UI 本地化 i18n（用户需求 2026-08-23 第二轮）：插件界面全量文案抽离到字典层。语言解析顺序=显式设置 > Obsidian 界面语言（moment.locale()，非 zh 系一律回退 en）> en；设置页加「界面语言 / Language」下拉（auto/zh-CN/en，存 .taskvault/config.json，auto=跟随 Obsidian）。生效语义=无需重启插件：保存设置后下一次 render、重新打开命令面板即生效。覆盖面=用户可见文案全部：侧边栏分区标题、图例、详情弹窗三面板、六命令名、快捷标注弹窗、捕获框 placeholder、Notice 消息、设置页标签、委派 agent 名旁注。执行记录/委派区等数据层标题（## 任务描述 / ## 执行记录 / ## 委派）与条目格式**不本地化**——文件协议是承重契约（AGENTS.md §7），改了会破 backstop 正则与 agent 解析；STATUS_LABEL 等展示词走字典但迁移条目 **from→to** 段保持英文状态名。命令名进字典后 COMMAND_ROWS 保持 id+key 为契约字段（name 改由字典取），现有命令注册测试按 id/key 断言不受影响。字典实现零依赖：src/i18n/zh.ts + en.ts + index.ts（t(key) 函数），不引 i18next
- FR-040 新建任务命令（用户需求 2026-08-24 第三轮）：命令面板新增「新建任务」，默认热键 Mod+Shift+N（可改绑）。**不带 commandGate**——创建类命令不依赖当前文件，任意界面可用（六条标注命令的灰掉限制不适用于此）。形态=独立 Modal（非聚焦侧边栏捕获框——那需要先 activateView 扰动布局，且侧边栏 render 全量重建使聚焦选择器脆弱）；单输入框走捕获语法（parseCapture），提交走与捕获框完全相同的 onCapture 缝（VaultSource.createTaskFile），命令建档与捕获框建档字节一致。Enter 防 IME 组合键（isComposing 跳过），非法输入 Notice 同捕获框。注册走 CREATE_COMMAND_ROWS 纯表（镜像 COMMAND_ROWS 防漂移约定）。**2026-08-24 修订（实机验证反馈）**：单输入框改**表单弹窗**——标题（必填）/项目（datalist 下拉列出 knownProjects=store 派生项目名，wikilink 剥壳，与磁盘文件夹 1:1；可手输新名；留空=_未分类）/优先级（下拉 high/normal/low/无）/到期（NL 文本，nlDateParser 解析+实时预览，留空=今天22:00；解析失败拒提交）——修复「捕获语法不写 @项目 就落到错误项目路径」。表单组装走 formToCapture 纯函数（src/view/newTaskForm.ts），产出 Capture 后仍走 createTaskFile 同一缝，三入口（捕获框/命令/表单）建档字节一致
- FR-041 新建项目命令（用户需求 2026-08-24 第三轮）：命令面板新增「新建项目」，默认热键 Mod+Shift+P（可改绑），plain callback 无 gate。**2026-08-24 修订：热键改 Mod+Shift+J**——P 与 Obsidian 核心 Cmd+Shift+P（quick switcher）冲突，核心绑定遮蔽插件默认热键，实机验证打不开弹窗。项目在数据模型上是任务派生的统计概念（FR-035），本命令创建的是 **vault 侧实体**：①主笔记 `<projects_folder>/<名>.md`（type:project / status:active / created:YYYY-MM）②同名 `<名> Dashboard.md`（type:dashboard，开放任务+近期完成两段 dataview，按 project="<名>" 精确过滤，排除 _archive）③根 Dashboard「独立项目」行尾追加 `· [[<名> Dashboard]]`（行首匹配、幂等；行或文件缺失只 Notice 不猜插入点）。模板只搭骨架，role/技术栈等手工内容不代写。路径配置化：projects_folder（默认 01 Projects）+ dashboard_file（默认 Dashboard.md）入 .taskvault/config.json 与设置页（留空=库根/跳过登记），normalizeConfig 去首尾斜杠。项目名校验：空、含 / " [ ] 或换行、同名笔记已存在均拒绝（Notice）。模板三纯函数（projectNoteMd/projectDashboardMd/registerInDashboard）入 src/view/projectTemplates.ts 供单测

- FR-042 README 任务管理思路章（用户需求 2026-08-24）：README 双语各新增固定章「The workflow · 任务管理思路」，位置=Why 之后、Features 之前。内容=使用方法论而非功能列表：捕获快成型慢（inbox 先行、标题短动词短语、上下文进正文）/ DDL 纪律（未言明截止时间默认当天 22:00、date 与 datetime 双粒度语义、改期须显式决策）/ 逾期不消失（不自动顺延、DDL 不改状态、agent 不碰非终态 due）/ done 就地保留（不归档不移动）/ 执行记录即记忆（倒序只追加、决策即时记）/ 每日三遍视角（inbox→今天→本周，过期先清）/ 人机分工（agent 只交 review、done 由人确认）。与 Why 章边界：Why 讲数据模型设计取舍，The workflow 讲日常运营方法论。SC-019 固定章节数由九扩为十（FR-038 的九章节表述由本 FR 扩充，FR-038 原文不改写）

v0.4 增补（对应 FR-043~047，2026-08-24 侧边栏 UI/UX 第二轮；方案母本=vault `02 Knowledge/Task Vault 侧边栏 UIUX 优化方案（2026-08-24）.md`，用户拍板参考系=Linear/Superhuman/Things 3 信息密度派；P1/P2 项——批量展开折叠、空态差异化、行级键盘导航、捕获闪现、start 降权、密度档位、done 计数核对——本轮不做，验证 P0 后另立 FR）：

- FR-043 「现在层」分区头吸顶：侧边栏 review/overdue/today 三个分区的头 `position: sticky; top: 0`（week/done 不吸顶，避免长列表吸顶头连墙）。吸顶头背景=毛玻璃（backdrop-filter: blur(6px) + background: color-mix(in srgb, var(--background-primary) 85%, transparent)），滚动时渐现阴影区分层。纯 CSS 实现，不改 sidebarView 渲染结构（吸顶类挂在既有 tv-section-{bucket} 上）
- FR-044 倒计时心跳：TaskVaultView.onOpen 注册 60s 间隔重渲染（this.registerInterval(window.setInterval(() => this.render(), 60_000))，ItemView 生命周期自动清理）。倒计时/过期徽章数字随时间推进刷新；折叠状态（collapsed/collapsedParents/expandedProjects）已在 render 内保持不丢。心跳纯刷新不触发 store 写入
- FR-045 捕获命令 + 语法教学：①命令面板新增「捕获任务」默认热键 Mod+Shift+I（I=Input；字母 I 与既有 L/D/C/K/S/A/M/J/N/P 无冲突，吸取 FR-040/041 热键被核心遮蔽两次的教训，合并前实机验证触发）。行为=激活侧边栏视图并聚焦捕获框全选（activateLeaf 后 focus+select；视图未开时先 activateView）。②捕获框 placeholder 从单条固定文案改为轮换语法示例数组（i18n 字典 capture.examples，每次 render 随机取一条，展示 `!high @project #tag 明天3点` 形态教学），IME isComposing 守卫保持
- FR-046 行降噪（本 PR 唯一动 taskRow.ts 的项，独立交付）：行内信息分两层。**常驻层**=色条+勾选框+标题（升第一行主位）+p0（仅 high 显示）+倒计时/过期徽章+agent 相位徽章+➤ assignee+waiting/blocked 标记——分诊信号全保留。**hover 显影层**=#tag / repo/* / project / area chips + p1/p2/p3 优先级 + 🛫 start 徽章——组织性信息降级（CSS opacity 0→1 过渡显影，不占常驻布局）。行内 project chip 与项目分组头双重显示由此消除（分组头是唯一项目名载体）。标题不再被 tags 行挤到第二行，常态行高 3 行→2 行（有状态信号）/1.5 行（干净行）。taskRow 渲染顺序重排为：rail → title 行（含常驻信号）→ dates 行 → hover 行
- FR-047 分区计数语义化：侧边栏分区头计数按桶分色——overdue 计数 ≥1 渲染红底徽章（复用 tv-overdue 样式 token）、review ≥1 紫底（复用 review 轨色）、today ≥1 accent 底、week/done 及计数为 0 时保持 tv-count 灰。计数是「哪个区在烧」的扫视信号，非装饰

v0.5 增补（2026-08-25 委派体验两痛点：会话续接 + 决策选择化，用户拍板）：

- FR-048 委派会话续接：委派不再总是冷启动。会话锚点按 agent 确定性生成——CC=首派 `claude -p --session-id <TASK_ID>`（任务 id 即 UUID，直接做会话 ID）、续派 `claude -p --resume <TASK_ID>`；Codex=固定线程名 `tv-<TASK_ID>`（续派 `codex exec resume tv-<TASK_ID>`，线程不存在则新建）；Hermes=frontmatter 可选 `session:` 字段（**hook 维护，agent 协议禁手写**，类比 dispatched 禁令），有值则 `hermes -z --resume <session>` 续接。插件侧：①delegatePanel 对已派发任务（dispatched 存在）显示「续接会话」状态标识，textarea 预填「针对上次产出，补充意见：」而非旧指令全文；②`## 委派` 区由 upsert 覆盖改为**轮次追加**（新指令在上，历史轮保留，轮次头 `### 第N轮 YYYY-MM-DD` 或等价可解析格式）；③hookRunner 占位符新增 `{TASK_SESSION}`（同步 TV_TASK_SESSION 环境变量，取 frontmatter session 值，无则空串）。降级保护：resume 失败（会话被清理/不存在）→ hook 降级起新会话，执行记录补一条「会话丢失，冷启动」。兜底 cron（dispatch_backstop）补派同样优先 resume。外部 tv-dispatch-hook.sh（~/.hermes/scripts，仓外运维件）随本 FR 改造，不进本仓；AGENTS.md §2 占位符表同步。委派协议文档（vault《任务系统规范》第 5 节）由 maintainer 同步
- FR-049 review 一键确认：status=review 的任务在侧边栏行内与详情弹层渲染两操作「✅ 确认完成」「↩ 打回 doing」，点击走 setStatus canonical seam（actor=user，FR-030 本就允许 review→done / review→doing），迁移条目由 seam 自动落盘。与 Reminders 勾选确认通道（FR-023）并存不冲突。目的：最高频决策（复核）从「打开文件手打」降为一键
- FR-050 决策点协议与渲染：任务文件新增可选标准区 `## 决策点`，行格式 `- [ ] Dn <选项描述>`（同 Dn 前缀 = 互斥选项组；勾选后 `- [x]` + 行尾 ` ✅ YYYY-MM-DD`）。写入方 = agent（需要用户拍板时问询）或 user 手写；agent 侧协议进 skills/task-vault-agent/SKILL.md，vault《任务系统规范》由 maintainer 同步（不进本仓）。插件侧：①侧边栏新增「待你决策」聚合区（扫描含未勾选决策点的任务，计数入分区头）；②详情弹层把决策点渲染成按钮组（同 Dn 组互斥；点选 = 勾选项 + 行尾补 ✅ 日期 + 自动落一条 kind=决策、actor=user 的执行记录，正文 = `Dn <所选选项>`）；③保持原生 markdown checkbox 语义——Obsidian 阅读视图零插件也能点，agent 读文件零新解析器（与 FR-030a 同哲学：确定性结构优先于自然语言）
- FR-051 执行记录决策徽标：详情弹层执行记录时间线中 kind=决策 的条目加徽标/左侧边框高亮（紫系，与 review 状态轨呼应）；评论/卡点维持现状。纯展示层

明确不在 v1（越界即拒绝）：递归任务、看板、多用户、外部数据库、移动端 Obsidian 支持、任务关系图。统计面板原在 v1 排除项中，v0.3 起按 FR-035/036 纳入（项目统计与日历视图）。

## Assumptions（默认已选，可否决）

1. 任务文件目录 = `03 Tasks/<项目>/<YYYY-MM-DD>/` 两级；日文件归档至 `03 Tasks/_archive/`（FR-025）
2. hook ledger 与运行时状态放 `vault/.taskvault/`（插件与 Python 同步器共用的唯一 JSON，原子写）
3. 弹窗实现取 Obsidian Modal（居中快捷弹窗），非锚定气泡——行为验收以 SC-010 为准，实现形态不作约束
4. 同步器保持进程外 Python（cron */5），插件内不做 Reminders 同步——Obsidian 关闭时管道仍活
5. 全天默认提醒 09:00、兜底派发 30min、今天区 09:00 起算，均入设置项

## Open Questions

无 `[NEEDS CLARIFICATION]`——需求已经两轮 grill 定稿；上列 5 条假设按默认执行，否决任意一条再回来改 spec。
