# Implementation Plan: Task Vault v1

> 依据 docs/spec.md（FR-###/SC-### 见彼处）。实现按 Phase 顺序推进，每个 Checkpoint 停下来验证。
> 约定：每任务 TDD（先写失败测试）；提交前 `npm test && npm run typecheck` 必须绿；commit message 带 Traces-to。

**Goal:** 单人单机 Obsidian 任务插件：每任务一文件 + UUID 身份 + 八态状态机（含 review 门禁）+ DDL 时间控制 + 侧边栏驾驶舱 + 执行留痕 + hook 体系 + Reminders 同步重写 + 存量迁移。

**Architecture:** 核心域纯函数零依赖（model/time/log/hooks），obsidian API 只进 store/view/main 适配层；进程外 Python 同步器经 `vault/.taskvault/` 与插件共享 ledger；任务文件即数据库。

**Tech Stack:** TypeScript strict + esbuild + vitest（零运行时依赖）；Python 3 + remindctl（外围）。

---

## Phase A — 地基

### Task 1: 仓库脚手架与构建链

**Objective:** 可构建、可测试、可装进 vault 的插件骨架（无功能代码）。
**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `manifest.json`, `styles.css`(空占位), `src/main.ts`(最小 onload), `tests/smoke.test.ts`, `.gitignore`
**Steps:**
1. package.json scripts：`dev`(esbuild watch+复制)、`build`、`typecheck`、`test`(vitest run)、`install:vault`(复制 main.js/manifest.json/styles.css → `<vault>/.obsidian/plugins/task-vault/`)
2. manifest.json：id `task-vault`，minAppVersion 1.13.7，isDesktopOnly true
3. smoke 测试断言 `2+2===4`；跑 `npm test` 绿；`npm run build` 产出 main.js
4. esbuild 外部化 `electron`/`obsidian`/`@codemirror/*` 等官方 externals
**Verify:** `npm test && npm run typecheck && npm run build` 全绿；产物存在。
**Dependencies:** None
**Traces to:** FR-000（基建）
**[P]:** no  **Size:** M

### Task 2: 数据模型与状态机

**Objective:** Task 类型 schema 常量 + 八态转移表 + actor 感知的 review 硬门禁 + 时间戳维护纯函数。
**Files:**
- Create: `src/model/types.ts`, `src/model/statusMachine.ts`
- Test: `tests/statusMachine.test.ts`
**Steps:**
1. 失败测试：全转移表逐条合法转移（inbox→todo/cancelled、doing→waiting/review/done/cancelled、review→done/doing/cancelled、cancelled→todo 重开…）+ actor 门禁（agent→done 拒绝、agent→review 允许、user→done 允许）+ 非法转移抛错 + 时间戳维护（todo→doing 记 started；→done/cancelled 记 completed；重开清 completed）
2. 实现 `TRANSITIONS` 表 + `transition(task, to, actor, now): TransitionResult`（返回字段补丁+迁移记录行，不落盘）
3. FR 注释标注每条约束
**Verify:** vitest 全绿，覆盖全部 7×7 组合。
**Dependencies:** Task 1
**Traces to:** FR-001, FR-003  **[P]:** no（后续全依赖它）  **Size:** S

### Task 3: 任务文件读写（frontmatter IO）

**Objective:** 任务文件 ↔ 内存对象的序列化/反序列化 + 原子写盘。
**Files:**
- Create: `src/util/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`
**Steps:**
1. 失败测试：完整 schema 序列化→解析往返一致；date/datetime 双粒度保真；缺失可选字段容忍；非法值（status 拼错、due 格式错）解析时报错并给出文件定位；**写盘走 temp+rename 原子替换**（mock fs 验证调用序列）
2. 实现：轻量 YAML 子集解析器（只支持 schema 用到的形态：标量/列表/嵌套一层 mirror 块）——不引 js-yaml，保持零依赖；或若判定自研成本过高，在 PR 里申请引入 js-yaml（Boundaries: Ask first）
3. body 保留：`## 执行记录` / `## 委派` 区按区块切分读写
**Verify:** 往返语料 20 条全过；损坏文件不崩（返回错误对象）。
**Dependencies:** Task 2
**Traces to:** FR-001, FR-002, FR-018(区块)  **[P]:** no  **Size:** M

---

## Phase B — 核心逻辑（可并行）

