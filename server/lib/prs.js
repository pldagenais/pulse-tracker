// PR outcome tracking: transcripts already yield PR links per session
// (sessions.pr_links); this follows them through to merged/closed via the
// authenticated `gh` CLI. Merged/closed PRs are never re-polled.
import { execFile } from 'node:child_process';
import { safeJsonParse } from './util.js';
import { log } from './logger.js';

const RECHECK_OPEN_MS = 30 * 60_000;
const MAX_POLLS_PER_CYCLE = 5;

function ghView(url) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', url, '--json', 'state,mergedAt,additions,deletions,title'],
      { timeout: 15_000, windowsHide: true, shell: true },
      (err, stdout) => resolve(err ? null : safeJsonParse(String(stdout)))
    );
  });
}

let ghAvailable = null;
function checkGh() {
  return new Promise((resolve) => {
    if (ghAvailable != null) return resolve(ghAvailable);
    execFile('gh', ['--version'], { timeout: 8000, windowsHide: true, shell: true }, (err) => {
      ghAvailable = !err;
      if (!ghAvailable) log.info('prs: gh CLI not found — PR outcome tracking disabled');
      resolve(ghAvailable);
    });
  });
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createPrTracker(db) {
  const S = {
    sessionsWithPrs: db.prepare("SELECT id, pr_links FROM sessions WHERE pr_links IS NOT NULL AND pr_links != '[]'"),
    known: db.prepare('SELECT url FROM pr_status WHERE url=?'),
    ins: db.prepare('INSERT OR IGNORE INTO pr_status(url, repo, number, session_id) VALUES(?,?,?,?)'),
    due: db.prepare(
      `SELECT url FROM pr_status
        WHERE state IS NULL OR (state='OPEN' AND (checked_at IS NULL OR checked_at < ?))
        ORDER BY checked_at ASC NULLS FIRST LIMIT ?`
    ),
    up: db.prepare('UPDATE pr_status SET state=?, merged_at=?, additions=?, deletions=?, title=?, checked_at=? WHERE url=?'),
    touch: db.prepare('UPDATE pr_status SET checked_at=? WHERE url=?'),
  };

  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      // discover new PR links from ingested sessions
      for (const s of /** @type {any[]} */ (S.sessionsWithPrs.all())) {
        for (const pr of safeJsonParse(s.pr_links) ?? []) {
          if (!pr?.url || !/^https:\/\/github\.com\//.test(pr.url)) continue;
          S.ins.run(pr.url, pr.repo ?? null, pr.number ?? null, s.id);
        }
      }
      const due = /** @type {any[]} */ (S.due.all(Date.now() - RECHECK_OPEN_MS, MAX_POLLS_PER_CYCLE));
      if (!due.length) return;
      if (!(await checkGh())) return;
      for (const { url } of due) {
        const j = await ghView(url);
        if (!j?.state) {
          S.touch.run(Date.now(), url); // 404/private/auth issue — back off until next cycle
          continue;
        }
        S.up.run(
          j.state, j.mergedAt ? Date.parse(j.mergedAt) : null,
          j.additions ?? null, j.deletions ?? null,
          (j.title ?? '').slice(0, 200), Date.now(), url
        );
      }
      log.info(`prs: refreshed ${due.length} PR(s)`);
    } catch (e) {
      log.warn('pr tick failed:', e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }

  return { tick };
}
