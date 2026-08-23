// English UI strings (FR-039). This file is the canonical key set — `zh.ts` is typed against
// `keyof typeof en`, so a missing/extra key is a compile error, and tests/i18n.test.ts asserts
// exact key-set equality at runtime. `{placeholder}` tokens are filled by createT (see index.ts).
//
// Data-layer strings are NOT here: `## 执行记录` / `## 委派` headings, the appendLog from→to
// English status names, and EntryKind values (决策/评论/卡点) are the file contract (AGENTS.md §7)
// and stay identical in every language.

export const en = {
  // Sidebar bucket (section) titles — order: review, overdue, today, week, done.
  'bucket.review': 'To review',
  'bucket.overdue': 'Overdue',
  'bucket.today': 'Today',
  'bucket.week': 'This week',
  'bucket.done': 'Done today',

  // Status labels (menus, legend, popover chips, tooltips).
  'status.inbox': 'Inbox',
  'status.todo': 'To-do',
  'status.doing': 'In progress',
  'status.review': 'To review',
  'status.waiting': 'Waiting',
  'status.blocked': 'Blocked',
  'status.done': 'Done',
  'status.cancelled': 'Cancelled',

  // Sidebar cockpit chrome.
  'sidebar.tasks': '📋 Tasks',
  'sidebar.projects': '📁 Projects',
  'sidebar.empty': '—',
  'sidebar.uncategorized': 'Uncategorized',
  'capture.placeholder': 'Capture a task…  !high @project #tag tomorrow 3pm',
  'capture.emptyTitle': 'Task title is empty',
  'capture.failed': 'Capture failed: {err}',

  // Time badges (countdown / overdue). {time} is the language-neutral duration (e.g. 3h12m, 2d).
  'badge.countdown': '{time} left',
  'badge.overdue': '{time} overdue',

  // Task-action notices (blocked completion, illegal transition, hook failures).
  'action.blocked': "Blocked — can't complete",
  'action.illegalTransition': 'Illegal transition: {from} → {to}',
  'action.dispatchHookFailed': 'Dispatch hook failed: {err}',
  'action.summaryHookDisabled': 'Terminal hook not configured',
  'action.summaryHookFailed': 'Summary hook failed: {err}',
  'action.terminalHookFailed': 'Terminal hook failed: {err}',

  // Task row.
  'row.check': 'Complete',
  'row.waiting': '⏳ Waiting',
  'row.blocked': '⛔ Blocked',
  'row.blockSource': 'Blocked by: {names}',
  'row.statusTooltip': 'Status: {label} ({status})',

  // Agent progress chips (agentProgress phase → label).
  'agent.dispatched': '📡 Dispatched',
  'agent.working': '⚙ Working',
  'agent.stuck': '⛔ Stuck',
  'agent.review': '👁 To review',

  // Legend modal.
  'legend.title': 'Task Vault legend',
  'legend.statusHeading': 'Status',
  'legend.timeHeading': 'Time badges',
  'legend.delegateHeading': 'Delegation',
  'legend.countdownDesc': 'Countdown when under 24h to due',
  'legend.overdueDesc': 'Past due (never shown for done)',
  'legend.delegateDesc': 'Delegated to an agent (assignee ≠ you)',
  'legend.blockedHint': ' (dependencies open — auto-derived)',

  // Detail popover panels + quick-fill + footer.
  'panel.status': 'Change status',
  'panel.quickFill': 'Quick fill',
  'panel.delegate': 'Delegate',
  'detail.notFound': 'Task not found or not indexed',
  'detail.terminalNoTransition': 'Terminal state — no transitions',
  'kind.progress': 'Progress',
  'kind.decision': 'Decision',
  'kind.comment': 'Comment',
  'kind.blocker': 'Blocker',
  'detail.quickPlaceholder': 'Add a note… Enter or click "Fill"',
  'detail.fillBtn': 'Fill',
  'detail.emptyContent': 'Write something first',
  'detail.wroteLog': 'Written to the execution log',
  'detail.copyPrompt': 'Copy task prompt',
  'detail.copyLink': 'Copy link',
  'detail.summary': 'Summarize',
  'detail.copiedPrompt': 'Task prompt copied — paste it to an agent',
  'detail.copiedLink': 'obsidian:// link copied',

  // Delegation panel (shared by popover + command).
  'delegate.placeholder': 'Instruction for the agent (written in full to "## 委派")',
  'delegate.btn': 'Delegate',
  'delegate.emptyInstruction': 'Enter a delegation instruction',
  'delegate.fired': 'Delegated to {assignee}',
  'delegate.disabled':
    '⚠️ Wrote {assignee}, but the dispatch hook is not configured — no agent was started (Settings → Task Vault → dispatch hook)',
  'delegate.failed': '⚠️ Wrote {assignee}, but dispatch failed — no agent was started',

  // Command palette entries + command-driven modals/notices.
  'cmd.notIndexed': 'The active file is not a task (no frontmatter id — not indexed by Task Vault)',
  'cmd.noTargets': '"{label}" has no available transitions',
  'cmd.setStatusTitle': 'Set status · {title}',
  'cmd.delegateTitle': 'Delegate · {title}',
  'cmd.quickLog': 'Log an execution entry',
  'cmd.logDecision': 'Annotate · Decision',
  'cmd.logComment': 'Annotate · Comment',
  'cmd.logBlocker': 'Annotate · Blocker',
  'cmd.setStatus': 'Set status',
  'cmd.delegate': 'Delegate',
  'cmd.open': 'Open',
  'cmd.openProjects': 'Projects',
  'cmd.legend': 'Legend',
  'ribbon.open': 'Open Task Vault',

  // Quick-log / annotate modal.
  'quicklog.annotateTitle': 'Annotate · {kind}',
  'quicklog.logTitle': 'Log · {title}',
  'quicklog.annotatePanel': 'Annotate → ## 执行记录',
  'quicklog.fillPanel': 'Quick fill → ## 执行记录',
  'quicklog.placeholder': 'Add a note… Enter to submit',
  'quicklog.wrote': 'Written to the execution log (top)',
  'quicklog.failed': 'Write failed: {err}',

  // Reschedule modal.
  'reschedule.title': 'Reschedule',
  'reschedule.allDay': 'All-day (date only)',
  'reschedule.save': 'Save',
  'reschedule.clear': 'Clear',

  // Projects panel.
  'projects.title': 'Projects',
  'projects.empty': 'No projects yet',
  'projects.open': 'Open',
  'projects.overdue': 'Overdue',
  'projects.weekDone': 'Done this week',
  'projects.running': 'Running',

  // Settings tab (labels rendered per active language, FR-039).
  'settings.interfaceHeading': 'Interface',
  'settings.language': 'Language',
  'settings.languageDesc': 'Display language for the plugin UI. "Follow Obsidian" picks by Obsidian\'s UI language.',
  'settings.langAuto': 'Follow Obsidian',
  'settings.hooksHeading': 'Hooks',
  'settings.terminalHook': 'Terminal hook',
  'settings.terminalHookDesc':
    'Runs when a task enters done/cancelled. Placeholders {TASK_PATH} {TASK_ID} {TASK_STATUS} {TASK_TITLE} {TASK_ASSIGNEE}; TV_* env vars injected. Empty = disabled.',
  'settings.terminalHookPlaceholder': 'e.g. ~/bin/on-task-done "{TASK_PATH}"',
  'settings.dispatchHook': 'Dispatch hook',
  'settings.dispatchHookDesc':
    'Runs when delegating a task to an agent. Same placeholders plus {TASK_INSTRUCTION}. Empty = disabled.',
  'settings.dispatchHookPlaceholder': 'e.g. hermes dispatch --task "{TASK_ID}" --to "{TASK_ASSIGNEE}"',
  'settings.timeHeading': 'Time defaults',
  'settings.alldayRemind': 'All-day default remind',
  'settings.alldayRemindDesc': 'Reminder time on the due date for tasks without a specific time (HH:MM).',
  'settings.backstop': 'Backstop dispatch (min)',
  'settings.backstopDesc': 'Minutes after delegation with no pickup before the backstop cron re-dispatches.',

  // FR-034 built-in local API.
  'settings.apiHeading': 'Local API',
  'settings.apiEnabled': 'Enable local API',
  'settings.apiEnabledDesc':
    'Serve a localhost-only HTTP API (127.0.0.1) so agents can create, read, update, and log tasks through the state machine. Off by default.',
  'settings.apiPort': 'Port',
  'settings.apiPortDesc': 'TCP port for the local API (1–65535). Restart on change is automatic.',
  'settings.apiToken': '{agent} token',
  'settings.apiTokenDesc': 'Bearer token identifying {agent}. Empty means this agent cannot authenticate.',
  'settings.apiTokenGenerate': 'Generate',
  'settings.apiTokenWarning':
    'Tokens are shown in plaintext and stored unencrypted in config.json. Single-user local-only design — use at your own risk.',
  'api.portError': 'Local API could not bind port {port}: {err}',

  // Project detail view.
  'projectDetail.title': 'Project · {project}',
  'projectDetail.fallback': 'Project detail',
  'projectDetail.back': '← Back',
  'projectDetail.empty': 'No tasks in this project',

  // Agenda panel (FR-036) — today's timeline in the right sidebar.
  'agenda.title': 'Agenda',
  'agenda.empty': 'Nothing scheduled today',
  'agenda.allDay': 'All-day',
  'agenda.doneGroup': 'Completed today',
  'agenda.fullCalendar': '🗓 Full calendar',

  // Calendar view (FR-036) — month grid in the center.
  'cal.title': 'Calendar',
  'cal.today': 'Today',
  'cal.prevMonth': 'Previous month',
  'cal.nextMonth': 'Next month',
  'cal.more': '+{n}',
  // Month title: {month} is the short month name, {year} the 4-digit year → "Aug 2026".
  'cal.monthTitle': '{month} {year}',
  'cal.month.0': 'Jan',
  'cal.month.1': 'Feb',
  'cal.month.2': 'Mar',
  'cal.month.3': 'Apr',
  'cal.month.4': 'May',
  'cal.month.5': 'Jun',
  'cal.month.6': 'Jul',
  'cal.month.7': 'Aug',
  'cal.month.8': 'Sep',
  'cal.month.9': 'Oct',
  'cal.month.10': 'Nov',
  'cal.month.11': 'Dec',
  // Weekday headers, Monday-first.
  'cal.weekday.0': 'Mon',
  'cal.weekday.1': 'Tue',
  'cal.weekday.2': 'Wed',
  'cal.weekday.3': 'Thu',
  'cal.weekday.4': 'Fri',
  'cal.weekday.5': 'Sat',
  'cal.weekday.6': 'Sun',

  // Chrome links + commands for the agenda/calendar (FR-036).
  'sidebar.agenda': '🗓 Agenda',
  'cmd.openAgenda': 'Agenda',
};
