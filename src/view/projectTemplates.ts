// FR-041: pure generators for the 新建项目 command. A project is a vault-side entity — a main
// note (`<projectsFolder>/<名>.md`, type: project) plus a sibling Dashboard (type: dashboard,
// dataview over `03 Tasks`) and a registration row appended to the vault's root Dashboard. All
// three are pure string functions so they unit-test without Obsidian; newProjectModal.ts owns
// the modal + file writes. Templates mirror the existing 01 Projects notes (checked 2026-08-24:
// Blog (guancyxx.cn).md + its Dashboard) — the command only scaffolds; hand-maintained content
// (role, tech stack, …) is intentionally NOT invented.

export interface ProjectTemplateInput {
  name: string;
  created: string; // YYYY-MM
}

// Main note frontmatter + body skeleton. `created` stays YYYY-MM so it sorts like the existing
// notes (2026-04 et al.); the body leaves an editable one-liner, not fake structure.
export function projectNoteMd(input: ProjectTemplateInput): string {
  return [
    '---',
    'type: project',
    'status: active',
    `created: ${input.created}`,
    '---',
    '',
    `# ${input.name}`,
    '',
    '<!-- 项目说明 -->',
    '',
    '## 相关',
    `- [[${input.name} Dashboard|Dashboard 面板]]`,
    '',
  ].join('\n');
}

// Dashboard frontmatter + body skeleton, mirroring the existing project dashboards: a backlink
// header, a pointer to the global Dashboard, and 开放任务 / 近期完成 dataview blocks scoped by
// project name. The dataview `WHERE` uses equality on the project field (the capture syntax's
// canonical form) — the existing notes use a contains() chain to cover legacy name variants,
// which only a human knows; the template keeps one predictable query.
export function projectDashboardMd(input: ProjectTemplateInput): string {
  const p = input.name;
  return [
    '---',
    'type: dashboard',
    `parent: "[[${p}]]"`,
    'tags: [dashboard, project]',
    `date: ${input.created}`,
    '---',
    '',
    `# ${p} · Dashboard`,
    '',
    `> 快捷跳转面板。项目主线定义见 [[${p}]] · 全局 [[Dashboard]]`,
    '',
    '## 开放任务',
    '',
    '```dataview',
    'TABLE WITHOUT ID file.link AS "任务", status, priority, due, assignee',
    'FROM "03 Tasks"',
    'WHERE !contains(file.path, "_archive")',
    '  AND status != "done" AND status != "cancelled"',
    `  AND project = "${p}"`,
    'SORT due ASC',
    '```',
    '',
    '## 近期完成',
    '',
    '```dataview',
    'TABLE WITHOUT ID file.link AS "任务", completed',
    'FROM "03 Tasks"',
    'WHERE !contains(file.path, "_archive")',
    '  AND status = "done"',
    `  AND project = "${p}"`,
    'SORT completed DESC',
    'LIMIT 10',
    '```',
    '',
  ].join('\n');
}

// Append one registration link to the vault Dashboard's 独立项目 line. Pure: returns the edited
// markdown, or null when the marker line is absent (the caller Notices — never guess where to
// insert in someone's hand-shaped nav table). Idempotent: an existing identical link is a no-op.
export function registerInDashboard(dashboardMd: string, name: string): string | null {
  const link = `[[${name} Dashboard]]`;
  const lines = dashboardMd.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('独立项目')) continue;
    if (line.includes(link)) return dashboardMd; // already registered
    lines[i] = `${line.replace(/\s*$/, '')} · ${link}`;
    return lines.join('\n');
  }
  return null;
}
