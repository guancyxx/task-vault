// Task mutation seam (FR-013/014/015): the one place inline rows + the detail popover route
// writes through. Frontmatter goes via fileManager.processFrontMatter (cache-safe, contract §6);
// the body log goes via the injected LogWriter; terminal transitions fire the hook.
//
// This is the thin obsidian adapter over already-tested pure logic (transition/completeTransition
// and the execution-log formatter) — behaviour is covered by unit tests on those; the wiring here
// is manually verified (docs/manual-check-d.md).

import { Notice, TFile, type App } from 'obsidian';
import type { FireResult, HookRunner } from '../hooks/hookRunner';
import type { EntryInput, EntryKind } from '../log/executionLog';
import { completeTransition, isLegalTransition, transition } from '../model/statusMachine';
import type { Actor, Status, Task } from '../model/types';
import { taskPath } from './taskPaths';
import type { LogWriter, TaskStore } from './taskStore';

// Body-section writer (the `## 委派` block, FR-015). VaultSource implements it.
export interface SectionWriter {
  upsertSection(path: string, heading: string, content: string): Promise<void>;
}

const DELEGATE_HEADING = '## 委派';

export class TaskActions {
  constructor(
    private app: App,
    private store: TaskStore,
    private body: LogWriter & SectionWriter,
    private hooks: HookRunner,
    // Plugin UI is an explicit local-user confirmation channel. Tests/automation may
    // inject an agent actor, which is then constrained by the FR-030 machine guard.
    private actor: Actor = 'user',
    private now: () => Date = () => new Date(),
  ) {}

  // Checkbox complete: advance through the legal chain to done in one gesture (FR-013).
  async complete(path: string): Promise<void> {
    const task = this.taskAt(path);
    if (!task) return;
    if (this.store.isBlocked(task.id)) {
      new Notice('被阻塞，无法完成');
      return;
    }
    const res = completeTransition(task, this.actor, this.now());
    if (!res) return; // already done
    await this.body.appendLog(path, { ts: res.record.at, actor: this.actor, from: res.record.from, to: 'done', text: '' });
    await this.writeFrontmatter(path, res.patch);
    await this.fireTerminal({ ...task, ...res.patch }, path);
  }

  // Status menu: a single explicit transition (menu only offers legal targets, but guard anyway).
  async setStatus(path: string, to: Status): Promise<void> {
    const task = this.taskAt(path);
    if (!task) return;
    if (!isLegalTransition(task.status, to)) {
      new Notice(`非法状态转移：${task.status} → ${to}`);
      return;
    }
    const res = transition(task, to, this.actor, this.now());
    await this.body.appendLog(path, { ts: res.record.at, actor: this.actor, from: res.record.from, to, text: '' });
    await this.writeFrontmatter(path, res.patch);
    await this.fireTerminal({ ...task, ...res.patch }, path);
  }

  // Reschedule (FR-013): set/clear due; value is already formatted (date or datetime) by the caller.
  async reschedule(path: string, due: string | null): Promise<void> {
    await this.writeFrontmatter(path, { due: due ?? undefined });
  }

  // Generic property edit for the detail popover (FR-014). undefined value → delete the key.
  async patch(path: string, patch: Partial<Task>): Promise<void> {
    await this.writeFrontmatter(path, patch);
    // Relocation on project change (taskPaths scheme): identity/mirror untouched, only the
    // file moves so the folder tree stays consistent with frontmatter.
    if (patch.project !== undefined || patch.tags !== undefined) {
      await this.relocateIfFolderChanged(path);
    }
  }

  // Move the file when its computed folder (project/month) no longer matches its location.
  private async relocateIfFolderChanged(path: string): Promise<void> {
    const entry = this.store.entryByPath(path);
    if (!entry) return;
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const desired = taskPath(entry.task, fileName);
    if (desired === path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    // mkdir -p (DataAdapter.mkdir is single-level — walk each segment, tolerate existing).
    const parts = desired.slice(0, desired.lastIndexOf('/')).split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (this.app.vault.getAbstractFileByPath(cur) === null) {
        try {
          await this.app.vault.adapter.mkdir(cur);
        } catch {
          // exists — fine
        }
      }
    }
    await this.app.fileManager.renameFile(file, desired);
  }

  // Quick-fill log entry (FR-014, SC-010): 决策/评论/卡点 or plain progress.
  async appendQuick(path: string, text: string, kind?: EntryKind): Promise<void> {
    const entry: EntryInput = { ts: this.now(), actor: this.actor, text };
    if (kind) entry.kind = kind;
    await this.body.appendLog(path, entry);
  }

  // Delegation (FR-015): write assignee + dispatched, drop the instruction into `## 委派`, fire hook.
  // Returns what the hook actually did — the caller MUST report it: a delegation whose hook is
  // disabled or blew up writes the frontmatter but never starts an agent, and silently claiming
  // success there is how every delegation between 08-19 16:26 and 17:20 got lost.
  async delegate(path: string, assignee: string, instruction: string): Promise<FireResult | 'error'> {
    const task = this.taskAt(path);
    if (!task) return 'error';
    const stamp = localIsoMinute(this.now());
    await this.writeFrontmatter(path, { assignee, dispatched: stamp });
    await this.body.upsertSection(path, DELEGATE_HEADING, instruction.trim());
    await this.body.appendLog(path, { ts: this.now(), actor: this.actor, text: `委派给 ${assignee}` });
    try {
      return await this.hooks.fireDispatch({ ...task, assignee, dispatched: stamp }, path, instruction);
    } catch (e) {
      new Notice(`派发 hook 失败：${String(e)}`);
      return 'error';
    }
  }

  async manualSummary(path: string): Promise<void> {
    const task = this.taskAt(path);
    if (!task) return;
    try {
      const res = await this.hooks.fireManualSummary(task, path);
      if (res === 'disabled') new Notice('未配置终态 hook');
    } catch (e) {
      new Notice(`总结 hook 失败：${String(e)}`);
    }
  }

  private taskAt(path: string): Task | undefined {
    return this.store.entryByPath(path)?.task;
  }

  private async fireTerminal(task: Task, path: string): Promise<void> {
    try {
      await this.hooks.fireTerminal(task, path);
    } catch (e) {
      new Notice(`终态 hook 失败：${String(e)}`);
    }
  }

  private async writeFrontmatter(path: string, patch: Partial<Task>): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete fm[k];
        else fm[k] = v as unknown;
      }
    });
  }
}

function localIsoMinute(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
