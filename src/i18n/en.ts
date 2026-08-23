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
  'sidebar.projects': '📁 Projects',
  'sidebar.empty': '—',
  'sidebar.uncategorized': 'Uncategorized',
  'capture.placeholder': 'Capture a task…  !high @project #tag tomorrow 3pm',
  'capture.emptyTitle': 'Task title is empty',
  'capture.failed': 'Capture failed: {err}',

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

  // Project detail view.
  'projectDetail.title': 'Project · {project}',
  'projectDetail.fallback': 'Project detail',
  'projectDetail.back': '← Back',
  'projectDetail.empty': 'No tasks in this project',
};
