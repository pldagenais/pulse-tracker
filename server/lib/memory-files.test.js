import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ancestorCandidates,
  canon,
  discoverMemory,
  encodeProjectDir,
  violatesProjectsInvariant,
} from './memory-files.js';

/** Fixture root, torn down by the caller. */
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
}
const write = (p, s = 'x') => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};
/** Duck-typed stand-in for the sqlite handle — no DB needed. */
const fakeDb = (rows) => ({ prepare: () => ({ all: () => rows }) });
const allFiles = (tree) => tree.groups.flatMap((g) => [...g.files, ...g.worktrees.flatMap((w) => w.files)]);

test('encodeProjectDir matches Claude Code folder naming', () => {
  assert.equal(encodeProjectDir('C:\\Users\\pl\\X'), 'C--Users-pl-X');
  // A drive root really is `C:\` and really does encode to `C--` — the trailing
  // separator is significant, not noise to strip.
  assert.equal(encodeProjectDir('C:\\'), 'C--');
  assert.equal(encodeProjectDir('/home/pl/proj'), '-home-pl-proj');
});

test('ancestorCandidates walks up nearest-first and terminates at the root', () => {
  const c = ancestorCandidates(path.resolve('/a/b/c'));
  assert.deepEqual(
    c.slice(0, 3).map((x) => x.scope),
    ['project', 'local', 'projectDir']
  );
  assert.equal(c[0].file, path.join(path.resolve('/a/b/c'), 'CLAUDE.md'));
  assert.equal(c[2].file, path.join(path.resolve('/a/b/c'), '.claude', 'CLAUDE.md'));
  assert.deepEqual([...new Set(c.map((x) => x.depth))].slice(0, 3), [0, 1, 2]);
  // 3 candidates per level, and the walk stops at the filesystem root rather
  // than running to the depth cap.
  assert.equal(c.length % 3, 0);
  assert.ok(c.length <= 12 * 3);
  const deepest = c[c.length - 1].file;
  assert.equal(path.dirname(path.dirname(deepest)), path.dirname(path.resolve('/')));
});

test('ancestorCandidates stops once it has covered the boundary directory', () => {
  const base = path.resolve('/a/b');
  const c = ancestorCandidates(path.join(base, 'c', 'd'), base);
  assert.deepEqual([...new Set(c.map((x) => x.depth))], [0, 1, 2]);
  assert.equal(c[c.length - 1].file, path.join(base, '.claude', 'CLAUDE.md'));
});

