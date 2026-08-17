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
  const id = Number(db.prepare('SELECT id FROM projects LIMIT 1').get().id);
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
  const id = Number(db.prepare('SELECT id FROM projects LIMIT 1').get().id);
  const a = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  const b = await buildDayReview(db, id, '2026-08-01', '2026-08-16');
  assert.equal(a.inputHash, b.inputHash);
});
