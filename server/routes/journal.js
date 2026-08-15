const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

export function mountJournal(app, ctx) {
  const { db, sse } = ctx;

  app.get('/api/journal', (req, res) => {
    const page = Math.max(Number(req.query.page) || 0, 0);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
    const where = [];
    const args = [];
    if (req.query.project) {
      where.push('(p.id=? OR p.parent_project_id=?)');
      args.push(Number(req.query.project), Number(req.query.project));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const base = `FROM journal j LEFT JOIN projects p ON p.path = j.project_path ${whereSql}`;
    const total = db.prepare(`SELECT count(*) c ${base}`).get(...args).c;
    const rows = db
      .prepare(
        `SELECT j.id, j.ts, j.project_path, j.session_id, j.text, j.source, p.id project_id, p.name project_name
           ${base} ORDER BY j.ts DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, page * pageSize)
      .map((r) => ({
        id: r.id, ts: r.ts, projectPath: r.project_path, projectId: r.project_id,
        projectName: r.project_name, sessionId: r.session_id, text: r.text, source: r.source,
      }));
    ok(res, { total, page, pageSize, rows });
  });

  app.post('/api/journal', (req, res) => {
    const b = req.body ?? {};
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) return bad(res, 'text is required');
    if (text.length > 2000) return bad(res, 'text too long (max 2000 chars)');
    const projectPath = typeof b.projectPath === 'string' && b.projectPath ? b.projectPath : null;
    const sessionId = typeof b.sessionId === 'string' && b.sessionId ? b.sessionId : null;
    const source = b.source === 'claude' ? 'claude' : 'ui';
    const r = db
      .prepare('INSERT INTO journal(ts, project_path, session_id, text, source) VALUES(?,?,?,?,?)')
      .run(Date.now(), projectPath, sessionId, text, source);
    sse.broadcast('data-changed', { journal: true });
    ok(res, { id: Number(r.lastInsertRowid) });
  });

  app.patch('/api/journal/:id', (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return bad(res, 'text is required');
    if (text.length > 2000) return bad(res, 'text too long (max 2000 chars)');
    const r = db.prepare('UPDATE journal SET text=? WHERE id=?').run(text, Number(req.params.id));
    if (!r.changes) return bad(res, 'not found', 404);
    sse.broadcast('data-changed', { journal: true });
    ok(res, { updated: true });
  });

  app.delete('/api/journal/:id', (req, res) => {
    const r = db.prepare('DELETE FROM journal WHERE id=?').run(Number(req.params.id));
    if (!r.changes) return bad(res, 'not found', 404);
    sse.broadcast('data-changed', { journal: true });
    ok(res, { deleted: true });
  });
}