test('a project yields its own CLAUDE.md AND its auto-memory, project file first', () => {
  const root = tmp();
  try {
    const proj = path.join(root, 'repo');
    const projectsDir = path.join(root, 'projects');
    write(path.join(proj, 'CLAUDE.md'), '# repo rules');
    const enc = encodeProjectDir(proj);
    write(path.join(projectsDir, enc, 'memory', 'MEMORY.md'), '# index');
    write(path.join(projectsDir, enc, 'memory', 'a-topic.md'), 'topic');

    const tree = discoverMemory({
      db: fakeDb([{ id: 1, path: proj, name: 'repo', parent_project_id: null, worktree_branch: null, last_seen: 5 }]),
      claudeDir: path.join(root, 'claude'),
      homeDir: root,
      projectsDir,
    });

    const g = tree.groups.find((x) => x.rootPath === proj);
    assert.ok(g, 'the project group exists');
    assert.deepEqual(
      g.files.map((f) => `${f.scope}:${f.rel || f.name}`),
      ['project:CLAUDE.md', 'auto:MEMORY.md', 'auto:a-topic.md']
    );
    assert.equal(g.files[0].exists, true);
    assert.ok(g.files[0].sizeBytes > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an encoded dir with no project row still produces a group', () => {
  const root = tmp();
  try {
    const projectsDir = path.join(root, 'projects');
    write(path.join(projectsDir, 'C--gone-away', 'memory', 'MEMORY.md'), '# stale');
    const tree = discoverMemory({ db: fakeDb([]), claudeDir: path.join(root, 'claude'), projectsDir });
    const g = tree.groups.find((x) => x.key === 'dir:C--gone-away');
    assert.ok(g, 'orphan encoded dirs are not dropped');
    assert.equal(g.files.length, 1);
    assert.equal(g.files[0].scope, 'auto');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('worktrees nest under the parent and the shared CLAUDE.md is listed once', () => {
  const root = tmp();
  try {
    const proj = path.join(root, 'repo');
    const wt = path.join(proj, '.claude', 'worktrees', 'feature-abc123');
    write(path.join(proj, 'CLAUDE.md'), 'parent');
    write(path.join(wt, 'CLAUDE.md'), 'worktree copy');

    const tree = discoverMemory({
      db: fakeDb([
        { id: 1, path: proj, name: 'repo', parent_project_id: null, worktree_branch: null, last_seen: 9 },
        { id: 2, path: wt, name: 'repo [feature]', parent_project_id: 1, worktree_branch: 'feature', last_seen: 8 },
      ]),
      claudeDir: path.join(root, 'claude'),
      homeDir: root,
      projectsDir: path.join(root, 'projects'),
    });

    const g = tree.groups.find((x) => x.rootPath === proj);
    assert.equal(g.worktrees.length, 1);
    assert.equal(g.worktrees[0].branch, 'feature');
    assert.deepEqual(g.worktrees[0].files.map((f) => f.rel), ['CLAUDE.md']);
    // The parent's file must not be repeated inside the worktree section.
    const parentMd = canon(path.join(proj, 'CLAUDE.md'));
    assert.equal(allFiles(tree).filter((f) => canon(f.path) === parentMd).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('includeMissing offers exactly one ghost row, and only the project CLAUDE.md', () => {
  const root = tmp();
  try {
    const proj = path.join(root, 'repo');
    fs.mkdirSync(proj, { recursive: true });
    const db = fakeDb([
      { id: 1, path: proj, name: 'repo', parent_project_id: null, worktree_branch: null, last_seen: 1 },
    ]);
    const opts = { db, claudeDir: path.join(root, 'claude'), homeDir: root, projectsDir: path.join(root, 'projects') };

    const on = discoverMemory(opts);
    const g = on.groups.find((x) => x.rootPath === proj);
    assert.deepEqual(g.files.map((f) => [f.scope, f.depth, f.exists]), [['project', 0, false]]);
    // No CLAUDE.local.md / .claude/CLAUDE.md ghosts, and nothing from ancestors.
    assert.equal(g.files.filter((f) => !f.exists && f.scope !== 'project').length, 0);

    const off = discoverMemory({ ...opts, includeMissing: false });
    assert.equal(off.groups.find((x) => x.rootPath === proj), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the index is the allowlist: only discovered paths are members', () => {
  const root = tmp();
  try {
    const proj = path.join(root, 'repo');
    const projectsDir = path.join(root, 'projects');
    const enc = encodeProjectDir(proj);
    write(path.join(proj, 'CLAUDE.md'), 'ok');
    write(path.join(projectsDir, enc, 'memory', 'MEMORY.md'), 'ok');
    write(path.join(projectsDir, enc, 'session.jsonl'), '{}');
    write(path.join(root, 'elsewhere', 'random.md'), 'nope');

    const { index } = discoverMemory({
      db: fakeDb([{ id: 1, path: proj, name: 'repo', parent_project_id: null, worktree_branch: null, last_seen: 1 }]),
      claudeDir: path.join(root, 'claude'),
      homeDir: root,
      projectsDir,
    });

    assert.ok(index.has(canon(path.join(proj, 'CLAUDE.md'))));
    assert.ok(index.has(canon(path.join(projectsDir, enc, 'memory', 'MEMORY.md'))));
    // Case-folded lookup on win32 must still hit.
    assert.ok(index.has(canon(path.join(proj, 'CLAUDE.md').toUpperCase())) || process.platform !== 'win32');

    assert.equal(index.has(canon(path.join(projectsDir, enc, 'session.jsonl'))), false);
    assert.equal(index.has(canon(path.join(projectsDir, enc, 'memory', '..', '..', 'evil.md'))), false);
    assert.equal(index.has(canon(path.join(root, 'elsewhere', 'random.md'))), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('violatesProjectsInvariant permits only <encoded>/memory/*.md under projects', () => {
  const projects = path.resolve('/claude/projects');
  const ok = path.join(projects, 'C--x', 'memory', 'MEMORY.md');
  assert.equal(violatesProjectsInvariant(ok, projects), false);

  assert.equal(violatesProjectsInvariant(path.join(projects, 'C--x', 'sess.jsonl'), projects), true);
  assert.equal(violatesProjectsInvariant(path.join(projects, 'C--x', 'memory', 'sub', 'a.md'), projects), true);
  assert.equal(violatesProjectsInvariant(path.join(projects, 'C--x', 'notes', 'a.md'), projects), true);
  assert.equal(violatesProjectsInvariant(path.join(projects, 'C--x', 'memory', 'a.jsonl'), projects), true);
  assert.equal(violatesProjectsInvariant(path.join(projects, 'C--x', 'memory', '..', '..', 'settings.json'), projects), true);
  assert.equal(violatesProjectsInvariant(projects, projects), true);

  // Outside the projects tree the invariant simply does not apply.
  assert.equal(violatesProjectsInvariant(path.resolve('/repo/CLAUDE.md'), projects), false);
});
