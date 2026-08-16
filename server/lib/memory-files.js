// Every memory file Claude Code loads into context for a project:
//   A  ~/.claude/CLAUDE.md                                     (global)
//   B  <dir>/CLAUDE.md | CLAUDE.local.md | .claude/CLAUDE.md,
//      for the project cwd AND each ancestor          (project-committed —
//                                                      lives in the user's repo)
//   C  ~/.claude/projects/<encoded>/memory/*.md                (auto-memory)
// Tier D (transitive `@path` imports) is deliberately not implemented.
//
// The returned `index` doubles as the editor's write allowlist: a path is
// writable iff this discovery pass itself produced it. Callers must never
// pattern-match user input instead — see routes/memory.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_DIR, PROJECTS_DIR } from '../config.js';

// Deepest real checkout here is 8 segments; 12 bounds a pathological cwd.
const MAX_ANCESTOR_DEPTH = 12;

/** @typedef {'global'|'project'|'local'|'projectDir'|'auto'} MemoryScope */

/**
 * @typedef {object} MemoryFile
 * @property {string} path absolute, resolved
 * @property {string} name basename
 * @property {MemoryScope} scope
 * @property {string} rel posix path relative to the group root; '' for global/auto
 * @property {number|null} depth ancestor distance from the project cwd (0 = its own dir)
 * @property {boolean} exists
 * @property {number} sizeBytes
 * @property {number} mtime
 */

/** @typedef {{key:string, label:string, branch:string|null, files:MemoryFile[]}} MemoryWorktree */

/**
 * @typedef {object} MemoryGroup
 * @property {string} key
 * @property {string} label
 * @property {string|null} rootPath
 * @property {number|null} lastSeen
 * @property {MemoryFile[]} files
 * @property {MemoryWorktree[]} worktrees
 */

