# PRE-MERGE AUDIT — PR #28 `feat/h13b-form-hotkey` @ 450cff5 (base main@7ee4319)

- **Blast radius**: low-medium（单插件 UI/热键修订，无数据迁移、无新依赖、无 API 变更；但触碰「建档字节一致」承重缝 createTaskFile）
- **Reviewer**: independent subagent（非作者），无人值守模式
- **Scope**: diff 约 333+/26-，9 文件（src/view/newProjectModal.ts、src/view/newTaskForm.ts 新增、src/main.ts、i18n zh/en、styles.css、tests×2、docs/spec.md）
- **Tier**: Standard feature（全 lens 1/1.5/2/3/4/5）

## Gate 0 — presubmit（实跑）

- `npx tsc --noEmit`：**PASS**（0 error，exit 0）
- `npx vitest run`：**PASS**（25 files / **452 tests** 全绿，538ms）
- 经验探针（临时 vitest 文件，跑完即删，未留痕 repo）：8 组合法 NL due 输入全部全消耗通过 formToCapture；`project:'a/b'` 原样进 capture.project（R1 实锤）。输出见 §1.2/§1.3。
- 分支状态：worktree 干净（仅 untracked .pr-body-h13b.md 笔记，不入库）；基于 main@7ee4319 无冲突
- 零新依赖（package.json/package-lock.json 无 diff，wc -l = 0）→ SCA 不适用

## Lens 1 — Correctness & readability

### 1.1 热键 P→J（SC-022 / FR-041 修订）

- CREATE_COMMAND_ROWS `new-project` key P→J：src/view/newProjectModal.ts:37，注释写明与核心 Cmd+Shift+P（quick switcher）冲突的修订原因（:33-35）。new-task 仍 N（:36）。✅
- 存量测试同步：tests/createCommands.test.ts:19 `'new-project:J'`。✅
- J 与六条标注命令 L/D/C/K/S/A 无字母冲突（commands.ts 未动）；J 与 Obsidian 常见核心默认无已知 Mod+Shift 冲突。✅

### 1.2 formToCapture 全消耗校验（dueText 误拒风险）

核心问题：`nl.consumed` 非空 → badDue（src/view/newTaskForm.ts:57）。逐类验证 parseNlDate（src/time/nlDateParser.ts）的 consumed 语义：

- 「明天15:00」：date 段消费「明天」（:80-85），time 段消费「15:00」（:102-108）→ consumed='' → ✅通过
- 「8月26日 3点」：date 段 `(\d{1,2})月(\d{1,2})[号日]?` 消费日期（:58），time 段点语法（:110）→ consumed='' → ✅通过
- 「明天 下午3点」「周五 18:30」「2026-08-26」「15:00」均全消耗 → ✅
- 「明天 顺便」：consumed='顺便' → badDue，符合表单语义（due 字段必须是纯时间短语；捕获框把剩余文字当标题是另一种契约）→ 设计意图明确且有测试（tests/newTaskForm.test.ts:62-67）。✅
- 边界：`validMD` 拒绝 13月40日（validMD false → 不 remove → 后续段不匹配 → 无 dayDate 无 time → parseNlDate 返 null → badDue）。✅
- 已知语法怪癖（非本 PR 引入）：裸「3点」= 凌晨 3 点（无 period 词不换算 pm）——测试 :93 明确固化 `明天3点→03:00`，previewDue 实时预览让用户在提交前看到解析结果，风险被预览缓解。Nit 级。

**判定：PASS**。全消耗校验不会误拒合法 NL 时间输入——8 组实测探针输出：

```
OK: 明天15:00 -> 2026-08-25T15:00 consumed=[]
OK: 8月26日 3点 -> 2026-08-26T03:00 consumed=[]
OK: 明天 下午3点 -> 2026-08-25T15:00 consumed=[]
OK: 周五 18:30 -> 2026-08-28T18:30 consumed=[]
OK: 2026-08-26 -> 2026-08-26 consumed=[]
OK: 15:00 -> 2026-08-24T15:00 consumed=[]
OK: 后天早上9点半 -> 2026-08-26T09:30 consumed=[]
OK: 下周三 14:00 提前30分钟提醒 -> 2026-09-02T14:00 remind=30m
```

