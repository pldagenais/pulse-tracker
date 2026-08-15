import path from 'node:path';

// Git-worktree checkouts live under <parent>\.claude\worktrees\<branch>-<hex>;
// they display grouped under the parent project with a branch tag.
const WORKTREE_RE = /^(.*)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)$/;

/**
 * Returns a resolver that maps a real cwd path to a projects.id,
 * creating rows (and worktree parents) as needed. Caches by path.
 */
export function makeProjectResolver(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO projects(path, name, parent_project_id, worktree_branch) VALUES(?,?,?,?)'
  );
  const select = db.prepare('SELECT id, name FROM projects WHERE path=?');
  /** @type {Map<string, number>} */
  const cache = new Map();
  /** @type {Map<number, string>} */
  const nameById = new Map();

  function resolve(cwdPath) {
    if (!cwdPath) return null;
    const cached = cache.get(cwdPath);
    if (cached !== undefined) return cached;

    const existing = select.get(cwdPath);
    if (existing) {
      cache.set(cwdPath, existing.id);
      nameById.set(existing.id, existing.name);
      return existing.id;
    }

    let name;
    let parentId = null;
    let branch = null;
    const m = WORKTREE_RE.exec(cwdPath);
    if (m) {
      parentId = resolve(m[1]);
      branch = m[2].replace(/-[0-9a-f]{6}$/i, '');
      const parentName = (parentId != null && nameById.get(parentId)) || path.basename(m[1]) || m[1];
      name = `${parentName} [${branch}]`;
    } else {
      name = path.basename(cwdPath) || cwdPath;
    }

    insert.run(cwdPath, name, parentId, branch);
    const row = select.get(cwdPath);
    cache.set(cwdPath, row.id);
    nameById.set(row.id, row.name);
    return row.id;
  }

  return resolve;
}
