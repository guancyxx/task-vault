// FR-040/FR-041: the two creation commands' modals. 新建任务 (Mod+Shift+N) reuses the exact
// capture pipeline the sidebar box uses — parseCapture → injected onCapture (VaultSource.
// createTaskFile) — so a command-created task and a capture-box task are byte-identical.
// 新建项目 (Mod+Shift+P) asks only for a name, then writes main note + Dashboard via the pure
// templates in projectTemplates.ts and registers the project in the root Dashboard.
// Both commands are plain callbacks (no commandGate): creation doesn't depend on the active
// file — that gate is exactly what keeps the six annotation commands greyed out on non-task files.

import { Modal, Notice, TFile, type App } from 'obsidian';
import type { TaskStore } from '../store/taskStore';
import type { T } from '../i18n';
import type { Capture } from './captureParse';
import { formToCapture, knownProjects, previewDue, type NewTaskFormValue } from './newTaskForm';
import { projectDashboardMd, projectNoteMd, registerInDashboard } from './projectTemplates';

export interface ProjectCreateOptions {
  projectsFolder: string; // '' → create at vault root
  dashboardPath: string; // '' → skip Dashboard + registration
  now: () => Date;
}

// Pure command table for the two creation commands (mirrors COMMAND_ROWS in commands.ts): the
// shipped registration in main.ts iterates this, so ids / name keys / default hotkey letters
// cannot drift from the spec (FR-040/FR-041, SC-022).
// new-project = J (2026-08-24 revision): P collided with Obsidian's core Cmd+Shift+P
// (quick switcher) — core bindings silently shadow plugin defaults.
export interface CreateCommandRow {
  id: string;
  nameKey: Parameters<T>[0];
  key: string;
}

export const CREATE_COMMAND_ROWS: readonly CreateCommandRow[] = [
  { id: 'new-task', nameKey: 'cmd.newTask', key: 'N' },
  { id: 'new-project', nameKey: 'cmd.newProject', key: 'J' },
] as const;

// 新建任务 modal (FR-040 rev 2026-08-24): form with title / project dropdown / priority /
// NL due text. The project dropdown lists knownProjects(store) so a picked name maps 1:1 to
// the on-disk project folder — the fix for "capture syntax created tasks under the wrong
// project path". Submit assembles a Capture via formToCapture and rides the SAME onCapture
// seam the sidebar box uses, so file bytes stay identical across all three entry points.
export class NewTaskModal extends Modal {
  private form: NewTaskFormValue = { title: '', project: '', priority: '', dueText: '' };

  constructor(
    app: App,
    private store: TaskStore | null,
    private createCapture: (capture: Capture, now: Date) => Promise<void>,
    private t: T,
    private now: () => Date = () => new Date(),
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.t('cmd.newTask'));
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const t = this.t;

    // Title (required)
    contentEl.createEl('label', { cls: 'tv-form-label', text: t('form.title') });
    const titleInput = contentEl.createEl('input', {
      cls: 'tv-capture tv-form-input',
      attr: { type: 'text', placeholder: t('form.titlePlaceholder') },
    });
    titleInput.addEventListener('input', () => {
      this.form.title = titleInput.value;
    });

    // Project (dropdown of known projects + free text via an editable datalist)
    contentEl.createEl('label', { cls: 'tv-form-label', text: t('form.project') });
    const projectInput = contentEl.createEl('input', {
      cls: 'tv-capture tv-form-input',
      attr: { type: 'text', list: 'tv-new-task-projects', placeholder: t('form.projectPlaceholder') },
    });
    const datalist = contentEl.createEl('datalist', { attr: { id: 'tv-new-task-projects' } });
    for (const name of this.store ? knownProjects(this.store.allEntries().map((e) => e.task)) : []) {
      datalist.createEl('option', { attr: { value: name } });
    }
    projectInput.addEventListener('input', () => {
      this.form.project = projectInput.value;
    });

    // Priority
    contentEl.createEl('label', { cls: 'tv-form-label', text: t('form.priority') });
    const prioSelect = contentEl.createEl('select', { cls: 'tv-form-select' });
    for (const [value, label] of [
      ['', t('form.priorityDefault')],
      ['high', t('form.priorityHigh')],
      ['normal', t('form.priorityNormal')],
      ['low', t('form.priorityLow')],
    ] as const) {
      prioSelect.createEl('option', { attr: { value }, text: label });
    }
    prioSelect.addEventListener('change', () => {
      this.form.priority = prioSelect.value as NewTaskFormValue['priority'];
    });

    // Due (natural language, '' = today 22:00) with live preview
    contentEl.createEl('label', { cls: 'tv-form-label', text: t('form.due') });
    const dueInput = contentEl.createEl('input', {
      cls: 'tv-capture tv-form-input',
      attr: { type: 'text', placeholder: t('form.duePlaceholder') },
    });
    const duePreview = contentEl.createDiv({ cls: 'tv-form-hint' });
    duePreview.setText(t('form.dueDefaultHint'));
    const refreshPreview = (): void => {
      this.form.dueText = dueInput.value;
      if (dueInput.value.trim() === '') {
        duePreview.setText(t('form.dueDefaultHint'));
        return;
      }
      const resolved = previewDue(dueInput.value, this.now());
      duePreview.setText(resolved === null ? t('form.dueInvalid') : t('form.dueResolved', { due: resolved }));
    };
    dueInput.addEventListener('input', refreshPreview);