### Task 4: 执行记录协议

**Objective:** 四类条目（进展/[决策]/[评论]/[卡点]）+ 迁移记录的生成与追加。
**Files:**
- Create: `src/log/executionLog.ts`
- Test: `tests/executionLog.test.ts`
**Steps:**
1. 失败测试：`- 2026-08-19 14:32 [hermes] [todo→doing] 内容` 格式逐字段；追加进已有区块末尾；无区块时创建（含标题）；不触碰其他 body 内容
2. 实现 `appendEntry(body, {ts, actor, kind?, from?, to?, text})`
**Verify:** 格式语料全绿。
**Dependencies:** Task 3
**Traces to:** FR-018  **[P]:** yes（与 Task 5/6 并行）  **Size:** S

### Task 5: 时间规则引擎

**Objective:** due/start/remind 语义 + 五分区推导 + 倒计时/超期计算。
**Files:**
- Create: `src/time/timeRules.ts`
- Test: `tests/timeRules.test.ts`
**Steps:**
1. 失败测试（边界语料）：今天=23:59 的 timed 任务进"今天"；start=明天的任务不进"今天"进"本周"；date-only 当天=今天、次日=过期 1d；remind 偏移换算（30m/2h/1d、全天默认 09:00）；倒计时 `剩 3h12m`/`超期 2d` 格式化；done 任务永不进过期区；**任何输入不产生状态变更副作用**（纯函数断言）
2. 实现：`bucketOf(task, now)`、`countdownLabel(task, now)`、`remindMoment(task)`
**Verify:** 边界语料 ≥40 条全绿（SC-007 的单测面）。
**Dependencies:** Task 2
**Traces to:** FR-006, FR-007, FR-008, SC-007  **[P]:** yes  **Size:** M

### Task 6: 中文 NL 时间解析器

**Objective:** 捕获框里的自然语言时间 → {start?, due, dueIsDateTime, remind?}。
**Files:**
- Create: `src/time/nlDateParser.ts`
- Test: `tests/nlDateParser.test.ts`（≥60 条语料，now 固定注入）
**Steps:**
1. 语料先行：相对日（今天/明天/后天/大后天/下周三/周五）、时刻（9点/14:30/明早9点/明晚8点/下午3点/上午10点半）、组合（周五 14:00/明天下午5点前）、偏移（提前30分钟提醒/提前1天提醒）、绝对（8/25/8月25号/2026-09-01）+ 否定例 ≥8 条（如"等等再说"、"下午"无日归属的默认规则）
2. 失败测试 → 实现（封闭模式集正则管线，`now` 参数注入）；解析失败返回 null（原文进 inbox 由调用方处理，不丢字）
**Verify:** 语料通过率 ≥95%（SC-006）。
**Dependencies:** None（纯函数）
**Traces to:** FR-009, SC-006  **[P]:** yes  **Size:** M

---

## Phase C — 第一条竖切：捕获 → 文件 → 侧边栏可见

### Task 7: 任务库 store

**Objective:** 扫描 `03 Tasks/*.md` 建内存索引 + 文件监听增量更新 + 查询（分区/blocked 推导/子任务树）。
**Files:**
- Create: `src/store/taskStore.ts`（查询逻辑写成可注入文件系统接口的纯函数核心 + obsidian 适配）
- Test: `tests/taskStore.test.ts`（内存 FS 注入）
**Steps:**
1. 失败测试：目录扫描→索引；单文件修改→增量重解析；blocked-by 指向未终态任务→blocked（FR-004），依赖 done→自动回 todo/doing（保持原 doing 则回 doing）并刷新；parent 树展开 x/y 进度；损坏文件隔离不炸全库
2. obsidian 适配层：metadataCache + vault.on('modify'/'delete'/'rename') 接入，debounce 200ms
**Verify:** 注入式单测全绿。
**Dependencies:** Task 2, 3, 5
**Traces to:** FR-004, FR-005, FR-007  **[P]:** no  **Size:** L

### Task 8: 侧边栏驾驶舱骨架（五分区 + 实时刷新）

