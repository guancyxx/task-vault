// Decision-point protocol (FR-050). Pure parser + line-exact writer for the optional
// `## 决策点` body section. Format (spec v0.5):
//
//   ## 决策点
//   - [ ] D1 方案A：本地缓存
//   - [ ] D1 方案B：直连远端
//   - [x] D2 保持现状 ✅ 2026-08-25
//
// Lines sharing a `Dn` prefix form one mutually exclusive option group; checking an
// option marks it `- [x]` and stamps ` ✅ YYYY-MM-DD` at end of line. Writers are the
// agent (when it needs the user to choose) or the user by hand; once checked, the line
// is settled history — the writer below refuses to touch it.
//
// Parsing is deliberately tolerant (same philosophy as agentProgress): a missing section,
// blank lines, or malformed lines are skipped, never thrown — one bad line must not
// sink the sidebar scan or the detail popover. Off-section content is ignored because
// sectionBounds stops at the next `## ` heading.

import { getSection } from '../util/frontmatter';

export const DECISION_HEADING = '## 决策点';

// `Dn` — D followed by digits, then a space and the option description.
const OPTION_RE = /^-\s+\[([ xX])\]\s+(D\d+)\s+(.+)$/;

export interface DecisionOption {
  /** Group prefix, e.g. `D1` — options sharing it are mutually exclusive. */
  group: string;
  /** Option description after the `Dn ` prefix. */
  label: string;
  checked: boolean;
  /** `YYYY-MM-DD` parsed off a trailing ` ✅ date` stamp, when checked. */
  decidedAt?: string;
}

export interface DecisionLine extends DecisionOption {
  /** 0-based line index within the WHOLE body (frontmatter excluded) — write target. */
  lineIndex: number;
}

// Split a checked line's trailing ` ✅ YYYY-MM-DD` off the description.
function splitStamp(desc: string): { label: string; decidedAt?: string } {
  const m = /^(.*?)\s*✅\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(desc);
  if (!m) return { label: desc.trim() };
  return { label: m[1].trim(), decidedAt: m[2] };
}

// Parse all decision-point options from a task body. Empty/missing section → [].
// Malformed lines are skipped silently (tolerant by contract).
export function parseDecisionPoints(body: string): DecisionLine[] {
  const section = getSection(body, DECISION_HEADING);
  if (!section) return [];
  const offset = body.indexOf(section);
  const base = offset === -1 ? 0 : body.slice(0, offset).split('\n').length - 1;
  const out: DecisionLine[] = [];
  section.split('\n').forEach((line, i) => {
    const m = OPTION_RE.exec(line.trim());
    if (!m) return; // blank or malformed — skip, never throw
    const { label, decidedAt } = splitStamp(m[3]);
    out.push({
      group: m[2],
      label,
      checked: m[1].toLowerCase() === 'x',
      decidedAt,
      lineIndex: base + i,
    });
  });
  return out;
}

// Options still waiting for the user (unchecked). Drives the sidebar aggregation zone.
export function openDecisionPoints(body: string): DecisionLine[] {
  return parseDecisionPoints(body).filter((o) => !o.checked);
}

// Distinct open groups count — the number the sidebar badge shows (one decision = one
// group, however many options it has).
export function openDecisionGroupCount(body: string): number {
  return new Set(openDecisionPoints(body).map((o) => o.group)).size;
}

// Group parsed options by their `Dn` prefix, preserving section order. Used by the
// detail popover to render one button row per mutually exclusive group.
export interface DecisionGroup {
  group: string;
  options: DecisionLine[];
}

export function groupDecisionPoints(options: DecisionLine[]): DecisionGroup[] {
  const map = new Map<string, DecisionGroup>();
  for (const o of options) {
    let g = map.get(o.group);
    if (!g) {
      g = { group: o.group, options: [] };
      map.set(o.group, g);
    }
    g.options.push(o);
  }
  return [...map.values()];
}

// Local `YYYY-MM-DD` — the on-disk ✅ stamp format (FR-050).
export function stampDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Rewrite ONE line to its checked form: `- [ ] D1 …` → `- [x] D1 … ✅ date`.
// Exact, reversible string transform — the write layer locates the line first.
export function checkLine(line: string, date: string): string | null {
  const m = OPTION_RE.exec(line.trim());
  if (!m || m[1].toLowerCase() === 'x') return null; // malformed or already checked
  const { label } = splitStamp(m[3]);
  return `- [x] ${m[2]} ${label} ✅ ${date}`;
}

// Apply a decision to the body: flip the target line to checked and stamp the date.
// Surgical — ONLY the target line changes; sibling options, hand-written prose, and
// every other line stay byte-identical (the user's authored content is sacred).
// Returns null when nothing was applicable (line moved/already checked/malformed).
export function applyDecision(body: string, group: string, label: string, date: string): string | null {
  const lines = body.split('\n');
  const target = parseDecisionPoints(body).find(
    (o) => o.group === group && o.label === label && !o.checked,
  );
  if (!target || target.lineIndex >= lines.length) return null;
  const next = checkLine(lines[target.lineIndex], date);
  if (next === null) return null; // file drifted since parse — caller re-reads and retries
  lines[target.lineIndex] = next;
  return lines.join('\n');
}

// Entry text for the auto-logged execution record (FR-050): `Dn <所选选项>`.
export function decisionLogText(group: string, label: string): string {
  return `${group} ${label}`;
}
