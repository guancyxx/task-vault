// Chinese NL time parser (FR-009, SC-006). Closed regex-pipeline, `now` injected.
// Maps a capture-box string → {start?, due, dueIsDateTime, remind?, consumed}; null on failure
// (caller drops the untouched original into inbox — no character loss).
//
// Pipeline order per call: reminder-offset → date (absolute → compound 今/明+早晚 → relative day
// → weekday) → standalone period → time (colon → 点). A bare time with no day defaults to today
// and rolls to tomorrow if already past. `start` is not produced by the v1 closed set.

const DAY_MS = 86_400_000;

export interface NlDate {
  start?: string; // reserved; no phrase in the v1 closed set yields a start
  due: string; // YYYY-MM-DD | YYYY-MM-DDTHH:MM
  dueIsDateTime: boolean;
  remind?: string; // offset before due, e.g. "30m" | "1h" | "1d"
  consumed: string; // title text remaining after stripping time words
}

type Period = 'am' | 'pm' | 'noon' | null;

const pad = (n: number): string => String(n).padStart(2, '0');
const dayStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateTimeStr = (d: Date): string => `${dayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

export function parseNlDate(text: string, now: Date): NlDate | null {
  let rest = text;
  const remove = (m: RegExpExecArray): void => {
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  };
  const dayAt = (offset: number): Date =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const validMD = (mo: number, d: number): boolean => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

  // 1. reminder offset
  let remind: string | undefined;
  const rm = /提前\s*(\d+)\s*(分钟|分|个小时|小时|时|天)\s*(?:提醒|提示)?/.exec(rest);
  if (rm) {
    const u = rm[2];
    const unit = u === '天' ? 'd' : u === '分钟' || u === '分' ? 'm' : 'h';
    remind = `${rm[1]}${unit}`;
    remove(rm);
  }

  // 2. date
  let dayDate: Date | null = null;
  let period: Period = null;
  let m: RegExpExecArray | null;

  if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(rest))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validMD(mo, d)) {
      dayDate = new Date(y, mo - 1, d);
      remove(m);
    }
  }
  if (!dayDate && (m = /(\d{1,2})月(\d{1,2})[号日]?/.exec(rest))) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (validMD(mo, d)) {
      dayDate = new Date(now.getFullYear(), mo - 1, d);
      remove(m);
    }
  }
  if (!dayDate && (m = /(\d{1,2})\/(\d{1,2})/.exec(rest))) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (validMD(mo, d)) {
      dayDate = new Date(now.getFullYear(), mo - 1, d);
      remove(m);
    }
  }
  // compound 今/明 + 早/晚/晨 carries both an explicit day and a period
  if (!dayDate && (m = /(今|明)([早晚晨])/.exec(rest))) {
    dayDate = dayAt(m[1] === '明' ? 1 : 0);
    period = m[2] === '晚' ? 'pm' : 'am';
    remove(m);
  }
  if (!dayDate && (m = /大后天|后天|明天|明日|今天|今日/.exec(rest))) {
    const w = m[0];
    const off = w === '大后天' ? 3 : w === '后天' ? 2 : w === '明天' || w === '明日' ? 1 : 0;
    dayDate = dayAt(off);
    remove(m);
  }
  if (!dayDate && (m = /(下周|下星期|下礼拜|本周|这周|周|星期|礼拜)([一二三四五六日天])/.exec(rest))) {
    let delta = (WEEKDAY[m[2]] - now.getDay() + 7) % 7;
    if (/^下/.test(m[1])) delta += 7;
    dayDate = dayAt(delta);
    remove(m);
  }

  // 3. standalone period (only if not already set by a compound token)
  if (period === null && (m = /凌晨|早上|上午|中午|下午|傍晚|晚上|晚|早/.exec(rest))) {
    const p = m[0];
    period = /凌晨|早上|上午|早/.test(p) ? 'am' : p === '中午' ? 'noon' : 'pm';
    remove(m);
  }

  // 4. time — colon first, then 点
  let time: { h: number; m: number } | null = null;
  if ((m = /(\d{1,2})[:：](\d{1,2})(?:之前|前)?/.exec(rest))) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h <= 23 && mi <= 59) {
      time = { h, m: mi };
      remove(m);
    }
  }
  if (!time && (m = /(\d{1,2})\s*点\s*(半|[0-5]?\d)?\s*分?(?:之前|前)?/.exec(rest))) {
    const h = Number(m[1]);
    const mi = m[2] === '半' ? 30 : m[2] !== undefined ? Number(m[2]) : 0;
    if (h <= 23 && mi <= 59) {
      time = { h, m: mi };
      remove(m);
    }
  }
  if (time) {
    if (period === 'pm' && time.h < 12) time.h += 12;
    else if (period === 'am' && time.h === 12) time.h = 0;
    // noon / other combinations leave the hour as written
  }

  // 5. combine
  if (!dayDate && !time) return null;

  let due: string;
  let dueIsDateTime: boolean;
  if (time && !dayDate) {
    // bare time → today, rolling to tomorrow if the moment already passed
    let dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.h, time.m);
    if (dt.getTime() <= now.getTime()) dt = new Date(dt.getTime() + DAY_MS);
    due = dateTimeStr(dt);
    dueIsDateTime = true;
  } else if (dayDate && !time) {
    due = dayStr(dayDate);
    dueIsDateTime = false;
  } else {
    const dt = new Date(dayDate!.getFullYear(), dayDate!.getMonth(), dayDate!.getDate(), time!.h, time!.m);
    due = dateTimeStr(dt);
    dueIsDateTime = true;
  }

  const consumed = rest.replace(/\s+/g, ' ').replace(/^[\s，。、,.]+|[\s，。、,.]+$/g, '').trim();
  const result: NlDate = { due, dueIsDateTime, consumed };
  if (remind) result.remind = remind;
  return result;
}
