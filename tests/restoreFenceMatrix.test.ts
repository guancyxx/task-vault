// PR #41 follow-up (audit nit): malformed-frontmatter regression matrix for
// restoreDoneInFence — the fence rewriter inside the FR-030b release RMW. These pin the
// CURRENT defensive behavior; they are not new features. Every case feeds the PURE function
// directly (exported test-only, same precedent as reviewGate.localIsoMinute).
import { describe, expect, it } from 'vitest';
import { restoreDoneInFence } from '../src/store/vaultSource';

const TS = '2026-08-28T09:00';

describe('restoreDoneInFence malformed-fence matrix (PR #41 follow-up nit)', () => {
  it('happy path: status flip + completed insert, everything else verbatim', () => {
    const raw =
      '---\nid: t\ntitle: t\nstatus: review\ncreated: 2026-08-24T10:00\n---\n## 执行记录\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toBe(
      `---\nid: t\ntitle: t\nstatus: done\ncompleted: ${TS}\ncreated: 2026-08-24T10:00\n---\n## 执行记录\n`,
    );
  });

  it('closing fence followed by TWO newlines keeps both (body slice byte-exact)', () => {
    const raw = '---\nstatus: review\n---\n\n## 执行记录\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out.startsWith('---\nstatus: done\ncompleted: 2026-08-28T09:00\n---\n\n')).toBe(true);
  });

  it('no trailing newline at EOF still round-trips', () => {
    const raw = '---\nstatus: review\n---\nbody no newline';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out.endsWith('---\nbody no newline')).toBe(true);
    expect(out).toContain('status: done');
  });

  it('tags list and mirror block lines survive verbatim', () => {
    const raw =
      '---\nstatus: review\ntags:\n- repo/task-vault\n- plugin\nmirror:\n  reminders-uuid: ABCD\n---\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toContain('- repo/task-vault\n- plugin');
    expect(out).toContain('  reminders-uuid: ABCD');
  });

  it('duplicate status lines abort atomically (null, no partial rewrite)', () => {
    // The frontmatter parser takes the LAST duplicate value; a first-line review with a
    // second doing must not be half-flipped — the rewriter refuses the whole fence.
    const raw = '---\nstatus: review\nstatus: doing\n---\n';
    expect(restoreDoneInFence(raw, TS)).toBeNull();
  });

  it('non-review status aborts (null)', () => {
    expect(restoreDoneInFence('---\nstatus: doing\n---\n', TS)).toBeNull();
  });

  it('missing status line aborts (null)', () => {
    expect(restoreDoneInFence('---\nid: t\n---\n', TS)).toBeNull();
  });

  it('no fence at all aborts (null)', () => {
    expect(restoreDoneInFence('just body text\n', TS)).toBeNull();
  });

  it('existing stale completed line is refreshed in place (pins current behavior)', () => {
    // Current behavior: the FIRST completed: line is rewritten; a second duplicate (itself
    // malformed) is left verbatim. Parser-side last-wins on read means the stale duplicate
    // would win on parse — but the verify read after the RMW compares status/marker only,
    // so this is benign; pinned here so a future change is deliberate.
    const raw = '---\nstatus: review\ncompleted: 2020-01-01T00:00\n---\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toContain(`completed: ${TS}`);
    expect(out).not.toContain('completed: 2020-01-01T00:00');
  });
});
