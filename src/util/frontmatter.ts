// Frontmatter IO: pure serialization/parse for task files (FR-001, FR-002, FR-018).
//
// This is the zero-dependency serialization layer. It parses/emits the closed YAML subset
// the schema uses (scalars, string lists, and the one-level `mirror` map) — no js-yaml.
// The Obsidian adapter (processFrontMatter / Vault.modify per contract §6) lands in Phase C;
// the injectable atomic-write helper below covers the raw-fs temp+rename path (contract §6).

import { FRONTMATTER_KEYS, STATUSES, type Status, type Task } from '../model/types';

const LIST_KEYS: readonly (keyof Task)[] = ['blocked-by', 'tags'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const REMIND = /^\d+[mhd]$/;
const PRIORITIES = ['high', 'normal', 'low'];

export type ParseResult =
  | { ok: true; task: Task; body: string }
  | { ok: false; error: string };

// ---------- serialization ----------

function needsQuote(v: string): boolean {
  if (v === '') return true;
  if (/^\s|\s$/.test(v)) return true;
  if (/[:#\n"']/.test(v)) return true;
  if (/^[-?:,[\]{}&*!|>%@`]/.test(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[-+]?(\d|\.\d)/.test(v)) return true; // numbers and date-looking values
  return false;
}

function emitScalar(v: string): string {
  if (!needsQuote(v)) return v;
  const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

export function serializeTaskFile(task: Task, body: string): string {
  const lines: string[] = [];
  for (const key of FRONTMATTER_KEYS) {
    const value = task[key];
    if (value === undefined || value === null) continue;

    if (key === 'mirror') {
      const uuid = (value as Task['mirror'])!['reminders-uuid'];
      lines.push('mirror:');
      lines.push(`  reminders-uuid: ${emitScalar(uuid)}`);
      continue;
    }

    if (LIST_KEYS.includes(key)) {
      const arr = value as string[];
      if (arr.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of arr) lines.push(`  - ${emitScalar(item)}`);
      continue;
    }

    lines.push(`${key}: ${emitScalar(String(value))}`);
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

// ---------- parse ----------

function unescapeDouble(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === 'n') { out += '\n'; i++; continue; }
      if (n === '"') { out += '"'; i++; continue; }
      if (n === '\\') { out += '\\'; i++; continue; }
    }
    out += s[i];
  }
  return out;
}

function parseScalar(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return unescapeDouble(s.slice(1, -1));
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  // ponytail: our emitter quotes anything risky, so unquoted values are taken literally
  // (no inline `#` comment stripping) — keeps hand-written tag-like values intact.
  return s;
}

interface RawMap {
  [key: string]: string | string[] | Record<string, string>;
}

function parseFrontmatterBlock(text: string): RawMap {
  const out: RawMap = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || /^\s/.test(line)) continue; // skip blanks and stray indents
    const m = /^([A-Za-z][\w-]*):\s?(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const inline = m[2];

    if (inline.trim() !== '') {
      // inline flow list `[a, b]` tolerated for hand-written files
      if (inline.trim().startsWith('[') && inline.trim().endsWith(']')) {
        const inner = inline.trim().slice(1, -1).trim();
        out[key] = inner === '' ? [] : inner.split(',').map((s) => parseScalar(s));
      } else {
        out[key] = parseScalar(inline);
      }
      continue;
    }

    // block form: peek indented follow-up lines
    const items: string[] = [];
    const nested: Record<string, string> = {};
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j];
      if (!/^\s+\S/.test(next)) break; // no longer indented
      const li = /^\s+-\s+(.*)$/.exec(next);
      if (li) {
        items.push(parseScalar(li[1]));
        continue;
      }
      const kv = /^\s+([\w-]+):\s?(.*)$/.exec(next);
      if (kv) nested[kv[1]] = parseScalar(kv[2]);
    }
    i = j - 1;
    out[key] = items.length > 0 ? items : nested;
  }
  return out;
}

function fail(filePath: string, msg: string): ParseResult {
  return { ok: false, error: `${filePath}: ${msg}` };
}

export function parseTaskFile(raw: string, filePath: string): ParseResult {
  const fence = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!fence) return fail(filePath, 'missing frontmatter block');
  const body = raw.slice(fence[0].length);
  const map = parseFrontmatterBlock(fence[1]);

  const str = (k: string): string | undefined => (typeof map[k] === 'string' ? map[k] : undefined);

  for (const req of ['id', 'title', 'status', 'created']) {
    if (str(req) === undefined) return fail(filePath, `missing required field: ${req}`);
  }

  const status = str('status')!;
  if (!STATUSES.includes(status as Status)) return fail(filePath, `invalid status: ${status}`);

  for (const k of ['start', 'due'] as const) {
    const v = str(k);
    if (v !== undefined && !DATE.test(v) && !DATETIME.test(v)) return fail(filePath, `invalid ${k}: ${v}`);
  }
  for (const k of ['created', 'started', 'completed', 'dispatched'] as const) {
    const v = str(k);
    if (v !== undefined && !DATE.test(v) && !DATETIME.test(v)) return fail(filePath, `invalid ${k}: ${v}`);
  }
  const remind = str('remind');
  if (remind !== undefined && !REMIND.test(remind)) return fail(filePath, `invalid remind: ${remind}`);
  const priority = str('priority');
  if (priority !== undefined && !PRIORITIES.includes(priority)) return fail(filePath, `invalid priority: ${priority}`);

  const task: Task = {
    id: str('id')!,
    title: str('title')!,
    status: status as Status,
    created: str('created')!,
  };
  const assign = (k: keyof Task): void => {
    const v = str(k);
    if (v !== undefined) (task as unknown as Record<string, unknown>)[k] = v;
  };
  for (const k of [
    'start', 'due', 'remind', 'started', 'completed', 'priority',
    'source', 'assignee', 'dispatched', 'project', 'area', 'parent',
  ] as (keyof Task)[]) {
    assign(k);
  }
  for (const k of LIST_KEYS) {
    if (Array.isArray(map[k])) (task as unknown as Record<string, unknown>)[k] = map[k];
  }
  const mirror = map['mirror'];
  if (mirror && typeof mirror === 'object' && !Array.isArray(mirror) && mirror['reminders-uuid']) {
    task.mirror = { 'reminders-uuid': mirror['reminders-uuid'] };
  }

  return { ok: true, task, body };
}

// ---------- body sections (## 执行记录 / ## 委派) ----------

function sectionBounds(body: string, heading: string): { start: number; end: number } | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading.trim());
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

