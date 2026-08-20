// Obsidian adapter for TaskStore (FR-004/005/007). Thin, framework-bound, manually verified.
// Implements the store's injectable VaultReader/LogWriter over the Vault API and wires
// modify/delete/rename events into incremental store updates, debounced 200ms.

import { TFile, type App, type EventRef, type TAbstractFile } from 'obsidian';
import type { EntryInput } from '../log/executionLog';
import { recordEntry } from '../log/executionLog';
import { serializeTaskFile, upsertSection } from '../util/frontmatter';
import { captureToTask, slugify, type Capture } from '../view/captureParse';
import { isLibraryPath, taskDir, taskPath as computeTaskPath } from './taskPaths';
import type { SectionWriter } from './taskActions';
import type { LogWriter, TaskStore, VaultReader } from './taskStore';

export const TASKS_DIR = '03 Tasks/';
const DEBOUNCE_MS = 200;

// A task file lives anywhere under `03 Tasks/` except `_archive/` (two-level project/month
// scheme — see taskPaths.ts). Non-.md and archive paths are excluded.
export function isTaskPath(path: string): boolean {
  return isLibraryPath(path);
}

export class VaultSource implements VaultReader, LogWriter, SectionWriter {
  constructor(private app: App) {}

  async listTaskFiles(): Promise<string[]> {
    return this.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .filter(isTaskPath);
  }

  async read(path: string): Promise<string> {
    return this.app.vault.read(this.mustFile(path));
  }

  // Body-only append (contract §6): keep the frontmatter fence verbatim, append into the body.
  async appendLog(path: string, entry: EntryInput): Promise<void> {
    await this.app.vault.process(this.mustFile(path), (data) => {
      const fence = /^---\n[\s\S]*?\n---\n?/.exec(data);
      const prefix = fence ? fence[0] : '';
      const body = fence ? data.slice(fence[0].length) : data;
      return prefix + recordEntry(body, entry);
    });
  }

  // Body-only section replace (used for the `## 委派` block, FR-015). Frontmatter kept verbatim.
  async upsertSection(path: string, heading: string, content: string): Promise<void> {
    await this.app.vault.process(this.mustFile(path), (data) => {
      const fence = /^---\n[\s\S]*?\n---\n?/.exec(data);
      const prefix = fence ? fence[0] : '';
      const body = fence ? data.slice(fence[0].length) : data;
      return prefix + upsertSection(body, heading, content);
    });
  }

  // Create a task file from a parsed capture (FR-012). The 'create' vault event then flows back
  // through wireVaultEvents → store.upsert, so the row appears without an explicit refresh.
  // Placement: `03 Tasks/<project>/<YYYY-MM-DD>/<slug>.md` (taskPaths.ts scheme).
  async createTaskFile(capture: Capture, now: Date): Promise<string> {
    const task = captureToTask(capture, { id: crypto.randomUUID(), now });
    const base = slugify(task.title);
    let path = computeTaskPath(task, `${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path) !== null; n++) {
      path = computeTaskPath(task, `${base}-${n}.md`);
    }
    await this.ensureDir(taskDir(task));
    await this.app.vault.create(path, serializeTaskFile(task, ''));
    return path;
  }

  // mkdir -p over the Vault adapter (vault.createFolder exists but throws on existing dirs).
  private async ensureDir(dir: string): Promise<void> {
    const parts = dir.split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (this.app.vault.getAbstractFileByPath(cur) === null) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  private mustFile(path: string): TFile {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`not a file: ${path}`);
    return f;
  }
}

// Subscribe the store to vault changes; returns the event refs so the caller can offref on unload.
// Two failure modes found in live verification (2026-08-19):
// 1. `debounce(fn, 200, true)` swallows all-but-the-last call — a cron writing 4 task files in
//    one burst indexed only 1. Fixed with a pending-Set buffer + single scheduled flush.
// 2. External writes (Hermes write_file, the Python syncer, cron scripts) bypass the editor and
//    never fire modify/create. Fixed by also listening to the low-level 'raw' event.
export function wireVaultEvents(app: App, store: TaskStore): EventRef[] {
  const pending = new Map<string, 'upsert' | 'remove'>();
  // number = browser timer id from window.setTimeout (popout-window-safe per review guidance).
  let flushTimer: number | null = null;

  const flush = (): void => {
    flushTimer = null;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [path, kind] of batch) {
      void (kind === 'remove' ? store.remove(path) : store.upsert(path));
    }
  };

  const schedule = (path: string, kind: 'upsert' | 'remove'): void => {
    // A remove after an upsert (or vice versa) of the same path: last write wins.
    pending.set(path, kind);
    if (flushTimer === null) flushTimer = window.setTimeout(flush, DEBOUNCE_MS);
  };

  const onChange = (f: TAbstractFile): void => {
    if (isTaskPath(f.path)) schedule(f.path, 'upsert');
  };

  const { vault } = app;
  return [
    vault.on('modify', onChange),
    vault.on('create', onChange),
    vault.on('delete', (f) => {
      if (isTaskPath(f.path)) schedule(f.path, 'remove');
    }),
    vault.on('rename', (f, oldPath) => {
      if (isTaskPath(oldPath)) schedule(oldPath, 'remove');
      if (isTaskPath(f.path)) schedule(f.path, 'upsert');
    }),
    vault.on('raw', (path) => {
      // Raw fires for ANY file change including ones made outside the editor. It can arrive
      // before Obsidian's own modify event — schedule a re-read; store.upsert is idempotent.
      if (typeof path === 'string' && isTaskPath(path)) schedule(path, 'upsert');
    }),
  ];
}
