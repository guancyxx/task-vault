// Sidebar cockpit ItemView (FR-011): five buckets rendered from the store, live-refreshed on
// store change. Section + sub-task collapse state is preserved across re-renders. Rows carry
// inline actions (FR-013) via TaskActions; sub-tasks render indented under their parent. The
// capture box (Task 9) mounts on top.

import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import type { TaskActions } from '../store/taskActions';
import type { Entry, TaskStore } from '../store/taskStore';
import type { Bucket } from '../time/timeRules';
import { createT, tArray, type MessageKey, type T } from '../i18n';
import { agentProgress } from '../model/agentProgress';
import { openDecisionPoints } from '../model/decisionPoints';
import { TERMINAL_STATUSES } from '../model/types';
import { openReschedule } from './reschedule';
import { parseCapture } from './captureParse';
import { openDetailAt } from './detailPopover';
import { renderTaskRow, type RowActions } from './taskRow';
import { projectFolder, UNCATEGORIZED } from '../store/taskPaths';

// The view stays framework-thin: capture creates a file via this injected handler (VaultSource).
export type CaptureHandler = (text: string, now: Date) => Promise<void>;
// Detail popover opener (Task 13). Injected so this file stays independent of the popover.

export const VIEW_TYPE_TASK_VAULT = 'task-vault-view';

// Section order (user request 2026-08-20): overdue first — what's burning shows on top,
// before today. Then today, this week, done-today. Titles resolve via the active translator.
const SECTIONS: Array<{ bucket: Bucket; labelKey: MessageKey }> = [
  { bucket: 'review', labelKey: 'bucket.review' },
  { bucket: 'overdue', labelKey: 'bucket.overdue' },
  { bucket: 'today', labelKey: 'bucket.today' },
  { bucket: 'week', labelKey: 'bucket.week' },
  { bucket: 'done', labelKey: 'bucket.done' },
];

// Fallback translator when no getT is injected (never in production — the plugin always wires one).
const DEFAULT_T: T = createT('zh-CN');

