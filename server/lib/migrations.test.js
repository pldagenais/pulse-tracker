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

test('same project + period + lang replaces rather than duplicates', () => {
  const db = tmpDb();
  const ins = db.prepare(
    `INSERT INTO project_reviews(project_path, period_from, period_to, lang, input_hash, model, markdown, created_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(project_path, period_from, period_to, lang) DO UPDATE SET
       input_hash=excluded.input_hash, markdown=excluded.markdown, created_at=excluded.created_at`
  );
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'en', 'h1', 'm', 'first', 1);
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'en', 'h2', 'm', 'second', 2);

  const rows = db.prepare('SELECT markdown, input_hash FROM project_reviews').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].markdown, 'second');
  assert.equal(rows[0].input_hash, 'h2');
});

test('same project + period, different lang, does not overwrite', () => {
  const db = tmpDb();
  const ins = db.prepare(
    `INSERT INTO project_reviews(project_path, period_from, period_to, lang, input_hash, model, markdown, created_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(project_path, period_from, period_to, lang) DO UPDATE SET
       input_hash=excluded.input_hash, markdown=excluded.markdown, created_at=excluded.created_at`
  );
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'en', 'h1', 'm', 'english', 1);
  ins.run('C:\\p', '2026-07-18', '2026-08-16', 'fr', 'h2', 'm', 'french', 2);

  const rows = db.prepare('SELECT lang, markdown FROM project_reviews ORDER BY lang').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].lang, 'en');
  assert.equal(rows[0].markdown, 'english');
  assert.equal(rows[1].lang, 'fr');
  assert.equal(rows[1].markdown, 'french');
});