### 1.3 knownProjects 与 projectFolder 的 1:1 身份推导

- knownProjects（newTaskForm.ts:30-42）：project 字段 wikilink 剥壳（`[[x]]`→x）+ repo/* tag，**不做 sanitize**。
- projectFolder（src/store/taskPaths.ts:20-28）：同样的剥壳/repo 顺序，但**过 sanitize**（:49-56，strip `/\"<>|:` 控制字符、去首点、折叠空白）。
- 选中 datalist 里的名字（来自已索引任务）→ capture.project=原名 → 落盘 projectFolder(原名)。已存在的项目名必然已经被 sanitize 过一次（首次建档时），所以 datalist 名本身就是 sanitize 前身==sanitize 后身（sanitize 幂等：对已清洗名字再跑一遍不变）。**选中路径 1:1 成立。**
- **手输新名不对称（实测实锤）**：探针跑 `formToCapture({project:'a/b'})` → `capture.project = "a/b"` 原样透传。手输 `a/b` → projectFolder sanitize 成 `a b` 落盘 `03 Tasks/a b/`，但 frontmatter `project: a/b` 保留原值。下次重扫 store，knownProjects 又会给出 `a/b`（未 sanitize）——datalist 与磁盘文件夹名出现漂移；且「改 project 迁移文件」路径下 frontmatter 原值和文件夹名永远隔一层 sanitize。功能上不丢文件、不崩（sanitize 兜底保证路径合法），但违背 FR-040 修订声明的「项目下拉名与 03 Tasks 磁盘文件夹 1:1」。
- 对比：NewProjectModal 项目名含 `/ " [ ]` 换行直接拒绝（newProjectModal.ts:179 / i18n cmd.newProjectInvalid），NewTaskModal 项目字段无同类校验——两个入口校验不对称。

**判定：Required 发现 R1**（详见发现清单）：手输项目名不做与 NewProjectModal 对齐的非法字符校验（或不做 sanitize 后回写），导致「名称≠文件夹」漂移。修复建议（二选一）：
  a) NewTaskModal 项目字段在 submit 时对 trim 后值跑与 NewProjectModal 相同的 `/[/"\[\]\n]/` 拒绝（最省、语义一致）；或
  b) formToCapture 产出 capture.project 前过 taskPaths 的 sanitize（需导出），保证 frontmatter 值==文件夹名。
  建议 a——b 会静默改用户输入，a 与既有 NewProjectModal 行为一致且 Notice 直白。

### 1.4 main.ts 接线与构造签名

- NewTaskModal 新签名 `(app, store, createCapture, t, now?)` 与 main.ts:161-166 调用一致；`this.store` 是 TaskStore 实例（main.ts:78 构造，非 null），`store: TaskStore | null` 的 null 分支只在校验 datalist 时用（newProjectModal.ts:75 三元），null 安全。✅
- `async (capture, now) => void (await this.apiSource.createTaskFile(capture, now))`：await 后 void——异常被 Promise 拒绝，**而 modal.submit() 里 `.catch` 挂在这个返回的 Promise 上**（newProjectModal.ts submit: `await this.createCapture(...).catch(...)`），链路是 submit await 内层 async fn，内层 await createTaskFile 抛错 → 内层 promise reject → submit 的 .catch 捕获 → Notice。✅ 无未处理 rejection。
- 顺带确认 createTaskFile 的 `-2/-3` 撞名后缀、ensureDir 幂等（vaultSource.ts:84-96）——与捕获框入口完全同一函数，**三入口字节一致成立**（sidebar onCapture main.ts:87-90 也走 source.createTaskFile）。✅
- 提交时序：`this.close()` 在 `await createCapture` **之前**（submit 内先 close 后 await）——旧实现也是先 close 再 fire-and-forget；若建档失败只剩 Notice，输入已丢。与捕获框行为（不清空/保留文本）略不同，但 modal 关闭后表单值本就拿不回来，属可接受的既有模式。Nit 级。

### 1.5 Enter 绑定与 select 缺口

- title/project/due 三个 input 都绑 keydown Enter（isComposing 防透传）→ submit。重复绑定是「任一字段回车即提交」，不是重复提交：submit 无防重入，但 Enter 在 keydown 一次只在一个聚焦元素触发，且 close() 幂等。✅
- priority `<select>` 无 Enter 绑定：macOS Obsidian 中 select 聚焦时 Enter 通常无默认提交行为 → 用户必须点回 title/due 再回车，或……没有提交按钮！**表单没有显式 submit 按钮**，select 聚焦时 Enter 无效、鼠标用户也没有可点击的确认按钮，只能 Tab/点回输入框再 Enter。可发现性缺陷。**Required 发现 R2**：加一个提交按钮（或给 select 也绑 Enter）。旧单输入框 modal 无此问题，本 PR 重写成多字段表单后引入。

### 1.6 Escape / focus

- Esc 关闭走 Modal 默认；titleInput.focus() 打开即聚焦。✅

## Lens 1.5 — Reuse / non-duplication

- `formToCapture`/`previewDue`/`knownProjects` 是新纯函数，但都薄封装既有件：parseNlDate、Capture 类型、captureToTask 默认 due 兜底（'' → omit due → captureToTask:85 今天22:00）——正确复用而非重造。✅
- wikilink 剥壳正则 `^\[\[(.+)\]\]$` 在 newTaskForm.ts:34 与 taskPaths.ts:18（PROJECT_LINK）**重复定义**。三处了（taskStore.ts:248 还有第三份变体）。属既有债务的第三/四处复制，Nit：应导出复用 taskPaths 的。不阻塞（三行正则，非业务逻辑）。
- consumed 清洗逻辑 `replace(/\s+/g,' ').trim()` 在 newTaskForm.ts:57/74 与 nlDateParser.ts:144 重复——同样 Nit。
- searched：grep projectFolder/wikilink 剥壳/repo tag 推导/preview 类 helpers——除上述小重复外无重造轮子。✅

## Lens 2 — Security

- 无新输入面 beyond 既有：表单输入 → 纯函数 → createTaskFile（既有缝）。无 eval/HTML 注入（全部 createEl/setText，Obsidian DOM API 转义）。✅
- 路径穿越：手输项目名含 `../` → sanitize 把 `/` 换空格 → `.. ` → 去首点规则 `^\.+` 只去**纯点前缀**，`..` 全点是会被去的（`'..'`→`''`→_未分类）；`a/../b`→`a .. b` 无穿越。✅ 1.3 的 R1 是一致性问题不是安全问题。
- 无 secret/PII 新增。✅

## Lens 3 — Supply-chain

- package.json / package-lock 无 diff（`git diff main...HEAD -- package.json package-lock.json` 空）。零新依赖。✅ 无 SCA 项。

## Lens 4 — Test adequacy

- 新 tests/newTaskForm.test.ts：热键改绑断言（:11-15，对应 SC-022 修订项①）+ 字典键双语解析（:18-23）+ formToCapture 6 条（title-only / 全字段 / emptyTitle / badDue×2 / 空白 project）+ knownProjects 派生去重排序（:77-86）+ previewDue（:90-97）。共 10 个 it。与 PR 声称一致。✅
- SC-022 修订项对应性：①P→J ✓（:11）②表单建档路径 ✓（formToCapture 组装 Capture；但**无 modal 级 e2e**——Obsidian Modal 本就难测，纯函数已覆盖组装逻辑，可接受）③「与捕获框建档字节一致」——formToCapture 产出的 Capture 形状与 parseCapture 产出同构，落盘走同一 captureToTask，字节一致性由同缝保证 + 存量 capture 测试背书。✅
- **缺口（Nit）**：R1 对应的非法项目名（含 `/`）无测试——修复 R1 时应补一条 `formToCapture` 拒绝/清洗含 `/` 项目名的用例。
- 存量 createCommands.test.ts 同步改 J。✅ 无 skip/only/注释断言。

## Lens 5 — Operational readiness

- 回滚：单 commit revert 即回 PR#25 形态，无数据迁移。✅
- 观测：失败路径 Notice（capture.failed / dueInvalid / emptyTitle）。✅
- 数据安全：不触碰存量文件，只新增建档路径（同 createTaskFile）。✅
- 文档：docs/spec.md SC-022/FR-040/FR-041 均带 2026-08-24 修订注记，与实现一致（热键 J、表单形态、留空语义、badDue 拒提交、knownProjects 1:1 声明）。README 未提及热键字母（grep 确认无 P/J 具体字母入 README）→ 无需改。✅
- 样式：.tv-form-* 6 条规则全部用 Obsidian CSS 变量（--font-ui-smaller/--text-muted/--background-modifier-border/--radius-s 等），无硬编码色，无越界选择器。✅

## 发现清单

| # | 级别 | 位置 | 发现 | 建议 |
|---|------|------|------|------|
| R1 | **Required** | newTaskForm.ts:53 / newProjectModal.ts 表单项目字段 | 手输项目名无非法字符校验，`a/b` 经 projectFolder sanitize 落盘为 `a b`，frontmatter 留 `a/b` → datalist 名与磁盘文件夹漂移，违背 FR-040「1:1」修订声明；且与 NewProjectModal 的 `/ " [ ]` 拒绝不对称 | submit 前对 project 值跑与 NewProjectModal 相同的拒绝校验（复用 cmd.newProjectInvalid 文案或新键），+1 测试 |
| R2 | **Required** | newProjectModal.ts NewTaskModal 表单 | 无提交按钮且 priority select 无 Enter 绑定：select 聚焦时 Enter 不提交、无按钮可点，键盘/鼠标均可卡住 | 加显式提交按钮（最小），或补 select Enter 绑定 |
| N1 | Nit | newTaskForm.ts:34 | wikilink 剥壳正则第 N 份复制（taskPaths.ts:18、taskStore.ts:248 已有） | 导出共享 |
| N2 | Nit | newTaskForm.ts:57/74 | consumed 清洗表达式与 nlDateParser.ts:144 重复 | 同上 |
| N3 | Nit | nlDateParser 既有 | 裸「3点」=03:00 语义怪癖被表单继承（测试固化）；previewDue 缓解 | 文档/后续 grammar 迭代 |
| N4 | Nit | newProjectModal.ts submit | close() 先于建档 await，失败时输入已丢（沿旧模式） | 可选：失败时保输入 |

## Sign-off

```
PRE-MERGE AUDIT — feat/h13b-form-hotkey (PR #28) @ 450cff5
Blast radius: low-medium   Reviewer: independent (non-author, unattended)
Gate 0 (CI green): PASS (tsc 0 errors; vitest 25 files / 452 tests)
1 Correctness/readability: REQUIRED×2 (R1 项目名漂移, R2 select 无提交路径)
1.5 Reuse/non-duplication: PASS (2 Nit 正则复制)
2 Security:               PASS (DOM API 转义, 路径无穿越)
3 Supply-chain:           PASS (零新依赖)
4 Test adequacy:          PASS (10 新用例对应 SC-022 修订项; R1 缺口随修复补)
5 Operational readiness:  PASS (spec 修订注记一致, 样式无越界, 可单 commit 回滚)
DECISION: NEEDS-FOLLOWUP → 修 R1+R2 后 APPROVE-TO-MERGE（两处均为 <30min 局部修复，无架构问题）
```