export class TaskVaultView extends ItemView {
  private collapsed = new Set<Bucket>(['done']); // 已完成 starts folded
  private collapsedParents = new Set<string>();
  private expandedProjects = new Set<string>(); // per-(bucket,project) expand memory; default folded
  private unsubscribe?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private onCapture?: CaptureHandler,
    private actions?: TaskActions,
    private now: () => Date = () => new Date(),
    private onOpenProjects?: () => void,
    private getT: () => T = () => DEFAULT_T,
    private onOpenAgenda?: () => void,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_VAULT;
  }

  getDisplayText(): string {
    return 'Task Vault';
  }

  getIcon(): string {
    return 'checkbox-glyph';
  }

  protected async onOpen(): Promise<void> {
    this.unsubscribe = this.store.onChange(() => this.render());
    // FR-044 heartbeat: re-render every 60s so countdown/overdue badges advance with wall-clock
    // time even when the store is quiet. registerInterval auto-clears on view close; render()
    // preserves collapse state, so nothing folds/unfolds under the user.
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
  }

  protected async onClose(): Promise<void> {
    this.unsubscribe?.();
  }

  render(): void {
    const root = this.containerEl;
    const t = this.getT();
    // FR-044 heartbeat guard (audit C1): a full re-render rebuilds the capture input, which
    // would wipe in-flight typing. Snapshot value/focus/selection before empty() and restore
    // after — and skip the rebuild entirely mid-IME-composition (restoring a selection across
    // a torn-down composition context breaks the IME).
    const prevInput = root.querySelector('input.tv-capture') as HTMLInputElement | null;
    const captureState = prevInput ? snapshotCapture(prevInput) : null;
    if (prevInput && isComposing(prevInput)) return; // never tear down a live IME composition
    root.empty();
    root.addClass('tv-cockpit');
    // Header link to the projects panel (FR-035). One row above capture; leaves the five
    // sections untouched. Absent when no handler is wired (e.g. read-only tests).
    if (this.onOpenProjects || this.onOpenAgenda) {
      const bar = root.createDiv({ cls: 'tv-cockpit-header' });
      if (this.onOpenProjects) {
        const link = bar.createSpan({ cls: 'tv-projects-link', text: t('sidebar.projects') });
        link.addEventListener('click', () => this.onOpenProjects!());
      }
      if (this.onOpenAgenda) {
        const link = bar.createSpan({ cls: 'tv-projects-link', text: t('sidebar.agenda') });
        link.addEventListener('click', () => this.onOpenAgenda!());
      }
    }
    this.renderCaptureBox(root);
    this.renderDecisionZone(root);
    const grouped = this.store.bucketed(this.now());

    for (const { bucket, labelKey } of SECTIONS) {
      const entries = grouped[bucket];
      const section = root.createDiv({ cls: ['tv-section', `tv-section-${bucket}`] });
      const folded = this.collapsed.has(bucket);

      const header = section.createDiv({ cls: 'tv-section-header' });
      header.createSpan({ cls: 'tv-fold', text: folded ? '▸' : '▾' });
      header.createSpan({ cls: 'tv-section-title', text: t(labelKey) });
      // FR-047: count is a "which bucket is burning" scan signal, not decoration. Colour the badge
      // by bucket when non-zero — overdue red, review purple, today accent; week/done + 0 stay grey.
      header.createSpan({ cls: countClass(bucket, entries.length), text: String(entries.length) });
      header.addEventListener('click', () => {
        if (folded) this.collapsed.delete(bucket);
        else this.collapsed.add(bucket);
        this.render();
      });

      if (folded) continue;
      const body = section.createDiv({ cls: 'tv-section-body' });
      // Top-level = no parent present in the store; sub-tasks render under their parent instead.
      const roots = entries.filter((e) => {
        const p = e.task.parent;
        return !p || !this.store.hasId(p);
      });
      if (roots.length === 0) {
        body.createDiv({ cls: 'tv-empty', text: t('sidebar.empty') });
        continue;
      }
      // Project subgroups (user request 2026-08-19): rows are already group-sorted by
      // project+priority; insert a clickable divider per consecutive run of the stable
      // projectFolder key (see projectGroups). Fold state is per (bucket, project) —
      // independent across sections — and defaults to folded.
      const uncat = t('sidebar.uncategorized');
      let currentCollapsed = false;
      for (const g of projectGroups(roots, bucket)) {
        // Wikilink-stripped grouping key: project "[[学习]]" and bare 学习 must land in ONE
        // group; the localized uncat label is display-only and can never merge groups (audit
        // 08-25 — not even when a real project's name equals the localized label).
        const proj = g.pf === UNCATEGORIZED ? uncat : g.pf;
        currentCollapsed = !this.expandedProjects.has(g.key); // default folded
        {
          const div = body.createDiv({ cls: 'tv-project-divider' });
          div.toggleClass('tv-collapsed', currentCollapsed);
          div.createSpan({ cls: 'tv-project-fold', text: currentCollapsed ? '▸' : '▾' });
          div.createSpan({ cls: 'tv-project-name', text: proj });
          div.createSpan({ cls: 'tv-project-count', text: String(projectCount(roots, g.pf, uncat)) });
          const key = g.key;
          div.addEventListener('click', () => {
            if (this.expandedProjects.has(key)) this.expandedProjects.delete(key);
            else this.expandedProjects.add(key);
            this.render();
          });
        }
        if (currentCollapsed) continue;
        for (const e of g.rows) this.renderRowTree(body, e, false);
      }
    }

    // FR-044 heartbeat guard (audit C1), restore half: put the capture input back the way the
    // user left it — text, focus, and selection. Without this the 60s ticker (or any store
    // event) would silently discard in-flight typing.
    if (captureState) {
      const input = root.querySelector('input.tv-capture') as HTMLInputElement | null;
      if (input) restoreCapture(input, captureState);
    }
  }

  private renderDecisionZone(root: HTMLElement): void {
    const t = this.getT();
    const pending = decisionZoneEntries(this.store);
    const section = root.createDiv({ cls: 'tv-section tv-section-decisions' });
    const header = section.createDiv({ cls: 'tv-section-header' });
    header.createSpan({ cls: 'tv-section-title', text: t('sidebar.decisions') });
    header.createSpan({ cls: countClass('review', pending.length), text: String(pending.length) });
    if (pending.length === 0) return; // zone stays as a quiet count-only strip when idle
    const body = section.createDiv({ cls: 'tv-section-body' });
    for (const p of pending) {
      const row = body.createDiv({ cls: 'tv-decision-row' });
      row.createSpan({ cls: 'tv-decision-groups', text: p.groups.join(' ') });
      row.createSpan({ cls: 'tv-decision-title', text: p.task.title });
      if (this.actions) {
        row.addEventListener('click', (evt) =>
          openDetailAt(this.app, this.store, this.actions!, p.path, evt, this.getT()),
        );
      }
    }
  }

  private renderRowTree(container: HTMLElement, entry: Entry, indent: boolean): void {
    const { task, path } = entry;
    const kids = this.store.children(task.id);
    const collapsed = this.collapsedParents.has(task.id);
    const child =
      kids.length > 0
        ? {
            count: kids.length,
            done: this.store.progress(task.id).done,
            collapsed,
            onToggle: () => {
              if (collapsed) this.collapsedParents.delete(task.id);
              else this.collapsedParents.add(task.id);
              this.render();
            },
          }
        : undefined;

    renderTaskRow(container, task, {
      path,
      effectiveStatus: this.store.effectiveStatus(task.id) ?? task.status,
      blockSources: this.store.blockSources(task.id),
      now: this.now(),
      actions: this.actions ? this.rowActions(path) : undefined,
      child,
      indent,
      agentPhase: agentProgress(task, entry.body) ?? undefined,
      t: this.getT(),
    });

    if (child && !collapsed) {
      for (const k of kids) this.renderRowTree(container, k, true);
    }
  }

  private rowActions(path: string): RowActions {
    const actions = this.actions!;
    return {
      complete: () => void actions.complete(path),
      reschedule: (task) => openReschedule(this.app, task.due, (due) => void actions.reschedule(path, due), this.getT()),
      openDetail: (_task, evt) => openDetailAt(this.app, this.store, actions, path, evt, this.getT()),
      openDoc: (_task, p) => void this.app.workspace.openLinkText(p, '', false),
      // FR-049: the canonical setStatus seam — actor=user (TaskActions default), log entry
      // and frontmatter persistence handled inside the seam.
      reviewDecision: (_task, to) => void actions.setStatus(path, to),
    };
  }

  // Quick-capture input (FR-012): Enter → parse → create task file → row appears via events.
  private renderCaptureBox(root: HTMLElement): void {
    if (!this.onCapture) return;
    const t = this.getT();
    // FR-045: rotate the placeholder through the syntax examples so the capture box teaches the
    // grammar. Falls back to the single fixed placeholder if the examples list is somehow empty.
    const placeholder = pickExample(tArray(t, 'capture.examples'), Math.random) || t('capture.placeholder');
    const input = root.createEl('input', {
      cls: 'tv-capture',
      attr: { type: 'text', placeholder },
    });
    // FR-044 heartbeat guard (audit C1): track IME composition so render() can skip the rebuild
    // while a composition is live (see isComposing below).
    input.addEventListener('compositionstart', () => { (input as any).__tvComposing = true; });
    input.addEventListener('compositionend', () => { (input as any).__tvComposing = false; });
    input.addEventListener('keydown', (evt: KeyboardEvent) => {
      if (evt.key !== 'Enter' || evt.isComposing) return; // let IME composition finish
      const text = input.value;
      const now = this.now();
      if (parseCapture(text, now) === null) {
        new Notice(t('capture.emptyTitle'));
        return;
      }
      input.value = '';
      void this.onCapture!(text, now).catch((e) => new Notice(t('capture.failed', { err: String(e) })));
    });
  }
}