**Objective:** ItemView 五分区渲染 + store 变更即刷新。
**Files:**
- Create: `src/view/sidebarView.ts`, `src/view/taskRow.ts`(本任务只做只读行渲染)
- Modify: `src/main.ts`(注册 view+Ribbon+命令), `styles.css`(分区/状态色基础)
**Steps:**
1. 五分区按 timeRules 分组渲染；timed 倒计时徽章；blocked 置灰；waiting 黄标
2. store 刷新事件 → 视图重渲染（保持折叠态）
3. 手动验证清单：开 Obsidian → 命令面板 Task Vault: Open → 五分区出现；改一个任务文件 due → 3s 内移动分区
**Verify:** 手动清单通过 + `obsidian eval` 查 DOM 分区节点存在（SC-005 部分）。
**Dependencies:** Task 7
**Traces to:** FR-011, FR-008  **[P]:** no  **Size:** L

### Task 9: 快速捕获框

**Objective:** 顶部输入 → 解析语法 → 建文件 → 出现在收件箱 ≤1s。
**Files:**
- Modify: `src/view/sidebarView.ts`
- Test: `tests/captureParse.test.ts`
**Steps:**
1. 失败测试：`!high`/`@project`/`#tag` 提取与剥离；NL 时间接入（Task 6）；无时间 → inbox 无 due；标题为空拒绝
2. 实现：解析→新 Task（UUID、created、source:user）→ store 写文件 → 收件箱即时可见
**Verify:** SC-001 手动通过（含中文时间语料抽查）。
**Dependencies:** Task 6, 8
**Traces to:** FR-010, FR-012, SC-001  **[P]:** no  **Size:** M

**## Checkpoint C（人工验证）：** 在真 vault 上跑：捕获 5 条（各类型时间）→ 检查文件生成/frontmatter 正确 → 分区/倒计时正确 → 评审后再进 Phase D。

---

## Phase D — 交互与 hook

### Task 10: 行内操作

**Objective:** 勾选完成、日历改期（双粒度）、状态菜单、子任务折叠。
**Files:**
- Modify: `src/view/taskRow.ts`, `src/view/sidebarView.ts`, `styles.css`
**Steps:**
1. 勾选 → transition 到 done（走状态机，落迁移记录）；改期弹层 date/datetime 双模式；状态菜单只列合法转移（非法项不渲染）；子任务折叠记忆
2. 手动清单：勾选/改期/切状态/折叠各一遍 + 文件里字段与执行记录同步正确
**Verify:** 手动清单 + 文件回读断言。
**Dependencies:** Task 8, 4
**Traces to:** FR-013, FR-003  **[P]:** yes（与 Task 11 并行）  **Size:** M

### Task 11: 设置面板 + 图例

**Objective:** hook 命令模板/默认提醒时刻/兜底阈值可配；图例面板。
**Files:**
- Create: `src/settings.ts`, `src/view/legend.ts`
- Modify: `src/main.ts`, `styles.css`
**Steps:**
1. PluginSettingTab：terminal/dispatch 命令模板（默认空=禁用）、全天默认提醒时刻、兜底分钟数
2. 图例面板：状态×图标×颜色 + 时间徽章含义；命令面板可呼出
**Verify:** 设置改→行为变（hook 模板传入 Task 12 断言）；图例渲染手动检查。
**Dependencies:** Task 8
**Traces to:** FR-016, FR-022  **[P]:** yes  **Size:** S

### Task 12: Hook 体系（终态/派发/手动总结 + ledger）

**Objective:** hook fire + 幂等 ledger + main 装配（状态机转移处触发）。
**Files:**
- Create: `src/hooks/hookRunner.ts`
- Modify: `src/main.ts`, `src/model/statusMachine.ts`(转移结果带事件), `src/store/taskStore.ts`(落盘后 fire)
- Test: `tests/hookRunner.test.ts`（child_process 注入 mock）
**Steps:**
1. 失败测试：done→fire terminal，参数 TASK_PATH/TASK_ID/TASK_STATUS/TASK_TITLE/TASK_ASSIGNEE 齐全；同任务同终态二次进入不 fire（ledger 命中）；cancelled 同理；手动总结不写 ledger；dispatch fire 后更新 dispatched；模板空=禁用且无副作用
2. ledger：`vault/.taskvault/ledger.json` 原子写；key=`id:terminal`
**Verify:** 单测全绿 + 手动配 `echo` 命令实测 fire 一次。
**Dependencies:** Task 11(设置), Task 10(转移路径)
**Traces to:** FR-019, FR-020, FR-021, SC-004  **[P]:** no  **Size:** M