    // Enter on any field submits (IME-safe); Esc cancels (Modal default).
    for (const el of [titleInput, projectInput, dueInput]) {
      el.addEventListener('keydown', (evt: KeyboardEvent) => {
        if (evt.key !== 'Enter' || evt.isComposing) return;
        void this.submit();
      });
    }
    titleInput.focus();
  }

  private async submit(): Promise<void> {
    const res = formToCapture(this.form, this.now());
    if (!res.ok) {
      new Notice(res.reason === 'emptyTitle' ? this.t('capture.emptyTitle') : this.t('form.dueInvalid'));
      return;
    }
    const now = this.now();
    this.close();
    await this.createCapture(res.capture, now).catch((e) =>
      new Notice(this.t('capture.failed', { err: String(e) })),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// 新建项目 modal: name → main note + sibling Dashboard + root-Dashboard registration.
export class NewProjectModal extends Modal {
  constructor(
    app: App,
    private opts: ProjectCreateOptions,
    private t: T,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.t('cmd.newProject'));
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tv-detail');
    const input = contentEl.createEl('input', {
      cls: 'tv-capture',
      attr: { type: 'text', placeholder: this.t('cmd.newProjectPlaceholder') },
    });
    input.focus();
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key !== 'Enter' || evt.isComposing) return;
      const name = input.value.trim();
      if (name === '') {
        new Notice(this.t('cmd.newProjectEmpty'));
        return;
      }
      // Characters that would corrupt the scaffold: `/` breaks the vault path, `"` breaks the
      // dashboard dataview string, `[`/`]` break wikilinks. Reject loudly at entry.
      if (/[/"\[\]\n]/.test(name)) {
        new Notice(this.t('cmd.newProjectInvalid'));
        return;
      }
      if (this.app.vault.getAbstractFileByPath(this.notePath(name))) {
        new Notice(this.t('cmd.newProjectExists', { name }));
      } else {
        void this.createProject(name);
      }
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private notePath(name: string): string {
    const base = this.opts.projectsFolder ? `${this.opts.projectsFolder}/` : '';
    return `${base}${name}.md`;
  }

  private async createProject(name: string): Promise<void> {
    const input = { name, created: this.opts.now().toISOString().slice(0, 7) }; // YYYY-MM
    try {
      await mkdirp(this.app, this.opts.projectsFolder);
      await this.app.vault.create(this.notePath(name), projectNoteMd(input));
      new Notice(this.t('cmd.newProjectDone', { name }));
      if (this.opts.dashboardPath) await this.registerDashboard(name, input);
    } catch (e) {
      new Notice(this.t('cmd.newProjectFailed', { err: String(e) }));
    }
  }

  // Create the sibling Dashboard note and append the nav link to the root Dashboard. Each step
  // degrades with its own Notice: a missing root Dashboard or marker line skips registration
  // (never throws mid-scaffold); a Dashboard-name collision leaves the existing note alone.
  private async registerDashboard(name: string, input: { name: string; created: string }): Promise<void> {
    try {
      const base = this.opts.projectsFolder ? `${this.opts.projectsFolder}/` : '';
      const dashPath = `${base}${name} Dashboard.md`;
      if (!this.app.vault.getAbstractFileByPath(dashPath)) {
        await this.app.vault.create(dashPath, projectDashboardMd(input));
      }
      const root = this.app.vault.getAbstractFileByPath(this.opts.dashboardPath);
      if (!(root instanceof TFile)) {
        new Notice(this.t('cmd.newProjectNavMissing', { path: this.opts.dashboardPath }));
        return;
      }
      const updated = registerInDashboard(await this.app.vault.read(root), name);
      if (updated === null) {
        new Notice(this.t('cmd.newProjectNavMissing', { path: this.opts.dashboardPath }));
        return;
      }
      await this.app.vault.process(root, () => updated);
    } catch (e) {
      new Notice(this.t('cmd.newProjectFailed', { err: String(e) }));
    }
  }
}

// mkdir -p over the Vault adapter (vault.createFolder throws on existing dirs) — same shape as
// VaultSource.ensureDir.
function mkdirp(app: App, dir: string): Promise<void> {
  let cur = '';
  return dir
    .split('/')
    .filter((p) => p !== '')
    .reduce<Promise<void>>(
      (p, part) =>
        p.then(async () => {
          cur = cur ? `${cur}/${part}` : part;
          if (app.vault.getAbstractFileByPath(cur) === null) await app.vault.createFolder(cur);
        }),
      Promise.resolve(),
    )
    .then(() => undefined);
}
