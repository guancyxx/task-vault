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

  it('closing fence followed by TWO newlines keeps both (full-string equality)', () => {
    const raw = '---\nstatus: review\n---\n\n## 执行记录\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toBe(`---\nstatus: done\ncompleted: ${TS}\n---\n\n## 执行记录\n`);
  });

  it('no trailing newline at EOF still round-trips', () => {
    const raw = '---\nstatus: review\n---\nbody no newline';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out.endsWith('---\nbody no newline')).toBe(true);
    expect(out).toContain('status: done');
  });

  it('tags list and mirror block lines survive verbatim (full-string equality)', () => {
    const raw =
      '---\nstatus: review\ntags:\n- repo/task-vault\n- plugin\nmirror:\n  reminders-uuid: ABCD\n---\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toBe(
      `---\nstatus: done\ncompleted: ${TS}\ntags:\n- repo/task-vault\n- plugin\nmirror:\n  reminders-uuid: ABCD\n---\n`,
    );
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
    const raw = '---\nstatus: review\ncompleted: 2020-01-01T00:00\n---\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toBe(`---\nstatus: done\ncompleted: ${TS}\n---\n`);
    expect(out).not.toContain('completed: 2020-01-01T00:00');
  });

  it('duplicate completed lines: FIRST is rewritten, SECOND is left verbatim (pins current behavior)', () => {
    // Real two-line duplicate (the previous fixture had only one completed line — the claimed
    // coverage did not exist). Parser reads last-wins, so the stale second line would win on
    // parse; the post-RMW verify compares status/marker only, making this benign. Pinned so
    // any future change here is deliberate.
    const raw = '---\nstatus: review\ncompleted: 2020-01-01T00:00\ncompleted: 2021-06-30T12:00\n---\n';
    const out = restoreDoneInFence(raw, TS)!;
    expect(out).toBe(`---\nstatus: done\ncompleted: ${TS}\ncompleted: 2021-06-30T12:00\n---\n`);
  });
});
