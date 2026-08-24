import { describe, expect, it } from 'vitest';
import { createT } from '../src/i18n';
import { normalizeConfig, DEFAULT_CONFIG } from '../src/config';
import { parseCapture } from '../src/view/captureParse';
import {
  projectNoteMd,
  projectDashboardMd,
  registerInDashboard,
} from '../src/view/projectTemplates';
import { CREATE_COMMAND_ROWS } from '../src/view/newProjectModal';
import { COMMAND_ROWS } from '../src/view/commands';

// FR-040/FR-041 (SC-020): the two creation commands + the pure project scaffolding generators.

describe('creation command table (FR-040/FR-041)', () => {
  it('registers exactly new-task:M and new-project:J', () => {
    expect(CREATE_COMMAND_ROWS.map((r) => `${r.id}:${r.key}`)).toEqual([
      'new-task:M',
      'new-project:J',
    ]);
  });

  it('name keys resolve in both dictionaries and do not collide with the six gated commands', () => {
    for (const lang of ['zh-CN', 'en'] as const) {
      const t = createT(lang);
      for (const row of CREATE_COMMAND_ROWS) expect(t(row.nameKey).length).toBeGreaterThan(0);
    }
    const ids = new Set([...COMMAND_ROWS, ...CREATE_COMMAND_ROWS].map((r) => r.id));
    expect(ids.size).toBe(COMMAND_ROWS.length + CREATE_COMMAND_ROWS.length);
  });

  it('hotkey letters do not collide with the six gated commands (all Mod+Shift)', () => {
    const keys = new Set([...COMMAND_ROWS, ...CREATE_COMMAND_ROWS].map((r) => r.key));
    expect(keys.size).toBe(COMMAND_ROWS.length + CREATE_COMMAND_ROWS.length);
  });
});

describe('project templates (FR-041)', () => {
  const input = { name: 'Demo Project', created: '2026-08' };

  it('main note: type:project frontmatter, name heading, dashboard backlink', () => {
    const md = projectNoteMd(input);
    expect(md).toContain('type: project');
    expect(md).toContain('status: active');
    expect(md).toContain('created: 2026-08');
    expect(md).toContain('# Demo Project');
    expect(md).toContain('[[Demo Project Dashboard|Dashboard 面板]]');
    // frontmatter must open the file
    expect(md.startsWith('---\n')).toBe(true);
  });

  it('dashboard: type:dashboard frontmatter, parent link, both dataview blocks scoped by name', () => {
    const md = projectDashboardMd(input);
    expect(md).toContain('type: dashboard');
    expect(md).toContain('parent: "[[Demo Project]]"');
    expect(md).toContain('# Demo Project · Dashboard');
    // two dataview blocks, both filtering on the project name (escaped for regex)
    const blocks = md.match(/```dataview[\s\S]*?```/g) ?? [];
    expect(blocks.length).toBe(2);
    for (const b of blocks) expect(b).toContain('AND project = "Demo Project"');
    expect(md).toContain('FROM "03 Tasks"');
    expect(md).toContain('_archive');
  });

  it('a project name with quotes is rejected upstream by the modal (no injection into dataview)', () => {
    // The modal rejects /[/"\[\]\n]/ at entry (cmd.newProjectInvalid); the template inserts the
    // raw name, so this pins WHY: a quoted name would corrupt the dataview string below.
    const md = projectDashboardMd({ name: 'Say "hi"', created: '2026-08' });
    expect(md).toContain('AND project = "Say "hi""');
    expect('Say "hi"'.match(/["/\[\]\n]/)).not.toBeNull(); // would be rejected at entry
  });
});

describe('registerInDashboard (FR-041 nav registration)', () => {
  const base = ['独立项目:[[A Dashboard]] · [[B Dashboard]]', '', 'text'].join('\n');

  it('appends the link to the 独立项目 line with the · separator', () => {
    const out = registerInDashboard(base, 'C')!;
    expect(out).not.toBe(base);
    expect(out.split('\n')[0]).toBe('独立项目:[[A Dashboard]] · [[B Dashboard]] · [[C Dashboard]]');
    expect(out.split('\n').slice(1)).toEqual(['', 'text']); // rest untouched
  });

  it('is idempotent: an already-registered link is a no-op (same string back)', () => {
    const once = registerInDashboard(base, 'C')!;
    expect(registerInDashboard(once, 'C')).toBe(once);
  });

  it('returns null when no 独立项目 line exists (caller Notices, never guesses)', () => {
    expect(registerInDashboard('# Dashboard\n\nno marker', 'C')).toBeNull();
    expect(registerInDashboard('', 'C')).toBeNull();
  });

  it('matches only a line that STARTS with 独立项目 (not mid-sentence mentions)', () => {
    const md = ['正文提到独立项目这个词不算。', base].join('\n');
    const out = registerInDashboard(md, 'C')!;
    expect(out.split('\n')[0]).not.toContain('[[C Dashboard]]');
    expect(out.split('\n')[1]).toContain('[[C Dashboard]]');
  });
});

describe('config: projects_folder / dashboard_file (FR-041)', () => {
  it('defaults to 01 Projects / Dashboard.md', () => {
    expect(DEFAULT_CONFIG.projects_folder).toBe('01 Projects');
    expect(DEFAULT_CONFIG.dashboard_file).toBe('Dashboard.md');
    const n = normalizeConfig({});
    expect(n.projects_folder).toBe('01 Projects');
    expect(n.dashboard_file).toBe('Dashboard.md');
  });

  it('strips leading/trailing slashes; empty string round-trips as vault-root / skip', () => {
    const n = normalizeConfig({ projects_folder: '/01 Projects/', dashboard_file: '/Dashboard.md' });
    expect(n.projects_folder).toBe('01 Projects');
    expect(n.dashboard_file).toBe('Dashboard.md');
    const empty = normalizeConfig({ projects_folder: '', dashboard_file: '' });
    expect(empty.projects_folder).toBe('');
    expect(empty.dashboard_file).toBe('');
  });
});

// FR-040 seam check: the modal's Enter handler uses the same parser the sidebar capture box
// uses, so valid capture syntax and only valid syntax passes through to createTaskFile.
describe('new-task modal rides the capture parser (FR-040)', () => {
  const now = new Date('2026-08-24T10:00:00+08:00');

  it('accepts plain-title capture; rejects empty/whitespace', () => {
    expect(parseCapture('写周报 @Demo !high', now)).not.toBeNull();
    expect(parseCapture('', now)).toBeNull();
    expect(parseCapture('   ', now)).toBeNull();
  });
});