### Task 13: 任务详情弹窗与委派

**Objective:** Modal 弹窗：属性编辑 + 快速填入 + 委派闭环。
**Files:**
- Create: `src/view/detailPopover.ts`
- Modify: `src/view/taskRow.ts`(点击热区), `styles.css`
**Steps:**
1. 头部标题就地编辑；快捷属性点选写 frontmatter；决策/评论/卡点单选+回车→执行记录追加 ≤1s（SC-010）
2. 委派区：agent 单选（推荐序 CC>Codex>Hermes）+ 指令框 → `## 委派` 区 + assignee/dispatched + dispatch hook
3. 底部：打开文件 / 复制 obsidian:// 链接 / 手动总结按钮
**Verify:** SC-009/SC-010 手动通过。
**Dependencies:** Task 10, 11, 12
**Traces to:** FR-014, FR-015, SC-009, SC-010  **[P]:** no  **Size:** L

**## Checkpoint D（人工验证）：** 完整走一遍：捕获→排期→doing→弹窗记决策→委派(mock agent)→勾完成→hook fire 一次→执行记录完整时间线。评审后进 Phase E。

---

## Phase E — 迁移与同步

### Task 14: 存量迁移脚本

**Objective:** 31 条文本行任务 → 任务文件；历史日文件 → `_archive/`。
**Files:**
- Create: `scripts/migrate_legacy_tasks.py`
- Test: `tests/migrate_corpus/`(样本行 + 期望 frontmatter 快照，用 Python 断言脚本跑)
**Steps:**
1. 解析：`- [ ]/[x]`、`📅/✅/🛫/➕` 日期、`#src/*`、`#hermes`、`#repo/*`、行内 HTML 注释（归档说明→执行记录）、`[[链接]]`（→project/area 猜测，存疑留 tags）
2. `--dry-run`：逐条报告（来源文件:行 → 目标文件名 + 解析出的字段 + 存疑项），不写盘
3. `--apply`：写任务文件（UUID/created 沿用 ➕ 或文件日期）+ 日文件 move 进 `03 Tasks/_archive/`（逐字节校验后删源）
4. 已完成历史行**不**生成任务文件（留在归档日文件里）
**Verify:** dry-run 报告人工过目 → apply → 31 条全迁 + `_archive/` 校验和一致（SC-003）。
**Dependencies:** Task 3（格式对齐）
**Traces to:** FR-025, SC-003  **[P]:** yes（与 Task 15 并行）  **Size:** M

### Task 15: Reminders 同步器重写

**Objective:** UUID↔UUID 映射的双向同步，替代 obsidian-reminders-sync.py。
**Files:**
- Create: `scripts/reminders_sync.py`, `scripts/tv_common.py`(frontmatter/ledger 共用读写)
**Steps:**
1. 读 `03 Tasks/*.md` frontmatter（非插件进程，Python 侧 YAML）；mirror 块读写；ledger 共用（terminal 补 fire）
2. 行为：新建(open+有 due)→建镜像；改 due→改期（date=全天/datetime=定时，+8h 规则）；Obsidian done→complete 镜像；Reminders 完成→回写 done+补 fire terminal（Obsidian 关闭场景）；Siri 新增→回流建 inbox 任务(source:siri)；孤儿（mirror 指向不存在的 id）→报告不自动删
3. 稳态：`python3 scripts/reminders_sync.py` 两轮，第二轮零动作输出
4. 上线切换：停旧 cron `obsidian-reminders-sync` → 新脚本接管 → 观察 48h（先并行跑 dry 对账再切）
**Verify:** SC-002（改 title/due/tags 稳态零新建零误勾）+ 双端勾选/回流手测 + 稳态断言。
**Dependencies:** Task 12（ledger 协议）, Task 14（存量有镜像后再切）
**Traces to:** FR-023, FR-024, SC-002, SC-004  **[P]:** yes  **Size:** L

**## Checkpoint E（人工验证+灰度）：** 真数据迁移完成、新旧同步器切换 48h 观察零事故，再进 Phase F。

---

## Phase F — 规范与退役

### Task 16: 《任务系统规范》文档

