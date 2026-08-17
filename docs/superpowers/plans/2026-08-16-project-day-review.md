# Day-by-Day Project Change Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a day-first change review to the Report page that lists, per day, what changed in a project — grouped by feature — built from git commits, prompts, sessions and journal notes.

**Architecture:** A new `server/lib/review.js` assembles a per-day document from SQLite plus commit/file data read live from git (never persisted). One Opus pass turns it into markdown, cached in a new path-keyed `project_reviews` table. The Report page gains a mode toggle and 7/30/60/custom presets.

**Tech Stack:** Node 24 ESM (plain JS + JSDoc types), `node:sqlite`, `node:test`, Express, React 19 + TypeScript + Tailwind v4, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-16-project-day-review-design.md` (committed as `4726f8d`)

**Branch:** `feat/project-day-review`

## Global Constraints

- **Server code is plain ESM JavaScript with JSDoc types.** No TypeScript in `server/`. `npm run check` (`tsc -p jsconfig.json`) must stay green.
- **Run node with `--disable-warning=ExperimentalWarning`** — `node:sqlite` is experimental.
- **Never write anything under `~/.claude/projects`.** Read-only source data.
- **Never persist file contents.** File *paths* may be used transiently in the LLM input; they are never written to the database.
- **`project_reviews` must stay OUT of the drop list in `scripts/reingest.mjs:16`.** A review costs Opus quota and cannot be re-derived cheaply.
- **Every new user-facing string needs both `en` and `fr`.** No English fallbacks.
- **Caps (exact values):** 20 files per commit, 40 commits per day, 60 prompts per day at 1000 chars each.
- **LLM defaults:** model `claude-opus-5`, `maxTurns: 1`, `timeoutMs: 600_000`.

---

### Task 1: Per-file commit reader in `git.js`

`gitLog()` already parses `--numstat` but throws away file paths, keeping only summed counts. Extract a testable parser and add a windowed reader that keeps paths.

**Files:**
- Modify: `server/lib/git.js` (add exports beside the existing private `gitLog`)
- Modify: `package.json` (add a `test` script — there is none today)
- Test: `server/lib/git.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parseNumstat(stdout: string) => Array<{sha: string, ts: number, message: string, files: Array<{path: string, added: number, removed: number}>}>`
  - `commitsWithFiles(dir: string, fromMs: number, toMs: number) => Promise<Array<...same...> | null>` — `null` means git failed or the path is not a repo.

- [ ] **Step 1: Write the failing test**

Create `server/lib/git.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumstat } from './git.js';

// `git log --pretty=format:\x01%H\t%at\t%s --numstat` output, verbatim shape.
const SAMPLE = [
  '\x01abc123\t1786926649\tfeat: add reviews',
  '10\t2\tserver/lib/review.js',
  '3\t0\tserver/lib/git.js',
  '',
  '\x01def456\t1786840249\tfix: guard memory card',
  '1\t1\tweb/src/components/manage/MemoryCard.tsx',
  '-\t-\tdocs/logo.png',
  '',
].join('\n');

test('parseNumstat keeps file paths and per-file counts', () => {
  const commits = parseNumstat(SAMPLE);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, 'abc123');
  assert.equal(commits[0].message, 'feat: add reviews');
  assert.equal(commits[0].ts, 1786926649 * 1000);
  assert.deepEqual(commits[0].files, [
    { path: 'server/lib/review.js', added: 10, removed: 2 },
    { path: 'server/lib/git.js', added: 3, removed: 0 },
  ]);
});

test('parseNumstat treats binary files (- -) as zero counts, not NaN', () => {
  const commits = parseNumstat(SAMPLE);
  const binary = commits[1].files.find((f) => f.path === 'docs/logo.png');
  assert.deepEqual(binary, { path: 'docs/logo.png', added: 0, removed: 0 });
});

test('parseNumstat tolerates empty output', () => {
  assert.deepEqual(parseNumstat(''), []);
});

