// FR-030b acceptance suite: gate debounce (bounce → N s re-read → release / stand).
// Simulates the two-step external done write (frontmatter first, citation later) exactly as
// the 2026-08-24 A3/A4 incident shaped it, against the pure TaskStore + an in-memory vault.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampRevalidateMs, TaskStore, type LogWriter, type VaultReader } from '../src/store/taskStore';
import { serializeTaskFile, parseTaskFile } from '../src/util/frontmatter';
import type { Status, Task } from '../src/model/types';
import {
  applyReviewGate,
  applyReviewRelease,
  shouldGuardExternalDone,
  shouldReleaseAfterDebounce,
  type ReviewGateWriter,
} from '../src/store/reviewGate';

const NOW = new Date(2026, 7, 28, 9, 0);

function baseTask(extra: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: 't',
    status: 'doing',
    created: '2026-08-24T10:00',
    assignee: 'cc',
    ...extra,
  } as Task;
}

const CITE_LINE = 'user-confirm: session=20260824_064634_c34e81 msg=70026 quote="做"';

class MemVault implements VaultReader, LogWriter, ReviewGateWriter {
  files = new Map<string, string>();
  // Optional slow-vault gate for dispose-in-flight orchestration (audit R3).
  writeGate?: Promise<void>;

  set(path: string, raw: string): void {
    this.files.set(path, raw);
  }

  async listTaskFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }

  async appendLog(path?: string, entry?: { text: string }): Promise<void> {
    if (path !== undefined && entry !== undefined && entry.text.includes('自动解除')) {
      this.releaseWrites.push(path);
    }
    if (this.appendLogHook) await this.appendLogHook(path, entry);
  }

  // Third-audit R3 orchestration: record release-edge writes; optional slow-write hook.
  releaseWrites: string[] = [];
  appendLogHook?: (path: string | undefined, entry: { text: string } | undefined) => Promise<void>;

  async enforceReviewGate(path: string, previous: Status, now: Date): Promise<boolean> {
    const parsed = parseTaskFile(await this.read(path), path);
    if (!parsed.ok || !shouldGuardExternalDone(previous, parsed.task, parsed.body)) return false;
    const guarded = applyReviewGate(parsed.task, parsed.body, now);
    this.set(path, serializeTaskFile(guarded.task, guarded.body));
    return true;
  }

  async revalidateReviewGate(path: string, now: Date): Promise<boolean> {
    if (this.writeGate) await this.writeGate;
    const parsed = parseTaskFile(await this.read(path), path);
    if (!parsed.ok || !shouldReleaseAfterDebounce(parsed.task, parsed.body)) return false;
    const released = applyReviewRelease(parsed.task, parsed.body, now);
    this.set(path, serializeTaskFile(released.task, released.body));
    return true;
  }
}

// The agent's two-step done write, wrong lock order: ① frontmatter status=done, ② citation
// patched into the body `delayMs` later (the incident shape — FR-030a lock order reversed).
async function wrongLockOrderDone(
  vault: MemVault,
  store: TaskStore,
  path: string,
  delayMs: number,
): Promise<void> {
  const raw = await vault.read(path);
  vault.set(path, raw.replace('status: doing', 'status: done'));
  await store.upsert(path); // gate sees done + no citation → bounce
  if (delayMs > 0) await vi.advanceTimersByTimeAsync(delayMs);
  const withDone = await vault.read(path);
  vault.set(
    path,
    withDone.replace('## 执行记录\n', `## 执行记录\n\n- 2026-08-28 08:59 · **doing→done** · \`cc\`\n  收尾\n  ${CITE_LINE}\n`),
  );
  await store.upsert(path); // agent's body patch flows back through the event wiring
}

let vault: MemVault;
let store: TaskStore;

beforeEach(() => {
  vi.useFakeTimers();
  vault = new MemVault();
  store = new TaskStore(vault, vault, () => NOW, vault);
});

afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

function seed(path = '03 Tasks/t.md'): string {
  // Unique id per seed: revalidate timers are keyed by task id (audit R2) — real tasks
  // carry UUIDs; a shared id in fixtures would have timers cannibalize each other.
  const task = baseTask({ id: path });
  vault.set(
    path,
    serializeTaskFile(task, '## 执行记录\n\n- 2026-08-28 08:00 · `cc`\n  进行中\n'),
  );
  return path;
}