// FR-047: bucket-coloured count badge classes. Grey (bare tv-count) for week/done or a zero count;
// a semantic overlay for overdue/review/today when they carry anything. Pure — unit-tested.
const COUNT_ALERT_CLASS: Partial<Record<Bucket, string>> = {
  overdue: 'tv-count-alert',
  review: 'tv-count-review',
  today: 'tv-count-today',
};
export function countClass(bucket: Bucket, count: number): string[] {
  const extra = count > 0 ? COUNT_ALERT_CLASS[bucket] : undefined;
  return extra ? ['tv-count', extra] : ['tv-count'];
}

// FR-044 heartbeat guard (audit C1): capture-input interaction state to carry across the
// render() rebuild. Pure — snapshot/restore are split out so the "typing survives a re-render"
// contract is unit-testable without a DOM.
export interface CaptureSnapshot {
  value: string;
  focused: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
}
export function snapshotCapture(input: HTMLInputElement): CaptureSnapshot {
  return {
    value: input.value,
    // Node (unit tests) has no `document`; treat as unfocused there — real runs always have DOM.
    focused: typeof document !== 'undefined' && document.activeElement === input,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
  };
}
export function restoreCapture(input: HTMLInputElement, snap: CaptureSnapshot): void {
  input.value = snap.value;
  if (snap.focused) input.focus();
  if (snap.selectionStart !== null && snap.selectionEnd !== null) {
    try {
      input.setSelectionRange(snap.selectionStart, snap.selectionEnd);
    } catch {
      // setSelectionRange throws on inputs without text-selection semantics; value is still
      // restored — acceptable to let the caret fall to the end.
    }
  }
}