test('parseNumstat keeps tabs inside a commit subject', () => {
  const out = '\x01aaa\t1700000000\tfix:\tweird\tsubject\n1\t0\ta.js\n';
  assert.equal(parseNumstat(out)[0].message, 'fix:\tweird\tsubject');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/git.test.js`
Expected: FAIL — `parseNumstat` is not exported from `./git.js`.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/git.js`, add above `createGitScanner`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/git.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the `test` npm script**

In `package.json` `scripts`, after `"smoke"`:

```json
"test": "node --disable-warning=ExperimentalWarning --test",
```

Run: `npm test`
Expected: PASS — discovers all five `*.test.js` files (git, memory-files, config-file, cloud/keys, cloud/redact).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run check
git add server/lib/git.js server/lib/git.test.js package.json
git commit -m "feat(git): read commits with per-file counts for a window"
```

---

### Task 2: Migration v14 — `project_reviews`

**Files:**
- Modify: `server/lib/migrations.js` (append after the v13 block, which currently ends the array)
- Modify: `scripts/reingest.mjs:1-3,10` (preserved-data comments only — do NOT add the table to the drop list on line 16)
- Test: `server/lib/migrations.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: table `project_reviews(project_path TEXT, period_from TEXT, period_to TEXT, input_hash TEXT, model TEXT, markdown TEXT, created_at INTEGER, PRIMARY KEY(project_path, period_from, period_to))`. Dates are local `YYYY-MM-DD`; `created_at` is epoch ms.

- [ ] **Step 1: Write the failing test**

Create `server/lib/migrations.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'));
  return openDb(path.join(dir, 'test.db'));
}

test('migration creates project_reviews keyed by path + period', () => {
  const db = tmpDb();
  db.prepare(
    `INSERT INTO project_reviews(project_path, period_from, period_to, input_hash, model, markdown, created_at)
     VALUES(?,?,?,?,?,?,?)`
  ).run('C:\\proj', '2026-07-18', '2026-08-16', 'h1', 'claude-opus-5', '## day', 1786926649755);

  const row = db.prepare('SELECT * FROM project_reviews').get();
  assert.equal(row.project_path, 'C:\\proj');
  assert.equal(row.created_at, 1786926649755);
});

test('same project + period replaces rather than duplicates', () => {
  const db = tmpDb();
  const ins = db.prepare(
    `INSERT INTO project_reviews(project_path, period_from, period_to, input_hash, model, markdown, created_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(project_path, period_from, period_to) DO UPDATE SET
       input_hash=excluded.input_hash, markdown=excluded.markdown, created_at=excluded.created_at`
  );
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'h1', 'm', 'first', 1);
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'h2', 'm', 'second', 2);

  const rows = db.prepare('SELECT markdown, input_hash FROM project_reviews').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].markdown, 'second');
  assert.equal(rows[0].input_hash, 'h2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/migrations.test.js`
Expected: FAIL — `no such table: project_reviews`.

- [ ] **Step 3: Write minimal implementation**

In `server/lib/migrations.js`, append inside the `MIGRATIONS` array after the v13 object:

```js
  {
    // Day-by-day change reviews. Keyed by PATH, not id: reingest drops
    // `projects` (reassigning ids) but not this table, so an id-keyed row
    // would silently re-attach to the wrong project — the same hazard v12
    // worked around for project_summaries. Opus-generated and not
    // re-derivable, so it stays out of reingest's drop list.
    version: 14,
    sql: `
CREATE TABLE project_reviews(
  project_path TEXT NOT NULL,
  period_from  TEXT NOT NULL,
  period_to    TEXT NOT NULL,
  input_hash   TEXT NOT NULL,
  model        TEXT,
  markdown     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY(project_path, period_from, period_to)
);
`,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/migrations.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Update the reingest preserved-data comments**

In `scripts/reingest.mjs`, replace the header comment (lines 1-6) with:

```js
// Rebuild the derived cache from transcripts. PRESERVES user data:
// journal, settings, hook_events, accounts, session_accounts,
// project_reviews and meta(schema_version) survive; everything else is
// derived from ~/.claude and safe to drop. Account attribution and Opus
// reviews in particular CANNOT be re-derived — dropping them loses which
// subscription ran each session, and burns quota to rebuild.
```

and the console line:

```js
console.log('dropping derived tables (journal/settings/hook_events/accounts/reviews preserved)...');
```

**Do not touch the drop list on line 16.**

- [ ] **Step 6: Verify reviews survive a real reingest**

Copy the live DB and reingest the copy — never `data/tracker.db` itself:

```bash
node --disable-warning=ExperimentalWarning -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/tracker.db',{readOnly:true});d.exec(\"VACUUM INTO 'C:/Users/pl/AppData/Local/Temp/revtest/tracker.db'\")"
node --disable-warning=ExperimentalWarning -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('C:/Users/pl/AppData/Local/Temp/revtest/tracker.db');d.prepare(\"INSERT INTO project_reviews VALUES('C:\\\\p','2026-07-18','2026-08-16','h','m','## x',1)\").run();console.log('seeded')"
CLAUDE_TRACKER_DATA_DIR=C:/Users/pl/AppData/Local/Temp/revtest npm run reingest
node --disable-warning=ExperimentalWarning -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('C:/Users/pl/AppData/Local/Temp/revtest/tracker.db',{readOnly:true});console.log('reviews after reingest:', d.prepare('select count(*) c from project_reviews').get().c)"
```

Expected: `reviews after reingest: 1`.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run check && npm test
git add server/lib/migrations.js server/lib/migrations.test.js scripts/reingest.mjs
git commit -m "feat(db): add path-keyed project_reviews table (v14)"
```

---

### Task 3: `server/lib/review.js` — build the per-day document

The core. Assembles days from SQLite + git, applies declared caps, renders the LLM input, and computes the staleness hash.

**Files:**
- Create: `server/lib/review.js`
- Test: `server/lib/review.test.js`

**Interfaces:**
- Consumes: `commitsWithFiles` from Task 1; `project_reviews` from Task 2.
- Produces:
  - `CAPS = { filesPerCommit: 20, commitsPerDay: 40, promptsPerDay: 60, promptChars: 1000 }`
  - `buildDayReview(db, projectId, from, to) => Promise<Review | null>` where
    `Review = { project: {id, name, path}, from, to, days: Day[], gitAvailable: boolean, inputHash: string, cached: {markdown, createdAt, stale} | null }`,
    `Day = { date, commits: Commit[], commitsOmitted: number, sessions: Session[], prompts: string[], promptsOmitted: number, journal: string[] }`,
    `Commit = { sha, message, files: {path, added, removed}[], filesOmitted: number }`,
    `Session = { title, claudeMs, promptCount, estCostUsd }`
  - `renderReviewInput(review) => string`
  - `DAY_REVIEW_INSTRUCTIONS: string`

- [ ] **Step 1: Write the failing test**

Create `server/lib/review.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { CAPS, renderReviewInput, buildDayReview } from './review.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  return openDb(path.join(dir, 'test.db'));
}

const base = (days) => ({
  project: { id: 1, name: 'Proj', path: 'C:\\p' },
  from: '2026-08-15', to: '2026-08-16', gitAvailable: true, days,
});

test('caps are the values the spec fixed', () => {
  assert.deepEqual(CAPS, { filesPerCommit: 20, commitsPerDay: 40, promptsPerDay: 60, promptChars: 1000 });
});

test('renderReviewInput emits one section per day in chronological order', () => {
  const out = renderReviewInput(base([
    { date: '2026-08-15', commits: [], commitsOmitted: 0, sessions: [], prompts: ['first'], promptsOmitted: 0, journal: [] },
    { date: '2026-08-16', commits: [], commitsOmitted: 0, sessions: [], prompts: ['second'], promptsOmitted: 0, journal: [] },
  ]));
  assert.match(out, /## 2026-08-15[\s\S]*## 2026-08-16/);
});

test('renderReviewInput declares omitted files and commits instead of hiding them', () => {
  const out = renderReviewInput(base([{
    date: '2026-08-16',
    commits: [{ sha: 'abc1234', message: 'big', files: [{ path: 'a.js', added: 1, removed: 0 }], filesOmitted: 14 }],
    commitsOmitted: 22, sessions: [], prompts: [], promptsOmitted: 0, journal: [],
  }]));
  assert.match(out, /… 14 more files/);
  assert.match(out, /… 22 more commits this day/);
});

test('renderReviewInput states when git data was unavailable', () => {
  const r = base([{ date: '2026-08-16', commits: [], commitsOmitted: 0, sessions: [], prompts: ['x'], promptsOmitted: 0, journal: [] }]);
  r.gitAvailable = false;
  assert.match(renderReviewInput(r), /commit data was unavailable/i);
});

test('buildDayReview returns null for an unknown project', async () => {
  const db = tmpDb();
  assert.equal(await buildDayReview(db, 99999, '2026-08-01', '2026-08-16'), null);
});

test('buildDayReview buckets prompts into local day keys', async () => {
  const db = tmpDb();
  db.prepare("INSERT INTO projects(path, name) VALUES('C:\\\\notarepo','Nope')").run();
  const id = db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  const [ms] = [Date.parse('2026-08-10T15:00:00Z')];
  db.prepare("INSERT INTO prompts(uuid, session_id, project_id, ts, kind, text) VALUES('u1','s1',?,?,'typed','do the thing')").run(id, ms);

  const r = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  assert.equal(r.gitAvailable, false);           // path is not a git repo
  const day = r.days.find((d) => d.prompts.length);
  assert.ok(day, 'expected a day carrying the prompt');
  assert.equal(day.prompts[0], 'do the thing');
});

test('inputHash changes when a commit sha changes, and is stable otherwise', async () => {
  const db = tmpDb();
  db.prepare("INSERT INTO projects(path, name) VALUES('C:\\\\notarepo2','N2')").run();
  const id = db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  const a = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  const b = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  assert.equal(a.inputHash, b.inputHash);
});
```

> If `INSERT INTO projects(path, name)` fails on a NOT NULL column, read `CREATE TABLE projects` in `migrations.js` and supply the missing columns. Same for `prompts` — it requires `uuid, session_id, project_id, ts, kind, text`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/review.test.js`
Expected: FAIL — cannot find module `./review.js`.

- [ ] **Step 3: Write the implementation**

Create `server/lib/review.js`:

```js
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
    `SELECT ts, substr(text,1,${CAPS.promptChars}) t FROM prompts
      WHERE project_id IN (${ph}) AND ts>=? AND ts<? AND kind IN ('typed','command') ORDER BY ts`
  ).all(...ids, fromMs, toMs))) {
    const d = dayOf(localDayKey(r.ts));
    if (d.prompts.length < CAPS.promptsPerDay) d.prompts.push(String(r.t).replace(/\s+/g, ' '));
    else d.promptsOmitted++;
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

  // Commits are an input now: without their shas in the hash, a new commit
  // leaves a cached review looking current while describing a stale repo.
  const inputHash = sha1(JSON.stringify({
    v: 1,
    d: days.map((d) => [d.date, d.sessions.length, d.prompts.length, d.journal.length, d.commits.map((c) => c.sha)]),
  }));

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
      for (const t of d.prompts) sec.push(`    ${t}`);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test server/lib/review.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check && npm test
git add server/lib/review.js server/lib/review.test.js
git commit -m "feat(review): assemble per-day change documents from git and sqlite"
```

---

### Task 4: Model + config-dir settings for the summarizer

Lets reviews run on Opus against a **different subscription**. Verified mechanism: `CLAUDE_CONFIG_DIR=<empty dir> claude -p …` returns "Not logged in", the default succeeds.

**Files:**
- Modify: `server/lib/llm.js:16-52`
- Modify: `server/routes/system.js` (`/api/settings` GET at ~:247, PUT at ~:262)

**Interfaces:**
- Consumes: nothing.
- Produces: `runClaude(prompt, { model, maxTurns, timeoutMs, configDir })`. Settings keys `llm_config_dir` (string, may be empty) and `llm_model` (string, default `claude-opus-5`), exposed as `llmConfigDir` / `llmModel`.

- [ ] **Step 1: Add `configDir` and env plumbing to `runClaude`**

In `server/lib/llm.js`:

```js
/**
 * @param {string} prompt
 * @param {{ model?: string, maxTurns?: number, timeoutMs?: number, configDir?: string }} [opts]
 * @returns {Promise<string>}
 */
export function runClaude(prompt, { model = 'claude-haiku-4-5', maxTurns = 1, timeoutMs = 180_000, configDir = '' } = {}) {
  fs.mkdirSync(LLM_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    // A separate config dir has its own .credentials.json, so reports can bill
    // to a different subscription than the interactive CLI.
    const env = configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
    const child = spawn('claude', ['-p', '--model', model, '--max-turns', String(maxTurns)], {
      shell: true,
      cwd: LLM_DIR,
      env,
      windowsHide: true,
    });
```

Leave the rest of the function unchanged.

- [ ] **Step 2: Make the not-signed-in error name the config dir**

Replace the rejection branch (currently `llm.js:39-40`):

```js
      if (/not logged in/i.test(stdout)) {
        reject(new Error(
          configDir
            ? `the claude CLI in ${configDir} is not signed in — run \`CLAUDE_CONFIG_DIR=${configDir} claude\` then \`/login\` once.`
            : 'the claude CLI is not signed in — open a terminal, run `claude`, then `/login` once. Summaries use your Claude subscription through the CLI.'
        ));
      } else if (code === 0 && stdout) {
```

- [ ] **Step 3: Expose both settings in GET `/api/settings`**

In `server/routes/system.js`, inside the `ok(res, {...})` of `app.get('/api/settings')`:

```js
      llmConfigDir: getSetting(db, 'llm_config_dir', '') || null,
      llmModel: getSetting(db, 'llm_model', 'claude-opus-5'),
```

- [ ] **Step 4: Accept both in PUT `/api/settings`**

In `app.put('/api/settings')`, before `ok(res, { recomputing: true })`:

```js
    if (b.llmConfigDir !== undefined) {
      setSetting(db, 'llm_config_dir', String(b.llmConfigDir ?? '').trim().slice(0, 400));
    }
    if (b.llmModel !== undefined) {
      const m = String(b.llmModel ?? '').trim();
      if (!/^[a-z0-9.-]{0,60}$/.test(m)) return bad(res, 'llmModel must be a model id');
      setSetting(db, 'llm_model', m || 'claude-opus-5');
    }
```

- [ ] **Step 5: Verify the round-trip**

```bash
npm run check
```

Restart the server, then:

```bash
curl -s -X PUT http://127.0.0.1:5599/api/settings -H 'content-type: application/json' -d '{"idleThresholdMin":10,"stallCapMin":10,"llmModel":"claude-opus-5","llmConfigDir":"C:\\Users\\pl\\.claude-reports"}'
curl -s http://127.0.0.1:5599/api/settings
```

Expected: the GET echoes `llmModel: "claude-opus-5"` and the `llmConfigDir` you set.

- [ ] **Step 6: Commit**

```bash
git add server/lib/llm.js server/routes/system.js
git commit -m "feat(llm): run summaries under a chosen model and config dir"
```

---

### Task 5: `GET /api/review/:projectId` and `POST /api/review/:projectId/generate`

**Files:**
- Modify: `server/routes/report.js` (mount beside the existing report routes; reuse `parseRange`, `inflight`, `ok`, `bad`, `log`)

**Interfaces:**
- Consumes: `buildDayReview`, `renderReviewInput`, `DAY_REVIEW_INSTRUCTIONS` (Task 3); `runClaude` with `configDir` (Task 4); `project_reviews` (Task 2).
- Produces: `GET /api/review/:projectId?from=&to=` → `{ project, from, to, days, gitAvailable, cached }` (no `inputHash` in the response). `POST /api/review/:projectId/generate?from=&to=` body `{ lang: 'en'|'fr' }` → `{ markdown, createdAt, stale: false }`.

- [ ] **Step 1: Add the imports**

At the top of `server/routes/report.js`:

```js
import { buildDayReview, renderReviewInput, DAY_REVIEW_INSTRUCTIONS } from '../lib/review.js';
import { getSetting } from '../lib/db.js';
```

- [ ] **Step 2: Add the read endpoint**

Inside `mountReport`, after `app.get('/api/report/:projectId', ...)`:

```js
  app.get('/api/review/:projectId', async (req, res) => {
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const data = await buildDayReview(db, Number(req.params.projectId), range.from, range.to);
    if (!data) return bad(res, 'project not found', 404);
    const { inputHash, ...rest } = data;
    ok(res, rest);
  });
```

- [ ] **Step 3: Add the generate endpoint**

```js
  app.post('/api/review/:projectId/generate', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const lang = req.body?.lang === 'fr' ? 'fr' : 'en';
    try {
      const review = await buildDayReview(db, projectId, range.from, range.to);
      if (!review) return bad(res, 'project not found', 404);
      // Refuse before spending quota, like changes-summary does.
      if (!review.days.length) return bad(res, 'no activity in this range');

      const key = `review|${review.project.path}|${range.from}|${range.to}|${lang}`;
      let job = inflight.get(key);
      if (!job) {
        const input = renderReviewInput(review);
        const model = getSetting(db, 'llm_model', 'claude-opus-5');
        const configDir = getSetting(db, 'llm_config_dir', '') || '';
        log.info(`day-review: project ${projectId} ${range.from}..${range.to} (${input.length} chars, ${model})`);
        const langLine = lang === 'fr' ? 'Écris la réponse entièrement en français.\n' : '';
        job = runClaude(DAY_REVIEW_INSTRUCTIONS + langLine + input, {
          model, maxTurns: 1, timeoutMs: 600_000, configDir,
        }).then((markdown) => {
          db.prepare(
            `INSERT INTO project_reviews(project_path, period_from, period_to, input_hash, model, markdown, created_at)
             VALUES(?,?,?,?,?,?,?)
             ON CONFLICT(project_path, period_from, period_to) DO UPDATE SET
               input_hash=excluded.input_hash, model=excluded.model,
               markdown=excluded.markdown, created_at=excluded.created_at`
          ).run(review.project.path, range.from, range.to, review.inputHash, model, markdown, Date.now());
          return markdown;
        });
        inflight.set(key, job);
        job.finally(() => inflight.delete(key)).catch(() => {});
      }
      const markdown = await job;
      ok(res, { markdown, createdAt: Date.now(), stale: false });
    } catch (e) {
      // The previously cached review is left in place on failure.
      log.warn('day-review failed:', e instanceof Error ? e.message : String(e));
      bad(res, `review failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  });
```

- [ ] **Step 4: Verify the read endpoint**

```bash
npm run check
```

Restart the server, then (substitute a real project id from `/api/projects`):

```bash
curl -s "http://127.0.0.1:5599/api/review/2?from=2026-07-18&to=2026-08-16" | head -c 400
```

Expected: JSON with `days`, `gitAvailable: true`, `cached: null`.

- [ ] **Step 5: Verify generation, caching, and staleness**

```bash
curl -s -X POST "http://127.0.0.1:5599/api/review/2/generate?from=2026-07-18&to=2026-08-16" -H 'content-type: application/json' -d '{"lang":"en"}' | head -c 600
```

Expected: markdown starting with `## ` and a date. **This spends Opus quota — run it once.**

Re-run the GET: `cached.stale` must be `false`. Then make any commit in that repo and re-run the GET: `cached.stale` must flip to `true`, proving commit shas are in the hash.

- [ ] **Step 6: Commit**

```bash
git add server/routes/report.js
git commit -m "feat(api): day-by-day review endpoints with Opus generation"
```

---

### Task 6: Report page — mode toggle, presets, review rendering

**Files:**
- Modify: `web/src/pages/ReportPage.tsx` (type/params at :62-77, controls at ~:104, body rendering)
- Modify: the i18n file owning `report.*` keys — find it with `grep -l "'report\." web/src/i18n/*.ts`

**Interfaces:**
- Consumes: the endpoints from Task 5.
- Produces: URL params `mode=summary|review`, `range=7d|30d|60d|90d|all|custom`, plus `from`/`to` when `range=custom`.

- [ ] **Step 1: Extend the range type and add the mode**

Replace `type Range` and the derived values at `ReportPage.tsx:62-77`:

```tsx
type Range = 'all' | '90d' | '60d' | '30d' | '7d' | 'custom';
type Mode = 'summary' | 'review';

const RANGE_DAYS: Partial<Record<Range, number>> = { '90d': 89, '60d': 59, '30d': 29, '7d': 6 };

interface DayReviewData {
  project: { id: number; name: string; path: string };
  from: string;
  to: string;
  gitAvailable: boolean;
  days: { date: string; prompts: string[]; journal: string[] }[];
  cached: { markdown: string; createdAt: number; stale: boolean } | null;
}

const dayReviewQuery = (projectId: number | null, from: string | null, to: string | null) =>
  queryOptions({
    queryKey: ['day-review', projectId, from, to],
    queryFn: () => api.get<DayReviewData>(`/api/review/${projectId}${qs({ from, to })}`),
    enabled: projectId != null,
    staleTime: 15_000,
  });
```

Inside the component:

```tsx
  const range = (params.get('range') as Range) ?? 'all';
  const mode = (params.get('mode') as Mode) ?? 'summary';
  const to = range === 'custom' ? (params.get('to') ?? todayKey()) : todayKey();
  const from = range === 'all' ? null
    : range === 'custom' ? (params.get('from') ?? addDays(to, -29))
    : addDays(to, -RANGE_DAYS[range]!);
  const effectiveTo = range === 'all' ? null : to;
```

Then replace every existing `range === 'all' ? null : to` with `effectiveTo` (the `reportQuery` call and `pdfHref`).

- [ ] **Step 2: Add the mode toggle and the new preset options**

Beside the existing `SegmentedControl<Range>`:

```tsx
        <SegmentedControl<Mode>
          value={mode}
          onChange={(v) => setParam('mode', v === 'summary' ? null : v)}
          options={[
            { value: 'summary', label: t('report.modeSummary') },
            { value: 'review', label: t('report.modeReview') },
          ]}
        />
```

Extend the existing range `options` array with:

```tsx
            { value: '7d', label: t('report.range7d') },
            { value: '60d', label: t('report.range60d') },
            { value: 'custom', label: t('report.rangeCustom') },
```

- [ ] **Step 3: Add the custom date inputs**

Rendered only when `range === 'custom'`:

```tsx
        {range === 'custom' && (
          <span className="flex items-center gap-1.5">
            <input
              type="date" value={from ?? ''} max={to}
              aria-label={t('report.fromLabel')}
              onChange={(e) => setParam('from', e.target.value || null)}
              className="rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none"
            />
            <span className="text-dim" aria-hidden>→</span>
            <input
              type="date" value={to} min={from ?? undefined}
              aria-label={t('report.toLabel')}
              onChange={(e) => setParam('to', e.target.value || null)}
              className="rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none"
            />
          </span>
        )}
```

- [ ] **Step 4: Wire the review query and generate action**

```tsx
  const review = useQuery({
    ...dayReviewQuery(projectId, from, effectiveTo),
    enabled: projectId != null && mode === 'review',
  });
  const generate = useMutation({
    mutationFn: () =>
      api.post<{ markdown: string }>(
        `/api/review/${projectId}/generate${qs({ from, to: effectiveTo })}`,
        { lang: getLocale() }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['day-review'] }),
  });
```

Note the query string goes **after** `/generate`, not after the id.

- [ ] **Step 5: Render the review body**

When `mode === 'review'`, render instead of the summary body: the no-git warning, the generate button, and the cached markdown through the same renderer the summary uses.

```tsx
        {review.data && !review.data.gitAvailable && (
          <div className="rounded border border-user/40 bg-user/5 px-3 py-2 font-mono text-[11px] text-user">
            {t('report.reviewNoGit')}
          </div>
        )}
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || !review.data || review.data.days.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          {generate.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {generate.isPending ? t('report.reviewing')
            : review.data?.cached && !review.data.cached.stale ? t('report.refreshReview')
            : review.data?.cached?.stale ? t('report.updateReview')
            : t('report.reviewBtn')}
        </button>
        {generate.isError && (
          <div className="font-mono text-[11px] text-danger">{String((generate.error as Error).message)}</div>
        )}
        {!review.data?.cached && !generate.isPending && (
          <EmptyState title={t('report.reviewEmpty')} />
        )}
```

- [ ] **Step 6: Add the strings, EN and FR**

```ts
  'report.modeSummary': { en: 'feature summary', fr: 'résumé par fonctionnalité' },
  'report.modeReview': { en: 'day-by-day review', fr: 'revue jour par jour' },
  'report.range7d': { en: '7d', fr: '7 j' },
  'report.range60d': { en: '60d', fr: '60 j' },
  'report.rangeCustom': { en: 'custom', fr: 'personnalisé' },
  'report.fromLabel': { en: 'From date', fr: 'Date de début' },
  'report.toLabel': { en: 'To date', fr: 'Date de fin' },
  'report.reviewBtn': { en: 'generate review', fr: 'générer la revue' },
  'report.reviewing': { en: 'writing the review…', fr: 'rédaction de la revue…' },
  'report.refreshReview': { en: 'regenerate review', fr: 'régénérer la revue' },
  'report.updateReview': { en: 'update review', fr: 'mettre à jour la revue' },
  'report.reviewNoGit': {
    en: 'No git checkout found for this project — the review is built from sessions and prompts only.',
    fr: 'Aucun dépôt git trouvé pour ce projet — la revue est bâtie uniquement à partir des sessions et des invites.',
  },
  'report.reviewEmpty': { en: 'No review yet for this range.', fr: 'Aucune revue pour cette période.' },
  'report.reviewLink': { en: '30-day review →', fr: 'revue 30 jours →' },
```

- [ ] **Step 7: Build and verify in the browser**

```bash
npm run build:web
```

Restart the server — **the bundle and the server must move together**; a stale server against a fresh bundle is exactly what white-screened `/manage` earlier. Then load `http://127.0.0.1:5599/report?mode=review&range=30d` and confirm: the toggle switches modes, presets change the range, `custom` reveals the date inputs, and the console is clean. Toggle the header language and confirm no untranslated keys.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/ReportPage.tsx web/src/i18n/
git commit -m "feat(web): day-by-day review mode with 7/30/60/custom presets"
```

---

### Task 7: Project-page link, PDF check, documentation, end-to-end

**Files:**
- Modify: `web/src/pages/ProjectDetailPage.tsx`
- Modify: `server/routes/report.js` `renderMarkdownish` (~:418) — only if Step 2 shows it is needed
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above. Produces no new interfaces.

- [ ] **Step 1: Link from the project page**

In `ProjectDetailPage.tsx`, beside the existing header actions (import `Link` from `react-router` if not already imported):

```tsx
        <Link
          to={`/report?project=${project.id}&mode=review&range=30d`}
          className="rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
        >
          {t('report.reviewLink')}
        </Link>
```

The string was added in Task 6 Step 6.

- [ ] **Step 2: Check the PDF export renders the review shape**

```bash
curl -s "http://127.0.0.1:5599/api/report/2/pdf?from=2026-07-18&to=2026-08-16" -o review-check.pdf && ls -la review-check.pdf
```

Open it. `renderMarkdownish` handles a limited set of headings — if `**Feature**` lines render as literal asterisks, add a bold-line branch to it. If it already reads correctly, change nothing and say so in the commit message. Delete `review-check.pdf` afterward.

- [ ] **Step 3: Document the feature in CLAUDE.md**

Under "How it works", add:

```markdown
- Day-by-day project reviews (`server/lib/review.js`) read commits and per-file counts LIVE from git (`commitsWithFiles`) and never persist file paths; output is cached in `project_reviews`, keyed by project PATH because reingest reassigns project ids. Reviews run on `llm_model` (default Opus 5) through `llm_config_dir`, so they can bill to a second subscription.
```

Add `project_reviews` to the preserved-tables list on the SQLite bullet.

- [ ] **Step 4: Full verification**

```bash
npm run check && npm test && npm run build:web
```

Expected: typecheck clean, all tests pass, build succeeds.

End-to-end, then **read the output**:
1. Generate a real 30-day review and confirm days are chronological, features are grouped inside days, and file names appear in bullets.
2. Confirm a day with commits shows file-level detail, and a day with prompts but no commits is described as not committed rather than silently dropped.
3. Re-run the reingest-survival check from Task 2 Step 6 and confirm the row count is unchanged.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A
git commit -m "feat(review): link from project page, document the feature"
git push -u origin feat/project-day-review
gh pr create --base main --title "Day-by-day project change review"
```

---

## Self-Review Notes

**Spec coverage.** Day-first structure → T3 instructions + T6 rendering. All four sources → T3. Live git file detail → T1 + T3. Opus one pass → T4 + T5. Second-account billing → T4. Report-page location with a project link → T6 + T7. 7/30/60/custom → T6. Declared caps → T3 (asserted in tests). Path-keyed table kept out of the drop list → T2 (proven by the reingest check in T2 Step 6). Commit shas in the hash → T3, verified live in T5 Step 5. The four failure modes → T3 (no-git note), T5 (timeout, not-signed-in, no-activity). EN+FR → T6. `node:test` coverage and the missing `test` script → T1.

**Deferred, per the spec:** uncommitted-work detection by re-reading transcripts. No task implements it; it layers on top of T3 later without rework.

**Known conditional:** `renderMarkdownish` may need a bold-line branch (T7 Step 2). Left conditional on observed behavior rather than guessed at, because the current renderer's exact handling of `**bold**` lines was not verified.