export function getSection(body: string, heading: string): string | null {
  const bounds = sectionBounds(body, heading);
  if (!bounds) return null;
  const lines = body.split('\n');
  return lines.slice(bounds.start + 1, bounds.end).join('\n').replace(/^\n+|\n+$/g, '');
}

export function upsertSection(body: string, heading: string, content: string): string {
  const bounds = sectionBounds(body, heading);
  const lines = body.split('\n');
  if (bounds) {
    const before = lines.slice(0, bounds.start + 1);
    const after = lines.slice(bounds.end);
    return [...before, content, ...(after.length ? ['', ...after] : [])].join('\n');
  }
  const sep = body.trim() === '' ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${heading}\n${content}\n`;
}

// ---------- delegation rounds (FR-048) ----------

// Round header format: `### 第N轮 YYYY-MM-DD`. The regex is the parse contract — rounds are
// appended newest-first, so the next round number is max(existing) + 1 (tolerates gaps/legacy
// bodies with no rounds yet: an un-roundified legacy instruction becomes round 1's tail).
// NOTE: no \b after 轮 — CJK chars are non-word chars to JS regex, so \b never matches there.
const ROUND_RE = /^###\s*第(\d+)轮(?=\s|$)/;

export function parseRoundHeads(body: string, heading: string): Array<{ n: number; line: number }> {
  const bounds = sectionBounds(body, heading);
  if (!bounds) return [];
  const lines = body.split('\n');
  const heads: Array<{ n: number; line: number }> = [];
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const m = ROUND_RE.exec(lines[i]);
    if (m) heads.push({ n: Number(m[1]), line: i });
  }
  return heads;
}

// Pure stateless round-append (FR-048): the `## 委派` section is NOT whole-replaced — the new
// instruction becomes the newest round at the top and prior rounds are preserved verbatim.
// Round layout (newest first, one blank line between rounds):
//
//   ## 委派
//   ### 第2轮 2026-08-25
//   <new instruction>
//
//   ### 第1轮 2026-08-24
//   <previous content — or a legacy un-roundified instruction>
export function appendDelegationRound(
  body: string,
  heading: string,
  instruction: string,
  date: Date,
): string {
  const text = instruction.trim();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const heads = parseRoundHeads(body, heading);
  const next = (heads.length ? Math.max(...heads.map((h) => h.n)) : 0) + 1;
  const round = `### 第${next}轮 ${day}\n${text}`;

  const bounds = sectionBounds(body, heading);
  const lines = body.split('\n');
  if (bounds) {
    const existing = lines
      .slice(bounds.start + 1, bounds.end)
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
    const content = existing ? `${round}\n\n${existing}` : round;
    return upsertSection(body, heading, content);
  }
  const sep = body.trim() === '' ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${heading}\n${round}\n`;
}

// ---------- atomic write (contract §6: temp + rename) ----------

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export async function atomicWrite(fs: FileSystem, path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}
