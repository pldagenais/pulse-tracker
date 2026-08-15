import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPayload, staticSnapshots, daySnapshots } from './keys.js';

const addDays = (d, n) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

test('hashPayload is stable regardless of key order', () => {
  assert.equal(hashPayload({ a: 1, b: 2 }), hashPayload({ b: 2, a: 1 }));
});

test('hashPayload changes when a value changes', () => {
  assert.notEqual(hashPayload({ a: 1 }), hashPayload({ a: 2 }));
});

test('hashPayload handles null and arrays without throwing', () => {
  assert.equal(typeof hashPayload(null), 'string');
  assert.notEqual(hashPayload([1, 2]), hashPayload([2, 1]));
});

test('staticSnapshots maps keys to local REST paths', () => {
  const byKey = Object.fromEntries(
    staticSnapshots('2026-08-14', addDays).map((s) => [s.key, s.path])
  );
  assert.equal(byKey.projects, '/api/projects');
  assert.ok(byKey.heatmap.startsWith('/api/heatmap'));
});

test('staticSnapshots builds a 90-day range for each stats grouping', () => {
  const byKey = Object.fromEntries(
    staticSnapshots('2026-08-14', addDays).map((s) => [s.key, s.path])
  );
  assert.equal(
    byKey['insights:model'],
    '/api/stats?groupBy=model&from=2026-05-17&to=2026-08-14'
  );
  for (const g of ['day', 'model', 'tool', 'skill', 'hour']) {
    assert.ok(byKey[`insights:${g}`], `missing insights:${g}`);
  }
});

test('daySnapshots covers the window newest-first with overview and timeline', () => {
  const rows = daySnapshots(3, '2026-08-14', addDays);
  const days = [...new Set(rows.map((r) => r.day))];
  assert.deepEqual(days, ['2026-08-14', '2026-08-13', '2026-08-12']);
  assert.ok(rows.some((r) => r.key === 'overview:2026-08-14'));
  assert.ok(rows.some((r) => r.key === 'timeline:2026-08-12'));
});

test('daySnapshots keys and paths agree on the day', () => {
  for (const row of daySnapshots(2, '2026-08-14', addDays)) {
    assert.ok(row.key.endsWith(row.day), `${row.key} should end with ${row.day}`);
    assert.ok(row.path.includes(row.day), `${row.path} should include ${row.day}`);
  }
});