// FR-044 heartbeat guard (audit C1): true while an IME composition is active on the input
// (compositionstart fired without compositionend). Tearing the input down mid-composition
// would destroy the pre-edit text — skip the whole re-render instead.
function isComposing(input: HTMLInputElement): boolean {
  return (input as HTMLInputElement & { __tvComposing?: boolean }).__tvComposing === true;
}

// FR-045: pick one placeholder example. `rng` is injected (Math.random in prod) so the rotation
// unit-tests deterministically; an empty list yields '' (caller falls back to the fixed string).
export function pickExample(xs: readonly string[], rng: () => number): string {
  if (xs.length === 0) return '';
  return xs[Math.floor(rng() * xs.length)];
}

// Project subgroups for one bucket's rows: consecutive runs of the STABLE projectFolder key.
// Pure and exported so the render-loop grouping semantics are unit-testable directly (audit
// 08-25: the group boundary must key on pf, never on the localized display name — a real
// project named like the uncat label must NOT merge with the uncategorized group).
export interface ProjectGroup {
  pf: string; // stable projectFolder key ('_未分类' for uncategorized)
  key: string; // JSON [bucket, pf] fold key — no control-char separator (Scorecard, FR-033)
  rows: Entry[];
}
export function projectGroups(roots: Entry[], bucket: string): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  for (const e of roots) {
    const pf = projectFolder(e.task);
    const last = groups[groups.length - 1];
    if (last && last.pf === pf) last.rows.push(e);
    else groups.push({ pf, key: JSON.stringify([bucket, pf]), rows: [e] });
  }
  return groups;
}

// Root-row count per project within a bucket (for the divider's count badge). `project` is the
// STABLE projectFolder key ('_未分类' for uncategorized); the count key mirrors the render loop's
// grouping and fold keys exactly, so a mixed bare/wikilink project counts as one group. `uncat`
// is the localized fallback label — display-only, never a count key (audit 08-25: prevents a
// real project that happens to equal the localized label from merging with uncategorized).
export function projectCount(roots: Entry[], project: string, _uncat: string): number {
  void _uncat; // kept in the signature for call-site symmetry; keys are stable pf values
  let n = 0;
  for (const e of roots) {
    if (projectFolder(e.task) === project) n++;
  }
  return n;
}

// FR-050 「待你决策」aggregation zone: one line per non-terminal task whose `## 决策点`
// section still carries an unchecked option. Pure — the render maps it to DOM (clickable rows
// opening the detail popover, where the actual decision gesture lives).
export interface DecisionPending {
  path: string;
  task: Entry['task'];
  /** Distinct open `Dn` groups on the task, in section order — shown as the row's prefix. */
  groups: string[];
}

// Terminal tasks never nag (a done task's undecided points are settled history), and a task
// whose every group is checked drops out of the zone — that IS the completion signal.
export function decisionZoneEntries(store: Pick<TaskStore, 'allEntries'>): DecisionPending[] {
  const out: DecisionPending[] = [];
  for (const e of store.allEntries()) {
    if (TERMINAL_STATUSES.includes(e.task.status)) continue;
    const groups = [...new Set(openDecisionPoints(e.body).map((o) => o.group))];
    if (groups.length === 0) continue;
    out.push({ path: e.path, task: e.task, groups });
  }
  // Most urgent first (due, then created, then id) — same ordering key the bucket sort uses.
  return out.sort((a, b) => {
    const ka = a.task.due ?? a.task.created;
    const kb = b.task.due ?? b.task.created;
    return ka === kb ? a.task.id.localeCompare(b.task.id) : ka < kb ? -1 : 1;
  });
}
