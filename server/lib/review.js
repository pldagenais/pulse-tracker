// Day-first change review: what changed in a project, day by day, grouped by
// feature. Commits and their file lists are read LIVE from git — the schema
// stores no file paths, and CLAUDE.md forbids persisting file contents.
import fs from 'node:fs';
import path from 'node:path';
import { commitsWithFiles } from './git.js';
import { dayBounds, localDayKey, sha1 } from './util.js';

/** Fixed by the spec. Commits are lumpy; one merge day must not crowd out the rest. */
export const CAPS = { filesPerCommit: 20, commitsPerDay: 40, promptsPerDay: 60, promptChars: 1000 };

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} projectId
 * @param {string} from local YYYY-MM-DD
 * @param {string} to   local YYYY-MM-DD
 */
export async function buildDayReview(db, projectId, from, to) {
  const p = /** @type {any} */ (db.prepare('SELECT id, name, path FROM projects WHERE id=?').get(projectId));
  if (!p) return null;
  const fam = /** @type {any[]} */ (db.prepare('SELECT id, path FROM projects WHERE id=? OR parent_project_id=?').all(projectId, projectId));
  const ids = fam.map((r) => r.id);
  const paths = fam.map((r) => r.path).filter(Boolean);
  const ph = ids.map(() => '?').join(',');
  const jph = paths.map(() => '?').join(',');
  const [fromMs] = dayBounds(from);
  const [, toMs] = dayBounds(to);

  /** @type {Map<string, any>} */
  const byDay = new Map();
  const dayOf = (key) => {
    let d = byDay.get(key);
    if (!d) {
      d = { date: key, commits: [], commitsOmitted: 0, sessions: [], prompts: [], promptsOmitted: 0, journal: [] };
      byDay.set(key, d);
    }
    return d;
  };

  for (const s of /** @type {any[]} */ (db.prepare(
    `SELECT title, last_prompt, started_at, claude_ms, prompt_count, est_cost_usd
       FROM sessions WHERE project_id IN (${ph}) AND started_at>=? AND started_at<? ORDER BY started_at`
  ).all(...ids, fromMs, toMs))) {
    dayOf(localDayKey(s.started_at)).sessions.push({
      title: s.title ?? s.last_prompt ?? 'Untitled session',
      claudeMs: s.claude_ms,
      promptCount: s.prompt_count,
      estCostUsd: s.est_cost_usd,
    });
  }

  for (const r of /** @type {any[]} */ (db.prepare(
    `SELECT ts, length(text) AS full_len, substr(text,1,${CAPS.promptChars}) t FROM prompts
      WHERE project_id IN (${ph}) AND ts>=? AND ts<? AND kind IN ('typed','command') ORDER BY ts`
  ).all(...ids, fromMs, toMs))) {
    const d = dayOf(localDayKey(r.ts));
    if (d.prompts.length < CAPS.promptsPerDay) {
      // A prompt cut mid-sentence at the SQL level must not read to the
      // model as a complete prompt — carry the original length so
      // renderReviewInput can say so.
      d.prompts.push({
        text: String(r.t).replace(/\s+/g, ' '),
        truncatedFrom: r.full_len > CAPS.promptChars ? r.full_len : null,
      });
    } else d.promptsOmitted++;
  }

  if (jph) {
    for (const j of /** @type {any[]} */ (db.prepare(
      `SELECT ts, text FROM journal WHERE project_path IN (${jph}) AND ts>=? AND ts<? ORDER BY ts`
    ).all(...paths, fromMs, toMs))) {
      dayOf(localDayKey(j.ts)).journal.push(j.text);
    }
  }

  // Live git read, one call per checkout (worktrees are separate paths).
  let gitAvailable = false;
  for (const repo of paths) {
    if (!fs.existsSync(path.join(repo, '.git'))) continue;
    const commits = await commitsWithFiles(repo, fromMs, toMs);
    if (!commits) continue;
    gitAvailable = true;
    for (const c of commits) {
      const d = dayOf(localDayKey(c.ts));
      if (d.commits.length >= CAPS.commitsPerDay) { d.commitsOmitted++; continue; }
      d.commits.push({
        sha: c.sha.slice(0, 7),
        message: c.message,
        files: c.files.slice(0, CAPS.filesPerCommit),
        filesOmitted: Math.max(0, c.files.length - CAPS.filesPerCommit),
      });
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const inputHash = reviewInputHash(days);

  const cached = /** @type {any} */ (db.prepare(
    'SELECT markdown, input_hash, created_at FROM project_reviews WHERE project_path=? AND period_from=? AND period_to=?'
  ).get(p.path, from, to));

  return {
    project: { id: p.id, name: p.name, path: p.path },
    from, to, days, gitAvailable, inputHash,
    cached: cached
      ? { markdown: cached.markdown, createdAt: cached.created_at, stale: cached.input_hash !== inputHash }
      : null,
  };
}

/**
 * Hash the parts of the assembled days that determine whether a cached
 * review is still current. Commits are an input: without their shas in the
 * hash, a new commit leaves a cached review looking current while
 * describing a stale repo. Omitted-counts are an input too: once a day
 * hits `CAPS.commitsPerDay` / `CAPS.promptsPerDay`, further commits/prompts
 * on that day stop appearing in the arrays below — without hashing the
 * omitted counts, a 41st commit on an already-capped day would change
 * nothing in the hash.
 * @param {any[]} days
 */
export function reviewInputHash(days) {
  return sha1(JSON.stringify({
    v: 2,
    d: days.map((d) => [
      d.date,
      d.sessions.length,
      d.prompts.length,
      d.promptsOmitted,
      d.journal.length,
      d.commits.map((c) => c.sha),
      d.commitsOmitted,
    ]),
  }));
}

const fmtH = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
};

/** The document handed to the model. Caps are declared, never silent. */
export function renderReviewInput(review) {
  const parts = [`# ${review.project.name} — ${review.from} to ${review.to}`];
  if (!review.gitAvailable) {
    parts.push('NOTE: commit data was unavailable for this project (the checkout is missing or is not a git repository). Say so in the output; do not imply nothing was committed.');
  }
  for (const d of review.days) {
    const sec = [`## ${d.date}`];
    for (const c of d.commits) {
      sec.push(`- commit ${c.sha}: ${c.message}`);
      for (const f of c.files) sec.push(`    ${f.path} (+${f.added}/-${f.removed})`);
      if (c.filesOmitted) sec.push(`    … ${c.filesOmitted} more files`);
    }
    if (d.commitsOmitted) sec.push(`- … ${d.commitsOmitted} more commits this day`);
    for (const s of d.sessions) sec.push(`- session: ${s.title} (${fmtH(s.claudeMs)}, ${s.promptCount} prompts)`);
    if (d.prompts.length) {
      sec.push('- prompts:');
      for (const pr of d.prompts) {
        const marker = pr.truncatedFrom ? ` … (truncated from ${pr.truncatedFrom} chars)` : '';
        sec.push(`    ${pr.text}${marker}`);
      }
      if (d.promptsOmitted) sec.push(`    … ${d.promptsOmitted} more prompts this day`);
    }
    for (const j of d.journal) sec.push(`- note: ${j}`);
    parts.push(sec.join('\n'));
  }
  return parts.join('\n\n');
}

export const DAY_REVIEW_INSTRUCTIONS = `You are writing a detailed, day-by-day change review for a software project, from a raw activity log of AI-assisted development sessions and git commits.
Output STRICT markdown, nothing else — no preamble, no closing remarks, no code fences.

Structure, exactly:
- One "## <date>" heading per day that has activity, in chronological order. Format the date like "Mon, Aug 16".
- Inside each day, group that day's work by FEATURE or subsystem, one "**<Feature name>**" line per group, ordered most to least significant that day. Use the log's own vocabulary for names, never generic labels like "Misc".
- Under each group, 1-6 bullets ("- ..."). Each bullet must state the concrete change in past tense AND what it enables, and cite the specific files or commits it came from in backticks.
- End each day with a single "_<n> commits · +<added>/-<removed>_" line when commit data exists for that day.

Rules:
- Be specific and thorough. Prefer naming the actual file or symbol over vague phrasing.
- Never invent work that is not in the log. If a day has prompts but no commits, describe what was worked on and say it was not committed.
- If the log says commit data was unavailable, state that once at the top.
- If the log shows "… N more files" or "… N more commits", say the day was truncated rather than implying the list is complete.

Activity log follows.

`;
