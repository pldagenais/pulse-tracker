// Claude memory-file editor. Lists and edits every file Claude Code loads into
// context: the global ~/.claude/CLAUDE.md, each project's committed CLAUDE.md /
// CLAUDE.local.md / .claude/CLAUDE.md walking up from its cwd, and the
// auto-memory under ~/.claude/projects/<encoded>/memory/*.md.
//
// Two write surfaces, two guards:
//   - Under ~/.claude/projects the ONLY writable shape is <encoded>/memory/*.md
//     — transcripts stay untouchable (violatesProjectsInvariant, enforced
//     independently of discovery).
//   - Everywhere else, a path is writable iff the discovery pass itself
//     produced it. Membership in that set, never a pattern match on input.
// Every save keeps a rotating backup under data/memory-backups.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { canon, discoverMemory, violatesProjectsInvariant } from '../lib/memory-files.js';
import { log } from '../lib/logger.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

const BACKUP_DIR = path.join(DATA_DIR, 'memory-backups');
const MAX_BYTES = 512 * 1024;
const BACKUPS_PER_FILE = 10;
const MAX_BACKUP_DIRS = 200;
const INDEX_TTL_MS = 30_000;

/** @type {{at: number, tree: ReturnType<typeof discoverMemory>|null}} */
let cache = { at: 0, tree: null };

/** Discovery is ~1k statSync calls — cheap, but the SPA remounts freely. */
function tree(db, fresh = false) {
  if (!fresh && cache.tree && Date.now() - cache.at < INDEX_TTL_MS) return cache.tree;
  cache = { at: Date.now(), tree: discoverMemory({ db }) };
  return cache.tree;
}

/**
 * The one gate for both file endpoints. Recomputes rather than trusting the
 * memo: file operations are rare and human-driven, and a file created a second
 * ago must be reachable immediately.
 * @returns {import('../lib/memory-files.js').MemoryFile|null}
 */
function resolveEditable(db, p) {
  if (typeof p !== 'string' || !p) return null;
  const r = path.resolve(p);
  if (!r.toLowerCase().endsWith('.md')) return null;
  if (violatesProjectsInvariant(r)) return null;
  return tree(db, true).index.get(canon(r)) ?? null;
}

/** Only files the card actually advertises as creatable may be conjured. */
const creatable = (hit) => hit.scope === 'global' || (hit.scope === 'project' && hit.depth === 0);

/** Keep the newest MAX_BACKUP_DIRS shards, dropping the least recently written. */
function pruneBackupDirs() {
  const dirs = fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const full = path.join(BACKUP_DIR, d.name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { /* racing another save */ }
      return { full, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const d of dirs.slice(MAX_BACKUP_DIRS)) fs.rmSync(d.full, { recursive: true, force: true });
}

/**
 * Snapshot the previous contents before overwriting. Sharded per file — a flat
 * directory cannot tell two repos' CLAUDE.md apart, and a global cap would give
 * each of ~60 editable files roughly one version.
 * Best-effort: a backup failure must never block the save.
 */
function writeBackup(filePath) {
  try {
    const prev = fs.readFileSync(filePath, 'utf8'); // absent => nothing to back up
    const base = path.basename(filePath);
    const slug = `${base.replace(/[^\w.-]/g, '_')}-${createHash('sha1').update(canon(filePath)).digest('hex').slice(0, 8)}`;
    const dir = path.join(BACKUP_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(dir, `${stamp}-${base}`), prev);
    // The ISO stamp prefix makes a lexicographic sort chronological.
    const old = fs.readdirSync(dir).sort();
    for (const f of old.slice(0, Math.max(old.length - BACKUPS_PER_FILE, 0))) fs.unlinkSync(path.join(dir, f));
    pruneBackupDirs();
  } catch {
    /* best-effort */
  }
}

export function mountMemory(app, ctx) {
  const { db } = ctx;

  app.get('/api/memory', (req, res) => {
    const { groups, count } = tree(db, req.query.refresh === '1');
    ok(res, { groups, count });
  });

  app.get('/api/memory/file', (req, res) => {
    const hit = resolveEditable(db, String(req.query.path ?? ''));
    if (!hit) return bad(res, 'path is not an editable memory file', 403);
    if (!hit.exists) return ok(res, { path: hit.path, content: '', mtime: 0, exists: false, scope: hit.scope });
    try {
      ok(res, { path: hit.path, content: fs.readFileSync(hit.path, 'utf8'), mtime: hit.mtime, exists: true, scope: hit.scope });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 404);
    }
  });

  app.put('/api/memory/file', (req, res) => {
    const hit = resolveEditable(db, String(req.body?.path ?? ''));
    if (!hit) return bad(res, 'path is not an editable memory file', 403);
    const content = String(req.body?.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return bad(res, 'file too large (512KB max)');
    if (!hit.exists && !creatable(hit)) return bad(res, 'file does not exist', 404);

    // Claude Code rewrites these files itself; without this an editor left open
    // silently clobbers the agent's work in the user's own repo. The UI offers
    // an explicit overwrite, which re-sends with no baseMtime.
    const baseMtime = req.body?.baseMtime;
    if (hit.exists && baseMtime != null && Math.abs(hit.mtime - Number(baseMtime)) > 1) {
      return bad(res, 'file changed on disk since it was opened', 409);
    }

    try {
      if (fs.lstatSync(hit.path).isSymbolicLink()) return bad(res, 'refusing to write through a symlink', 403);
    } catch {
      /* does not exist — creating it */
    }

    try {
      writeBackup(hit.path);
      fs.writeFileSync(hit.path, content, 'utf8');
      cache = { at: 0, tree: null };
      log.info(`memory: saved ${hit.path} (${hit.scope})`);
      ok(res, { saved: hit.path, mtime: fs.statSync(hit.path).mtimeMs });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });
}
