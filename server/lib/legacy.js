import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from '../config.js';
import { getMeta, setMeta } from './db.js';
import { readLines } from './lineReader.js';
import { sha1, safeJsonParse, localDayKey } from './util.js';
import { log } from './logger.js';

/**
 * One-time import of low-fidelity history that predates the transcript era:
 *  - stats-cache.json: Claude Code's own daily rollup (Jan-Apr 2026) -> legacy_daily
 *  - history.jsonl: prompt history with real project paths (ends Jul 2026) -> prompts(kind='legacy')
 * Runs after the transcript backfill (needs sessions + first-event date).
 */
export async function importLegacy(db, projectIdFor) {
  if (getMeta(db, 'legacy_imported') === '1') return;

  const firstTs = db.prepare('SELECT MIN(ts) AS t FROM events').get()?.t ?? null;
  const cutoffDay = firstTs ? localDayKey(firstTs) : '9999-12-31';

  // ---- stats-cache.json -> legacy_daily (only days before transcripts exist) ----
  try {
    const raw = fs.readFileSync(path.join(CLAUDE_DIR, 'stats-cache.json'), 'utf8');
    const cache = safeJsonParse(raw);
    const days = Array.isArray(cache?.dailyActivity) ? cache.dailyActivity : [];
    const ins = db.prepare(
      `INSERT OR REPLACE INTO legacy_daily(date, message_count, session_count, tool_call_count, prompt_count, source)
       VALUES(?,?,?,?,NULL,'stats-cache')`
    );
    let n = 0;
    for (const d of days) {
      if (typeof d?.date !== 'string' || d.date >= cutoffDay) continue;
      ins.run(d.date, d.messageCount ?? null, d.sessionCount ?? null, d.toolCallCount ?? null);
      n++;
    }
    log.info(`legacy: imported ${n} days from stats-cache.json (cutoff ${cutoffDay})`);
  } catch (e) {
    log.warn('legacy: stats-cache.json import skipped:', e.message);
  }

  // ---- history.jsonl -> prompts(kind='legacy') for sessions we have no transcript for ----
  try {
    const histPath = path.join(CLAUDE_DIR, 'history.jsonl');
    const hasSession = db.prepare('SELECT 1 FROM sessions WHERE id=? LIMIT 1');
    const ins = db.prepare(
      `INSERT OR IGNORE INTO prompts(uuid, session_id, project_id, ts, kind, command_name, text, char_count)
       VALUES(?,?,?,?,'legacy',?,?,?)`
    );
    let n = 0;
    db.exec('BEGIN');
    try {
      for await (const { text } of readLines(histPath, 0)) {
        const row = safeJsonParse(text);
        if (!row || typeof row.display !== 'string' || typeof row.timestamp !== 'number') continue;
        if (row.timestamp < 1500000000000 || row.timestamp > 2000000000000) continue; // sanity: epoch ms
        const sid = typeof row.sessionId === 'string' ? row.sessionId : 'unknown';
        if (hasSession.get(sid)) continue; // covered by transcripts at full fidelity
        const projectId = row.project ? projectIdFor(row.project) : 0;
        const display = row.display.trim();
        if (!display) continue;
        const command = display.startsWith('/') ? display.split(/\s+/)[0] : null;
        ins.run(
          `hist:${sha1(`${sid}|${row.timestamp}|${display}`)}`,
          sid, projectId ?? 0, row.timestamp, command, display.slice(0, 10000), display.length
        );
        n++;
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    log.info(`legacy: imported ${n} prompts from history.jsonl`);
  } catch (e) {
    log.warn('legacy: history.jsonl import skipped:', e.message);
  }

  setMeta(db, 'legacy_imported', '1');
}
