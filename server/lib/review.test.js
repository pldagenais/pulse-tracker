import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { CAPS, renderReviewInput, buildDayReview, reviewInputHash } from './review.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-'));
  return openDb(path.join(dir, 'test.db'));
}

const base = (days) => ({
  project: { id: 1, name: 'Proj', path: 'C:\\p' },
  from: '2026-08-15', to: '2026-08-16', gitAvailable: true, days,
});

/** A minimal fully-populated Day, for reviewInputHash tests. */
const day = (overrides) => ({
  date: '2026-08-16', commits: [], commitsOmitted: 0, sessions: [],
  prompts: [], promptsOmitted: 0, journal: [], ...overrides,
});

test('caps are the values the spec fixed', () => {
  assert.deepEqual(CAPS, { filesPerCommit: 20, commitsPerDay: 40, promptsPerDay: 60, promptChars: 1000 });
});

test('renderReviewInput emits one section per day in chronological order', () => {
  const out = renderReviewInput(base([
    day({ date: '2026-08-15', prompts: [{ text: 'first', truncatedFrom: null }] }),
    day({ date: '2026-08-16', prompts: [{ text: 'second', truncatedFrom: null }] }),
  ]));
  assert.match(out, /## 2026-08-15[\s\S]*## 2026-08-16/);
});

test('renderReviewInput declares omitted files and commits instead of hiding them', () => {
  const out = renderReviewInput(base([day({
    commits: [{ sha: 'abc1234', message: 'big', files: [{ path: 'a.js', added: 1, removed: 0 }], filesOmitted: 14 }],
    commitsOmitted: 22,
  })]));
  assert.match(out, /… 14 more files/);
  assert.match(out, /… 22 more commits this day/);
});

test('renderReviewInput states when git data was unavailable', () => {
  const r = base([day({ prompts: [{ text: 'x', truncatedFrom: null }] })]);
  r.gitAvailable = false;
  assert.match(renderReviewInput(r), /commit data was unavailable/i);
});

test('renderReviewInput marks a prompt truncated by the promptChars cap instead of hiding the cut', () => {
  const out = renderReviewInput(base([day({
    prompts: [{ text: 'x'.repeat(1000), truncatedFrom: 4210 }],
  })]));
  assert.match(out, /x{1000} … \(truncated from 4210 chars\)/);
});

test('buildDayReview returns null for an unknown project', async () => {
  const db = tmpDb();
  assert.equal(await buildDayReview(db, 99999, '2026-08-01', '2026-08-16'), null);
});

test('buildDayReview buckets prompts into local day keys', async () => {
  const db = tmpDb();
  db.prepare("INSERT INTO projects(path, name) VALUES('C:\\\\notarepo','Nope')").run();
  const id = Number(db.prepare('SELECT id FROM projects LIMIT 1').get().id);
  const [ms] = [Date.parse('2026-08-10T15:00:00Z')];
  db.prepare("INSERT INTO prompts(uuid, session_id, project_id, ts, kind, text) VALUES('u1','s1',?,?,'typed','do the thing')").run(id, ms);

  const r = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  assert.equal(r.gitAvailable, false);           // path is not a git repo
  const found = r.days.find((d) => d.prompts.length);
  assert.ok(found, 'expected a day carrying the prompt');
  assert.equal(found.prompts[0].text, 'do the thing');
  assert.equal(found.prompts[0].truncatedFrom, null); // well under the promptChars cap
});

test('reviewInputHash is stable for identical day arrays', () => {
  const days = [day({ commits: [{ sha: 'abc1234', message: 'm', files: [], filesOmitted: 0 }] })];
  const a = reviewInputHash(days);
  const b = reviewInputHash([day({ commits: [{ sha: 'abc1234', message: 'm', files: [], filesOmitted: 0 }] })]);
  assert.equal(a, b);
});

test('reviewInputHash changes when a commit sha changes', () => {
  const a = reviewInputHash([day({ commits: [{ sha: 'abc1234', message: 'm', files: [], filesOmitted: 0 }] })]);
  const b = reviewInputHash([day({ commits: [{ sha: 'def5678', message: 'm', files: [], filesOmitted: 0 }] })]);
  assert.notEqual(a, b);
});

test('reviewInputHash changes when commitsOmitted increments, all else equal', () => {
  // Regression guard: a day already at CAPS.commitsPerDay must still
  // invalidate a cached review when another commit lands on it, even
  // though the visible commits array doesn't grow.
  const a = reviewInputHash([day({ commitsOmitted: 5 })]);
  const b = reviewInputHash([day({ commitsOmitted: 6 })]);
  assert.notEqual(a, b);
});

test('project_reviews caches EN and FR reviews for the same project+range independently', async () => {
  // Regression guard for the v14 primary key omitting `lang`: generating an
  // FR review for a range that already has a cached EN review must not
  // silently overwrite it (they used to collide on the same conflict
  // target). Insert both languages directly, then confirm both the raw
  // table and buildDayReview's lang-filtered SELECT see two independent rows.
  const db = tmpDb();
  db.prepare("INSERT INTO projects(path, name) VALUES('C:\\\\notarepo','Nope')").run();
  const project = /** @type {any} */ (db.prepare('SELECT id, path FROM projects LIMIT 1').get());
  const id = Number(project.id);
  const projectPath = project.path;
  const ins = db.prepare(
    `INSERT INTO project_reviews(project_path, period_from, period_to, lang, input_hash, model, markdown, created_at)
     VALUES(?,?,?,?,?,?,?,?)`
  );
  ins.run(projectPath, '2026-08-01', '2026-08-16', 'en', 'h', 'm', 'EN markdown', 1);
  ins.run(projectPath, '2026-08-01', '2026-08-16', 'fr', 'h', 'm', 'FR markdown', 2);

  const rows = db.prepare('SELECT lang, markdown FROM project_reviews WHERE project_path=?').all(projectPath);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.lang === 'en').markdown, 'EN markdown');
  assert.equal(rows.find((r) => r.lang === 'fr').markdown, 'FR markdown');

  const en = await buildDayReview(db, id, '2026-08-01', '2026-08-16', 'en');
  const fr = await buildDayReview(db, id, '2026-08-01', '2026-08-16', 'fr');
  assert.equal(en.cached.markdown, 'EN markdown');
  assert.equal(fr.cached.markdown, 'FR markdown');
});