describe('gate debounce: wrong lock order self-heals (FR-030b acceptance)', () => {
  it('citation landing 2s after the bounce restores done within the 8s window', async () => {
    const path = seed();
    await store.scan();
    await wrongLockOrderDone(vault, store, path, 2_000);
    await vi.advanceTimersByTimeAsync(8_000);

    const parsed = parseTaskFile(await vault.read(path), path);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.task.status).toBe('done');
    expect(parsed.ok && parsed.task.completed).toBe('2026-08-28T09:00');
    // Exactly one gate entry, exactly one release entry — 干预记录不重复落.
    const raw = await vault.read(path);
    expect(raw.split('复核门禁：拦截').length - 1).toBe(1);
    expect(raw.split('复核门禁放行').length - 1).toBe(1);
    // The store's view is refreshed too (the release path re-upserts).
    expect(store.entryByPath(path)?.task.status).toBe('done');
  });

  it('10 consecutive wrong-lock-order writes: 0 terminal bounces (acceptance criterion)', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => seed(`03 Tasks/t${i}.md`));
    await store.scan();
    for (const path of paths) {
      await wrongLockOrderDone(vault, store, path, 2_000);
      await vi.advanceTimersByTimeAsync(8_000);
      const parsed = parseTaskFile(await vault.read(path), path);
      expect(parsed.ok && parsed.task.status).toBe('done');
    }
  });

  it('10 no-citation dones: all stay gated in review, one intervention entry each', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => seed(`03 Tasks/x${i}.md`));
    await store.scan();
    for (const path of paths) {
      const raw = await vault.read(path);
      vault.set(path, raw.replace('status: doing', 'status: done'));
      await store.upsert(path); // bounce
      await vi.advanceTimersByTimeAsync(8_000); // debounce fires, still no confirmation
      const after = await vault.read(path);
      const parsed = parseTaskFile(after, path);
      expect(parsed.ok && parsed.task.status).toBe('review');
      // One gate entry, zero release entries, and the file is otherwise untouched.
      expect(after.split('复核门禁：拦截').length - 1).toBe(1);
      expect(after).not.toContain('复核门禁放行');
    }
  });
});