**Objective:** 人与 agent 共同遵守的规范文档（随插件交付 + 同步进 vault）。
**Files:**
- Create: `docs/任务系统规范.md`（构建时复制到 vault 02 Knowledge/）
**Steps:** 状态机图、字段表、时间语义、写入协议（agent 版：改 frontmatter+追加记录，禁碰 mirror）、委派协议（接单/执行/终态）、图例。以 spec §FR-017 为纲。
**Verify:** 文档评审通过 + vault 侧同步存在。
**Dependencies:** Task 13（协议定型后写）
**Traces to:** FR-017  **[P]:** yes  **Size:** S

### Task 17: cron/agent 协议适配与旧链退役

**Objective:** 6 个 cron 中产生/勾选任务者改写新协议；旧链路标记退役。
**Files:**
- Modify: `~/.hermes/personal-skills/skills/obsidian-vault/SKILL.md`（§任务格式 作废→指向新协议）、`obsidian-task-lifecycle` skill、相关 cron prompt
- Create: `docs/retirement-checklist.md`
**Steps:**
1. 逐 cron 盘点（早报学习注入/夜间复盘/早上巡查/GitHub巡查/周蒸馏）：改写注入格式为任务文件协议；新增兜底派发 cron（规格见 FR-021，**上线前需用户确认**——Boundaries: Ask first）
2. Dashboard DQL 面板停用标记；#hermes→ntfy→订阅器链路退役项写入 checklist（新任务不再写 #hermes 触发标签）
**Verify:** 每个 cron 手动 run 一次产出正确格式的任务文件；旧触发链 48h 零触发。
**Dependencies:** Task 15（新系统稳态后）
**Traces to:** FR-026  **[P]:** yes  **Size:** M

**## Checkpoint F（终验）：** spec-convergence-audit（FR/SC ↔ 任务 ↔ 实现 全对齐）→ coding-verify 五轴评审 → 全量测试绿 → 用户终验。

---

## 任务总览

| # | 任务 | Size | 并行 | Traces |
|---|------|------|------|--------|
| 1 | 脚手架 | M | — | FR-000 |
| 2 | 模型+状态机 | S | — | FR-001/003 |
| 3 | frontmatter IO | M | — | FR-001/002 |
| 4 | 执行记录 | S | P | FR-018 |
| 5 | 时间规则 | M | P | FR-006/007/008 |
| 6 | NL 解析器 | M | P | FR-009 |
| 7 | store | L | — | FR-004/005/007 |
| 8 | 侧边栏骨架 | L | — | FR-011 |
| 9 | 捕获框 | M | — | FR-010/012 |
| 10 | 行内操作 | M | P | FR-013 |
| 11 | 设置+图例 | S | P | FR-016/022 |
| 12 | Hook 体系 | M | — | FR-019~021 |
| 13 | 详情弹窗+委派 | L | — | FR-014/015 |
| 14 | 迁移脚本 | M | P | FR-025 |
| 15 | 同步器重写 | L | P | FR-023/024 |
| 16 | 规范文档 | S | P | FR-017 |
| 17 | 协议适配+退役 | M | P | FR-026 |

依赖主线：1→2→3→{4,5,6}→7→8→9 →{10,11}→12→13 →{14,15}→16→17。

---

## Phase G — Convergence（Checkpoint F 终验收敛，2026-08-21 审计产出）

> spec-convergence-audit Mode B 全库审计后的可执行残留。本轮已当场修复的不在此列（见执行记录 08-21 09:35/09:28）。

- [ ] T018 验证早报 cron 第四步健康注入首跑 per FR-026 (partial) — prompt 已加、08-21 当日任务系手工补建，明晨 02:00 首跑待验
- [ ] T019 实测 lark save_review_task 新格式产出 per FR-026 (partial) — 代码已迁 Task Vault 格式并隔离测试通过，下次早会实测
- [x] T020 验证 auto-update write_reading_todo 新路径首产 per FR-026 (partial) — 08-22 首产合规（路径/frontmatter/两区/幂等均过）；发现并当场修复创建条目时间戳带 T 的契约违规（拆 entry_ts 变量，沙箱全断言通过）✅ 2026-08-23
- [x] T021 修正 spec.md FR-001 与 AGENTS.md §5 的目录布局描述 per FR-001 (contradicts) — 两处仍写「03 Tasks/ 顶层平铺 YYYY-MM-DD-slug」，实际定稿为 项目/日期 两级；连带 Dashboard.md 迁移注记里的 `<项目>/<年-月>` ✅ 2026-08-23
- [ ] T022 处置 3 个非标准文件 per FR-001 (unrequested) — `03 Tasks/2026-08-20.md`（旧格式日文件）、`AUDIT-pr1153.md`（无 frontmatter 审计报告）、`睿源智能/logo/README.md`：留或移待用户拍板，agent 不擅动
- [x] T023 清理迁移期孤儿 Reminders（34 个）per FR-023 (partial) — 契约规定只报告不自动删；列出清单供用户一次性确认删除 ✅ 2026-08-21

