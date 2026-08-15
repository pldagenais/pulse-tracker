import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from '../config.js';

const RETENTION_MS = 14 * 24 * 3600 * 1000;

let stream = null;
let streamDay = '';

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function getStream() {
  const day = dayKey();
  if (!stream || streamDay !== day) {
    try { stream?.end(); } catch { /* ignore */ }
    streamDay = day;
    fs.mkdirSync(LOG_DIR, { recursive: true });
    stream = fs.createWriteStream(path.join(LOG_DIR, `server-${day}.log`), { flags: 'a' });
    stream.on('error', () => { stream = null; });
    cleanupOldLogs();
  }
  return stream;
}

function cleanupOldLogs() {
  try {
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.startsWith('server-') || !f.endsWith('.log')) continue;
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch { /* best effort */ }
}

function write(level, args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : JSON.stringify(a)))
    .join(' ');
  const line = `${new Date().toISOString()} [${level}] ${text}`;
  try { getStream()?.write(line + '\n'); } catch { /* best effort */ }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);
}

export const log = {
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  /** Synchronous append — for crash handlers that exit immediately after
   * (the async stream write would be lost before it flushes). */
  fatal: (...a) => {
    const text = a
      .map((x) => (typeof x === 'string' ? x : x instanceof Error ? (x.stack || x.message) : JSON.stringify(x)))
      .join(' ');
    const line = `${new Date().toISOString()} [fatal] ${text}\n`;
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, `server-${dayKey()}.log`), line);
    } catch { /* best effort */ }
    console.error(line.trimEnd());
  },
};