describe('gate debounce: guards and idempotency', () => {
  it('does not release a review a human set (no gate marker)', async () => {
    const path = '03 Tasks/h.md';
    vault.set(
      path,
      serializeTaskFile(
        baseTask({ status: 'review' }),
        `## 执行记录\n\n- 2026-08-28 08:59 · **doing→review** · \`user\`\n  人工打回\n  ${CITE_LINE}\n`,
      ),
    );
    await store.scan();
    expect(await vault.revalidateReviewGate(path, NOW)).toBe(false);
    const parsed = parseTaskFile(await vault.read(path), path);
    expect(parsed.ok && parsed.task.status).toBe('review');
  });

  it('a second revalidate pass after a release is a no-op (no double release)', async () => {
    const path = seed();
    await store.scan();
    await wrongLockOrderDone(vault, store, path, 2_000);
    await vi.advanceTimersByTimeAsync(8_000);
    const once = await vault.read(path);
    expect(await vault.revalidateReviewGate(path, NOW)).toBe(false);
    expect(await vault.read(path)).toBe(once);
  });

  it('dispose() drops the pending timer — no write after teardown', async () => {
    const path = seed();
    await store.scan();
    const raw = await vault.read(path);
    vault.set(path, raw.replace('status: doing', 'status: done'));
    await store.upsert(path); // bounce schedules the timer
    vault.set(
      path,
      (await vault.read(path)).replace(
        '## 执行记录\n',
        `## 执行记录\n\n- 2026-08-28 08:59 · **doing→done** · \`cc\`\n  收尾\n  ${CITE_LINE}\n`,
      ),
    );
    store.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    const parsed = parseTaskFile(await vault.read(path), path);
    // Stayed in review: the debounce was lost, which is the pre-FR-030b steady state —
    // acceptable, but never a post-teardown write.
    expect(parsed.ok && parsed.task.status).toBe('review');
    expect(await vault.read(path)).not.toContain('复核门禁放行');
  });

  it('dispose() while a revalidate is mid-write kills the follow-up upsert (audit R3)', async () => {
    const path = seed();
    await store.scan();
    const raw = await vault.read(path);
    vault.set(path, raw.replace('status: doing', 'status: done'));
    await store.upsert(path); // bounce
    vault.set(
      path,
      (await vault.read(path)).replace(
        '## 执行记录\n',
        `## 执行记录\n\n- 2026-08-28 08:59 · **doing→done** · \`cc\`\n  收尾\n  ${CITE_LINE}\n`,
      ),
    );
    let releaseGate!: () => void;
    vault.writeGate = new Promise<void>((r) => (releaseGate = r));
    await vi.advanceTimersByTimeAsync(8_000); // timer fires, revalidate awaits writeGate
    store.dispose(); // unload lands mid-write
    releaseGate();
    await vi.advanceTimersByTimeAsync(1_000);
    // The vault write itself completed (obsidian writes are not cancellable), but the
    // store never re-upserts after dispose — index stays on the pre-release state.
    const parsed = parseTaskFile(await vault.read(path), path);
    expect(parsed.ok && parsed.task.status).toBe('done'); // file on disk is fine
    expect(store.entryByPath(path)?.task.status).toBe('review'); // index untouched post-teardown
  });

  it('dispose() landing inside reconcileBlocked appends stops the remaining blocked-edge writes (third-audit R3)', async () => {
    // Two dependency pairs: releasing both logs two appendLog writes. Dispose lands while
    // the first append is pending — the second write must never fire.
    const mkTask = (id: string, extra: Partial<Task>): void => {
      vault.set(
        id,
        serializeTaskFile(
          { title: id, status: 'todo', created: '2026-08-24T10:00', assignee: 'cc', ...extra, id } as Task,
          '',
        ),
      );
    };
    mkTask('03 Tasks/a-parent.md', { 'blocked-by': ['03 Tasks/a-child.md'], status: 'doing' });
    mkTask('03 Tasks/a-child.md', { status: 'doing', assignee: 'user' });
    mkTask('03 Tasks/b-parent.md', { 'blocked-by': ['03 Tasks/b-child.md'], status: 'doing' });
    mkTask('03 Tasks/b-child.md', { status: 'doing', assignee: 'user' });
    const writes = vault.releaseWrites;
    let firstServed = false;
    vault.appendLogHook = async (): Promise<void> => {
      if (!firstServed) {
        firstServed = true;
        // Dispose lands mid-append (same interleaving as a dispose racing a pending
        // appendLog: by the time append #2's guard runs, disposed is already true).
        store.dispose();
      }
    };
    await store.scan(); // baseline with both children doing
    for (const child of ['03 Tasks/a-child.md', '03 Tasks/b-child.md']) {
      vault.set(child, vault.files.get(child)!.replace('status: doing', 'status: done'));
      await store.upsert(child); // releases → appendLog fires per parent
    }
    // Only ONE blocked-edge write happened; the dispose inside reconcile stopped the rest.
    expect(writes.length).toBe(1);
  });

  it('rename inside the window: the id-keyed timer fires against the new path (audit R2)', async () => {
    const path = seed();
    await store.scan();
    const raw = await vault.read(path);
    vault.set(path, raw.replace('status: doing', 'status: done'));
    await store.upsert(path); // bounce
    // Agent lands the citation, then the file is renamed (wireVaultEvents: remove old + upsert new).
    vault.set(
      path,
      (await vault.read(path)).replace(
        '## 执行记录\n',
        `## 执行记录\n\n- 2026-08-28 08:59 · **doing→done** · \`cc\`\n  收尾\n  ${CITE_LINE}\n`,
      ),
    );
    const renamed = '03 Tasks/renamed.md';
    vault.set(renamed, (await vault.read(path)).replace('03 Tasks', '03 Tasks'));
    vault.files.delete(path);
    await store.remove(path);
    await store.upsert(renamed);
    await vi.advanceTimersByTimeAsync(8_000);
    const parsed = parseTaskFile(await vault.read(renamed), renamed);
    expect(parsed.ok && parsed.task.status).toBe('done');
    expect(await vault.read(renamed)).toContain('复核门禁放行');
  });

  it('delete inside the window: the timer resolves nothing and writes nowhere (audit R2)', async () => {
    const path = seed();
    await store.scan();
    const raw = await vault.read(path);
    vault.set(path, raw.replace('status: doing', 'status: done'));
    await store.upsert(path); // bounce schedules the id-keyed timer
    vault.files.delete(path);
    await store.remove(path);
    await vi.advanceTimersByTimeAsync(8_000); // fires; entryById misses → no-op
    expect(vault.files.has(path)).toBe(false);
    expect(vault.files.size).toBe(0);
  });

  it('re-done after a bounce is disarmed by the gate marker: no second gate entry, no release (audit R5)', async () => {
    const path = seed();
    await store.scan();
    let raw = await vault.read(path);
    vault.set(path, raw.replace('status: doing', 'status: done'));
    await store.upsert(path); // bounce
    await vi.advanceTimersByTimeAsync(4_000);
    // Agent re-writes done (still no citation): the on-disk gate marker disarms a second
    // bounce (pre-existing idempotency) — the file simply stays done; the Python audit's
    // danger queue is the backstop for an unconfirmed terminal state like this.
    raw = await vault.read(path);
    vault.set(path, raw.replace('status: review', 'status: done'));
    await store.upsert(path);
    await vi.advanceTimersByTimeAsync(8_000);
    const after = await vault.read(path);
    const parsed = parseTaskFile(after, path);
    expect(parsed.ok && parsed.task.status).toBe('done');
    expect(after.split('复核门禁：拦截').length - 1).toBe(1);
    expect(after).not.toContain('复核门禁放行');
  });
});

describe('clampRevalidateMs (config range)', () => {
  it('clamps to 5–15s and falls back to 8s on garbage', () => {
    expect(clampRevalidateMs(1)).toBe(5_000);
    expect(clampRevalidateMs(8)).toBe(8_000);
    expect(clampRevalidateMs(99)).toBe(15_000);
    expect(clampRevalidateMs(Number.NaN)).toBe(8_000);
  });
});
