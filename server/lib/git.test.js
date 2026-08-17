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
