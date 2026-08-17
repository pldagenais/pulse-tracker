// Read-only git correlation: commits per project joined to session time
// windows ("what did this session actually ship?"). Never writes to any repo.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { log } from './logger.js';

const LOOKBACK_MS = 90 * 24 * 3600_000; // first scan reaches back this far
const WINDOW_LEAD_MS = 5 * 60_000; // commit may precede session start slightly
const WINDOW_TRAIL_MS = 15 * 60_000; // ...or land shortly after the last event

function gitLog(dir, sinceMs) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'log', `--since=${new Date(sinceMs).toISOString()}`, '--no-merges',
       '--pretty=format:\x01%H\t%at\t%s', '--numstat'],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null); // not a repo / git missing / timeout
        const commits = [];
        for (const chunk of String(stdout).split('\x01')) {
          if (!chunk.trim()) continue;
          const lines = chunk.split('\n');
          const [sha, at, ...subj] = lines[0].split('\t');
          if (!sha || !at) continue;
          let add = 0;
          let del = 0;
          for (const l of lines.slice(1)) {
            const m = l.match(/^(\d+)\t(\d+)\t/);
            if (m) { add += Number(m[1]); del += Number(m[2]); }
          }
          commits.push({ sha, ts: Number(at) * 1000, message: (subj.join('\t') || '').slice(0, 200), additions: add, deletions: del });
        }
        resolve(commits);
      }
    );
  });
}

/**
 * Parse `git log --pretty=format:\x01%H\t%at\t%s --numstat` output.
 * Exported so it can be tested without a real repository.
 * @param {string} stdout
 */
export function parseNumstat(stdout) {
  const commits = [];
  for (const chunk of String(stdout).split('\x01')) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const [sha, at, ...subj] = lines[0].split('\t');
    if (!sha || !at) continue;
    const files = [];
    for (const l of lines.slice(1)) {
      // binary files report "-\t-\tpath"
      const m = l.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      files.push({
        path: m[3],
        added: m[1] === '-' ? 0 : Number(m[1]),
        removed: m[2] === '-' ? 0 : Number(m[2]),
      });
    }
    commits.push({
      sha,
      ts: Number(at) * 1000,
      message: (subj.join('\t') || '').slice(0, 200),
      files,
    });
  }
  return commits;
}

/**
 * Commits with per-file counts inside a window. Read live — file paths are
 * never persisted (see the CLAUDE.md rule on file contents).
 * @param {string} dir
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Promise<ReturnType<typeof parseNumstat> | null>} null = not a repo / git missing / timeout
 */
export function commitsWithFiles(dir, fromMs, toMs) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'log',
       `--since=${new Date(fromMs).toISOString()}`,
       `--until=${new Date(toMs).toISOString()}`,
       '--no-merges', '--pretty=format:\x01%H\t%at\t%s', '--numstat'],
      { timeout: 20_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? null : parseNumstat(String(stdout)))
    );
  });
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createGitScanner(db) {
  const S = {
    projects: db.prepare('SELECT id, path, parent_project_id FROM projects'),
    maxTs: db.prepare('SELECT max(author_ts) t FROM commits WHERE project_id=?'),
    ins: db.prepare('INSERT OR IGNORE INTO commits(project_id, sha, author_ts, message, additions, deletions) VALUES(?,?,?,?,?,?)'),
    unattributed: db.prepare('SELECT id, project_id, author_ts FROM commits WHERE session_id IS NULL'),
    setSession: db.prepare('UPDATE commits SET session_id=? WHERE id=?'),
    findSession: db.prepare(
      `SELECT s.id FROM sessions s
        WHERE s.project_id IN (SELECT id FROM projects WHERE id=? OR parent_project_id=? OR id=(SELECT parent_project_id FROM projects WHERE id=?))
          AND s.started_at - ? <= ?
          AND COALESCE(s.ended_at, s.last_event_at, s.started_at) + ? >= ?
        ORDER BY s.started_at DESC LIMIT 1`
    ),
  };

  let running = false;

  async function scanAll() {
    if (running) return;
    running = true;
    try {
      const projects = /** @type {any[]} */ (S.projects.all());
      let added = 0;
      for (const p of projects) {
        if (!p.path || !fs.existsSync(path.join(p.path, '.git'))) continue;
        const since = /** @type {any} */ (S.maxTs.get(p.id))?.t ?? Date.now() - LOOKBACK_MS;
        const commits = await gitLog(p.path, since - 60_000);
        if (!commits) continue;
        for (const c of commits) {
          const r = S.ins.run(p.id, c.sha, c.ts, c.message, c.additions, c.deletions);
          added += Number(r.changes);
        }
      }
      // attribute new commits to the session whose window contains them
      let attributed = 0;
      for (const c of /** @type {any[]} */ (S.unattributed.all())) {
        const hit = /** @type {any} */ (S.findSession.get(c.project_id, c.project_id, c.project_id, WINDOW_LEAD_MS, c.author_ts, WINDOW_TRAIL_MS, c.author_ts));
        if (hit?.id) {
          S.setSession.run(hit.id, c.id);
          attributed++;
        }
      }
      if (added || attributed) log.info(`git: ${added} new commits, ${attributed} attributed to sessions`);
    } catch (e) {
      log.warn('git scan failed:', e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }

  return { scanAll };
}
