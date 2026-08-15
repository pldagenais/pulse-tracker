import crypto from 'node:crypto';

export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

export function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Merge overlapping/touching {start,end} intervals (epoch ms). Returns new sorted array.
 * @param {{start:number,end:number}[]} intervals
 */
export function mergeIntervals(intervals) {
  const sorted = intervals.filter((iv) => iv.end > iv.start).sort((a, b) => a.start - b.start);
  /** @type {{start:number,end:number}[]} */
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

export function sumIntervals(intervals) {
  return intervals.reduce((s, iv) => s + (iv.end - iv.start), 0);
}

/** Clip interval to [a,b); null if no overlap. */
export function clipInterval(iv, a, b) {
  const start = Math.max(iv.start, a);
  const end = Math.min(iv.end, b);
  return end > start ? { start, end } : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD for an epoch-ms timestamp. */
export function localDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** [startMs, endMs) local-day bounds for YYYY-MM-DD (DST-safe: end = next local midnight). */
export function dayBounds(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

export function addDays(dayKey, n) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + n).getTime());
}

export function todayKey() {
  return localDayKey(Date.now());
}

/** Local hour (0-23) for an epoch-ms timestamp. */
export function localHour(ts) {
  return new Date(ts).getHours();
}

/** Simple async sleep. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Yield to the event loop (keeps HTTP responsive during synchronous DB batches). */
export const yieldLoop = () => new Promise((r) => setImmediate(r));
