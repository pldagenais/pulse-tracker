// Claude memory-file editor: the global ~/.claude/CLAUDE.md plus each
// project's auto-memory (~/.claude/projects/<encoded>/memory/*.md).
// This is the ONE sanctioned exception to "never write under ~/.claude/
// projects": strictly *.md inside memory/ folders — transcripts stay
// untouchable. Every save keeps a rotating backup under data/memory-backups.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, PROJECTS_DIR, DATA_DIR } from '../config.js';
import { log } from '../lib/logger.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

const GLOBAL_MD = path.join(CLAUDE_DIR, 'CLAUDE.md');
const BACKUP_DIR = path.join(DATA_DIR, 'memory-backups');
const MAX_BYTES = 512 * 1024;

/** Encode a cwd the way Claude Code names project folders. */
const encodePath = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');

/** A path is editable iff it's the global CLAUDE.md or projects/<dir>/memory/<file>.md */
function allowed(p) {
  const r = path.resolve(p);
  if (r === path.resolve(GLOBAL_MD)) return true;
  if (!r.toLowerCase().endsWith('.md')) return false;
  const root = path.resolve(PROJECTS_DIR);
  if (!r.startsWith(root + path.sep)) return false;
  const rel = r.slice(root.length + 1).split(path.sep);
  return rel.length === 3 && rel[1] === 'memory';
}

export function mountMemory(app, ctx) {
  const { db } = ctx;

  app.get('/api/memory', (req, res) => {
    // friendly names: encode each known project path and match folder names
    const nameByDir = new Map();
    try {
      for (const p of /** @type {any[]} */ (db.prepare('SELECT name, path FROM projects WHERE parent_project_id IS NULL').all())) {
        nameByDir.set(encodePath(p.path), p.name);
      }
    } catch { /* ignore */ }

    const groups = [];
    try {
      const st = fs.statSync(GLOBAL_MD);
      groups.push({
        label: 'Global — ~/.claude/CLAUDE.md',
        files: [{ path: GLOBAL_MD, name: 'CLAUDE.md', sizeBytes: st.size, mtime: st.mtimeMs }],
      });
    } catch { /* no global file yet */ }

    try {
      for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const memDir = path.join(PROJECTS_DIR, d.name, 'memory');
        let entries;
        try { entries = fs.readdirSync(memDir).filter((f) => f.endsWith('.md')); } catch { continue; }
        if (!entries.length) continue;
        const files = entries.map((f) => {
          const full = path.join(memDir, f);
          const st = fs.statSync(full);
          return { path: full, name: f, sizeBytes: st.size, mtime: st.mtimeMs };
        }).sort((a, b) => (a.name === 'MEMORY.md' ? -1 : b.name === 'MEMORY.md' ? 1 : a.name.localeCompare(b.name)));
        groups.push({ label: nameByDir.get(d.name) ?? d.name, files });
      }
    } catch { /* projects dir unreadable */ }

    ok(res, { groups });
  });

  app.get('/api/memory/file', (req, res) => {
    const p = String(req.query.path ?? '');
    if (!allowed(p)) return bad(res, 'path is not an editable memory file', 403);
    try {
      ok(res, { path: p, content: fs.readFileSync(p, 'utf8') });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 404);
    }
  });

  app.put('/api/memory/file', (req, res) => {
    const p = String(req.body?.path ?? '');
    const content = String(req.body?.content ?? '');
    if (!allowed(p)) return bad(res, 'path is not an editable memory file', 403);
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return bad(res, 'file too large (512KB max)');
    try {
      // rotating backup of the previous version
      try {
        const prev = fs.readFileSync(p, 'utf8');
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        fs.writeFileSync(path.join(BACKUP_DIR, `${stamp}-${path.basename(p)}`), prev);
        const old = fs.readdirSync(BACKUP_DIR).sort();
        for (const f of old.slice(0, Math.max(old.length - 40, 0))) fs.unlinkSync(path.join(BACKUP_DIR, f));
      } catch { /* new file — nothing to back up */ }
      fs.writeFileSync(p, content, 'utf8');
      log.info(`memory: saved ${p}`);
      ok(res, { saved: p });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });
}