/** Lookup key for dedupe and the allowlist. win32 paths are case-insensitive. */
export const canon = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * Encode a cwd the way Claude Code names project folders. Deliberately does NOT
 * strip a trailing separator: a drive root really is `C:\` and really does
 * encode to `C--`.
 */
export const encodeProjectDir = (p) => String(p).replace(/[^a-zA-Z0-9]/g, '-');

const toPosix = (p) => p.split(path.sep).join('/');

/** stat that never throws; a directory counts as absent. */
function statFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return { exists: false, sizeBytes: 0, mtime: 0 };
    return { exists: true, sizeBytes: st.size, mtime: st.mtimeMs };
  } catch {
    return { exists: false, sizeBytes: 0, mtime: 0 };
  }
}

/**
 * @param {string} file
 * @param {MemoryScope} scope
 * @param {number|null} depth
 * @param {string|null} rootPath
 * @returns {MemoryFile}
 */
function makeEntry(file, scope, depth, rootPath) {
  return {
    path: file,
    name: path.basename(file),
    scope,
    rel: rootPath ? toPosix(path.relative(rootPath, file)) : '',
    depth,
    ...statFile(file),
  };
}

/**
 * Project-committed candidates, walking UP from cwd to the filesystem root.
 * Nearest-first (depth 0 = cwd): Claude loads these root→cwd so the nearest one
 * wins, and nearest-first is the useful reading order.
 *
 * A worktree cwd `<P>/.claude/worktrees/<W>` needs no special case — the walk
 * yields its own CLAUDE.md at depth 0 and the parent repo's at depth 3.
 *
 * Stops once it has covered `stopAt` (the home directory by default): above it
 * there is no project memory, only `~/.claude/CLAUDE.md`, which is tier A.
 * @param {string} cwd
 * @param {string} [stopAt]
 * @returns {{file: string, scope: MemoryScope, depth: number}[]}
 */
export function ancestorCandidates(cwd, stopAt = os.homedir()) {
  /** @type {{file: string, scope: MemoryScope, depth: number}[]} */
  const out = [];
  const stop = stopAt ? canon(stopAt) : null;
  let dir = path.resolve(cwd);
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
    out.push(
      { file: path.join(dir, 'CLAUDE.md'), scope: 'project', depth },
      { file: path.join(dir, 'CLAUDE.local.md'), scope: 'local', depth },
      { file: path.join(dir, '.claude', 'CLAUDE.md'), scope: 'projectDir', depth }
    );
    if (stop && canon(dir) === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // drive root / '/'
    dir = parent;
  }
  return out;
}

/** Auto-memory for one encoded folder: MEMORY.md (the index) first, then A-Z. */
function autoMemoryFiles(projectsDir, encoded) {
  const dir = path.join(projectsDir, encoded, 'memory');
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
  names.sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : a.localeCompare(b)));
  return names.map((n) => makeEntry(path.join(dir, n), 'auto', null, null));
}

/**
 * Hard guard, independent of discovery: inside ~/.claude/projects the ONLY
 * writable shape is <encoded>/memory/<file>.md. Transcripts stay untouchable
 * even if discovery itself has a bug.
 * @param {string} p
 * @param {string} [projectsDir]
 */
export function violatesProjectsInvariant(p, projectsDir = PROJECTS_DIR) {
  const r = path.resolve(p);
  const root = path.resolve(projectsDir);
  if (canon(r) !== canon(root) && !canon(r).startsWith(canon(root) + path.sep)) return false;
  const rel = path.relative(root, r).split(path.sep);
  return !(rel.length === 3 && rel[1] === 'memory' && rel[2].toLowerCase().endsWith('.md'));
}

/**
 * Build the full memory tree and the allowlist index in one pass.
 *
 * Visit order is also dedupe priority — the first group to reach a path owns
 * it, which is what stops one repo's CLAUDE.md from appearing once per worktree.
 * @param {{db?: any, claudeDir?: string, projectsDir?: string, homeDir?: string, includeMissing?: boolean}} opts
 * @returns {{groups: MemoryGroup[], index: Map<string, MemoryFile>, count: number}}
 */
export function discoverMemory({
  db,
  claudeDir = CLAUDE_DIR,
  projectsDir = PROJECTS_DIR,
  homeDir = os.homedir(),
  includeMissing = true,
} = {}) {
  /** @type {Map<string, MemoryFile>} */
  const index = new Map();
  /** @type {MemoryGroup[]} */
  const groups = [];
  /** Encoded folder names accounted for by a project row. */
  const claimedDirs = new Set();

  // ── Tier A ────────────────────────────────────────────────────────────────
  // Listed even when absent, so the card can offer to create it.
  const globalEntry = makeEntry(path.join(claudeDir, 'CLAUDE.md'), 'global', null, null);
  index.set(canon(globalEntry.path), globalEntry);
  groups.push({
    key: 'global',
    label: 'Global — ~/.claude/CLAUDE.md',
    rootPath: null,
    lastSeen: null,
    files: [globalEntry],
    worktrees: [],
  });

  // ── Project rows ──────────────────────────────────────────────────────────
  /** @type {any[]} */
  let rows = [];
  try {
    rows = /** @type {any[]} */ (
      db.prepare('SELECT id, path, name, parent_project_id, worktree_branch, last_seen FROM projects').all()
    );
  } catch {
    /* no db yet — global + orphan encoded dirs still resolve */
  }

  /** @type {Map<number, any[]>} */
  const childrenByParent = new Map();
  const roots = [];
  for (const r of rows) {
    if (!r?.path) continue;
    if (r.parent_project_id == null) roots.push(r);
    else {
      const list = childrenByParent.get(r.parent_project_id);
      if (list) list.push(r);
      else childrenByParent.set(r.parent_project_id, [r]);
    }
  }
  // A child whose parent row vanished would otherwise never be rendered.
  const rootIds = new Set(roots.map((r) => r.id));
  for (const [pid, list] of childrenByParent) {
    if (!rootIds.has(pid)) {
      roots.push(...list);
      childrenByParent.delete(pid);
    }
  }
  const byLastSeen = (a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0);
  roots.sort(byLastSeen);

  /**
   * Tier B + tier C for one project row, skipping anything an earlier group
   * already owns.
   * @returns {MemoryFile[]}
   */
  const filesFor = (row, allowMissing) => {
    /** @type {MemoryFile[]} */
    const files = [];
    const encoded = encodeProjectDir(row.path);
    claimedDirs.add(encoded);

    // Only walk a checkout that still exists — plenty of rows point at deleted
    // worktrees, whose auto-memory can still be worth showing.
    if (fs.existsSync(row.path)) {
      for (const c of ancestorCandidates(row.path, homeDir)) {
        const key = canon(c.file);
        if (index.has(key)) continue;
        const entry = makeEntry(c.file, c.scope, c.depth, row.path);
        // One actionable ghost per project: its own CLAUDE.md. Listing every
        // missing candidate would be ~900 dead rows across this machine.
        if (!entry.exists && !(allowMissing && c.scope === 'project' && c.depth === 0)) continue;
        index.set(key, entry);
        files.push(entry);
      }
    }

    for (const e of autoMemoryFiles(projectsDir, encoded)) {
      const key = canon(e.path);
      if (index.has(key)) continue;
      index.set(key, e);
      files.push(e);
    }
    return files;
  };

  for (const root of roots) {
    const files = filesFor(root, includeMissing);
    /** @type {MemoryWorktree[]} */
    const worktrees = [];
    // Parent first, so the shared repo CLAUDE.md is claimed once and a worktree
    // contributes only what is genuinely its own.
    for (const child of (childrenByParent.get(root.id) ?? []).sort(byLastSeen)) {
      const cf = filesFor(child, false);
      if (cf.length) {
        worktrees.push({ key: child.path, label: child.name, branch: child.worktree_branch ?? null, files: cf });
      }
    }
    if (!files.length && !worktrees.length) continue;
    groups.push({
      key: root.path,
      label: root.name || root.path,
      rootPath: root.path,
      lastSeen: root.last_seen ?? null,
      files,
      worktrees,
    });
  }

  // ── Orphan encoded folders ────────────────────────────────────────────────
  // Auto-memory no project row accounts for (stale checkouts, renamed dirs).
  // The encoding is lossy so there is no cwd to walk — tier C only. This is
  // what keeps coverage identical to the old directory-first scan.
  try {
    for (const d of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!d.isDirectory() || claimedDirs.has(d.name)) continue;
      const files = autoMemoryFiles(projectsDir, d.name).filter((e) => !index.has(canon(e.path)));
      if (!files.length) continue;
      for (const e of files) index.set(canon(e.path), e);
      groups.push({ key: `dir:${d.name}`, label: d.name, rootPath: null, lastSeen: null, files, worktrees: [] });
    }
  } catch {
    /* projects dir unreadable */
  }

  return { groups, index, count: index.size };
}
