// FR-040/FR-041: the two creation commands' modals. 新建任务 (Mod+Shift+N) reuses the exact
// capture pipeline the sidebar box uses — parseCapture → injected onCapture (VaultSource.
// createTaskFile) — so a command-created task and a capture-box task are byte-identical.
// 新建项目 (Mod+Shift+P) asks only for a name, then writes main note + Dashboard via the pure
// templates in projectTemplates.ts and registers the project in the root Dashboard.
// Both commands are plain callbacks (no commandGate): creation doesn't depend on the active
// file — that gate is exactly what keeps the six annotation commands greyed out on non-task files.

import { Modal, Notice, TFile, type App } from 'obsidian';
import type { T } from '../i18n';
import { parseCapture } from './captureParse';
import type { CaptureHandler } from './sidebarView';
import { projectDashboardMd, projectNoteMd, registerInDashboard } from './projectTemplates';

export interface ProjectCreateOptions {
  projectsFolder: string; // '' → create at vault root
  dashboardPath: string; // '' → skip Dashboard + registration
  now: () => Date;
}

// Pure command table for the two creation commands (mirrors COMMAND_ROWS in commands.ts): the
// shipped registration in main.ts iterates this, so ids / name keys / default hotkey letters
// cannot drift from the spec (FR-040/FR-041, SC-020).
export interface CreateCommandRow {
  id: string;
  nameKey: Parameters<T>[0];
  key: string;
}

export const CREATE_COMMAND_ROWS: readonly CreateCommandRow[] = [
  { id: 'new-task', nameKey: 'cmd.newTask', key: 'N' },
  { id: 'new-project', nameKey: 'cmd.newProject', key: 'P' },
] as const;

// 新建任务 modal: one input, Enter → parse → create (same seam as the sidebar capture box).
export class NewTaskModal extends Modal {
  constructor(
    app: App,
    private onCapture: CaptureHandler,
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
    const input = contentEl.createEl('input', {
      cls: 'tv-capture',
      attr: { type: 'text', placeholder: this.t('capture.placeholder') },
    });
    input.focus();
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key !== 'Enter' || evt.isComposing) return; // let IME composition finish
      const text = input.value;
      if (parseCapture(text, this.now()) === null) {
        new Notice(this.t('capture.emptyTitle'));
        return;
      }
      input.value = '';
      void this.onCapture(text, this.now()).catch((e) =>
        new Notice(this.t('capture.failed', { err: String(e) })),
      );
      this.close();
    });
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