---

## Phase H — v0.3 六需求迭代（2026-08-23 启动，任务 36c00435）

> 用户六需求：色条语义 / 快捷命令 / 发布告警 / agent skill+接口 / 项目+日程面板 / Reminders 同步说明。
> 拍板：内置接口、热键 L/D/C/K/S/A、删 Calendar 插件、warning 社区页实测（Review=Satisfactory/18 issues）。

| # | 任务 | 量级 | 测试 | Traces-to | 状态 |
|---|---|---|---|---|---|
| H1 | spec 增补 FR-031~037 + SC-012~018 + 边界修订 | S | — | FR-031~037 | ✅ 2026-08-23 |
| H2 | 色条语义：CSS 八态差异化 + tooltip + 图例重做 | S | manual | FR-031 | ☐ |
| H3 | 六命令 + 默认热键 + README 修正 | M | unit+manual | FR-032 | ☐ |
| H4 | 发布卫生：描述对齐 + 12 条可修 Warning + CONTRIBUTING + attest | S | checker | FR-033 | ✅ 2026-08-23（PR #17，attest 留 H10 发版时做）|
| H5 | agent skill 入仓（skills/task-vault-agent）+ README For AI agents | M | — | FR-034 | ☐ |
| H6 | 内置 localhost API（四端点 + 设置页 + token） | L | unit | FR-034 | ✅ 2026-08-23（PR #21+#22，实机 curl 四端点+门禁 409 验证）|
| H7 | 项目面板（统计卡片 + 项目详情视图） | M | manual | FR-035 | ✅ 2026-08-23（PR #16，实机 11 卡片验证）|
| H8 | 日程面板 + 日历视图（月网格） | L | manual | FR-036 | ✅ 2026-08-23（PR #20，实机 42 格/15 chip/导航验证）|
| H9 | README：Apple Reminders sync 章 + 权限披露章 | S | — | FR-033/037 | ✅ 2026-08-23（PR #14）|
| H10 | 0.3.0 发版：版本号 + tag + release + attest，部署 vault 后删 Calendar 插件 | S | release+部署核验 | FR-033/036 | ✅ 2026-08-24（PR #23，tag/release/三资产 attest 验证过；Calendar 删除待用户确认）|
| H11 | README 双语（中英对照 + 语言切换锚点） | M | — | FR-038 | ✅ 2026-08-23（PR #18）|
| H12 | UI 本地化 i18n（字典层 + 设置页语言下拉 + 全文案覆盖） | M | unit+manual | FR-039 | ✅ 2026-08-23（PR #19，实机 zh/en 双向验证）|
| H13 | 新建任务/新建项目命令（创建类命令 + 项目脚手架 + 路径配置） | M | unit+manual | FR-040/041 | ✅ 2026-08-24（PR #25）|
| H14 | README 任务管理思路章（双语 The workflow + SC-019 九→十） | S | — | FR-042 | ✅ 2026-08-24（PR #26，Codex 审计 APPROVE，npm test 429 绿 + 双语结构脚本核对）|
| H15 | 规范文档补齐 vault 版两节（承重前缀坑 + FR-030a 引用通道） | S | — | FR-017/FR-030a | ✅ 2026-08-24（PR #27，Codex 审计 APPROVE，npm test 442 绿；vault 母本 Nit-1 已同步修）|

技术依赖（非需求顺序）：H2/H3/H4/H5/H9 相互独立可并行（H3/H4/H9 都动 README，按合并序串行 rebase）；H6 依赖 H5 的 SKILL.md 草案定接口语义；H7 依赖 H2 的 STATUS_META 色条语义（chip 复用）；H8 依赖 H7 的 ItemView 骨架模式；H10 最后，前置 = 全部合并 + 部署 vault 稳定（含手动验证清单通过）+ Calendar 删除由用户确认执行。
