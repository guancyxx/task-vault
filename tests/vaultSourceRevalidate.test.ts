// FR-030b re-review R1: integration tests against the REAL VaultSource.revalidateReviewGate
// (previous suites exercised only a simplified in-memory mirror, which is exactly why the
// ③↔④ race was invisible). The fake App below implements just vault.read/process and
// fileManager.processFrontMatter with faithful read-modify-write semantics; `onProcess`
// lets a test inject a concurrent write between our verify-read (③) and the append (④).
import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { VaultSource } from '../src/store/vaultSource';
import { applyReviewGate, REVIEW_RELEASE_TEXT } from '../src/store/reviewGate';
import { parseTaskFile, serializeTaskFile } from '../src/util/frontmatter';
import type { Task } from '../src/model/types';

const NOW = new Date(2026, 7, 28, 9, 0);
const CITE_LINE = 'user-confirm: session=20260824_064634_c34e81 msg=70026 quote="做"';

function mkTFile(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype), { path });
}

// Minimal read-modify-write frontmatter processor: parses flat `key: value` lines, applies
// the mutation, re-serializes in place (list items like tags keep their own lines verbatim).
function fakeApp(files: Map<string, string>, onProcess?: (path: string) => void): App {
  const vault = {
    getMarkdownFiles: () => [...files.keys()].map((p) => mkTFile(p)),
    getAbstractFileByPath: (p: string) => (files.has(p) ? mkTFile(p) : null),
    read: async (f: TFile) => {
      const v = files.get(f.path);
      if (v === undefined) throw new Error(`ENOENT ${f.path}`);
      return v;
    },
    process: async (f: TFile, cb: (data: string) => string) => {
      onProcess?.(f.path);
      const cur = files.get(f.path);
      if (cur === undefined) throw new Error(`ENOENT ${f.path}`);
      files.set(f.path, cb(cur));
    },
  };
  const fileManager = {
    processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
      const raw = files.get(f.path)!;
      const m = /^---\n([\s\S]*?)\n---\n/.exec(raw)!;
      const lines = m[1].split('\n');
      const fm: Record<string, unknown> = {};
      const keyLines = new Map<string, number>();
      lines.forEach((line, i) => {
        const mm = /^([\w-]+):/.exec(line);
        if (mm) {
          fm[mm[1]] = line.slice(mm[1].length + 1).trim();
          keyLines.set(mm[1], i);
        }
      });
      fn(fm);
      for (const [k, i] of keyLines) {
        if (!(k in fm)) lines[i] = ''; // deleted key → drop its line
        else lines[i] = `${k}: ${fm[k]}`;
      }
      const newKeys = Object.keys(fm).filter((k) => !keyLines.has(k));
      const out = lines.filter((l) => l !== '').concat(newKeys.map((k) => `${k}: ${fm[k]}`));
      files.set(f.path, `---\n${out.join('\n')}\n---` + raw.slice(m[0].length));
    },
  };
  return { vault, fileManager } as unknown as App;
}

// Seed the post-bounce state exactly as the incident shapes it: agent did→done (no cite),
// gate bounced to review, then the agent's citation patch landed in the body.
function seedGated(files: Map<string, string>, path = '03 Tasks/t.md'): void {
  const task = {
    id: 't',
    title: 't',
    status: 'done',
    created: '2026-08-24T10:00',
    assignee: 'cc',
    completed: '2026-08-28T08:59',
  } as Task;
  const agentBody =
    `## 执行记录\n\n- 2026-08-28 08:59 · **doing→done** · \`cc\`\n  收尾\n  ${CITE_LINE}\n`;
  const gated = applyReviewGate(task, agentBody, new Date(2026, 7, 28, 8, 59, 30));
  files.set(path, serializeTaskFile(gated.task, gated.body));
}

describe('VaultSource.revalidateReviewGate (real implementation, re-review R1)', () => {
  it('releases a qualifying bounce: done restored, completed stamped, one release entry, verify-true', async () => {
    const files = new Map<string, string>();
    seedGated(files);
    const source = new VaultSource(fakeApp(files));
    await expect(source.revalidateReviewGate('03 Tasks/t.md', NOW)).resolves.toBe(true);
    const parsed = parseTaskFile(files.get('03 Tasks/t.md')!, '03 Tasks/t.md');
    expect(parsed.ok && parsed.task.status).toBe('done');
    expect(parsed.ok && parsed.task.completed).toBe('2026-08-28T09:00');
    expect((files.get('03 Tasks/t.md')!.match(new RegExp(REVIEW_RELEASE_TEXT, 'g')) ?? []).length).toBe(1);
  });

  it.each(['review', 'doing', 'todo'] as const)(
    'concurrent flip to %s between verify(③) and append(④): no release entry, no false disarm',
    async (flipped) => {
      const files = new Map<string, string>();
      seedGated(files);
      // The flip lands after our verify-read but before vault.process's callback sees the
      // text — at that point step ② already restored status to done, so the concurrent
      // writer overwrites `status: done` with the flipped value.
      const app = fakeApp(files, () => {
        const raw = files.get('03 Tasks/t.md')!;
        files.set('03 Tasks/t.md', raw.replace('status: done', `status: ${flipped}`));
      });
      const source = new VaultSource(app);
      await expect(source.revalidateReviewGate('03 Tasks/t.md', NOW)).resolves.toBe(false);
      const raw = files.get('03 Tasks/t.md')!;
      expect(raw).not.toContain(REVIEW_RELEASE_TEXT);
      const reparsed = parseTaskFile(raw, '03 Tasks/t.md');
      expect(reparsed.ok && reparsed.task.status).toBe(flipped);
      // Re-armable: a fresh gate cycle can bounce again later — the disarm marker never landed.
    },
  );

  it('no confirmation in the body: byte-identical no-op, returns false', async () => {
    const files = new Map<string, string>();
    seedGated(files);
    const raw = files.get('03 Tasks/t.md')!.replace(CITE_LINE, '');
    files.set('03 Tasks/t.md', raw);
    const before = files.get('03 Tasks/t.md')!;
    const source = new VaultSource(fakeApp(files));
    await expect(source.revalidateReviewGate('03 Tasks/t.md', NOW)).resolves.toBe(false);
    expect(files.get('03 Tasks/t.md')).toBe(before);
  });
});
