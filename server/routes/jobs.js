// Control plane: launch/inspect/kill headless claude jobs; CRUD for prompt
// templates (the Run page's library + per-project quick actions).
import { log } from '../lib/logger.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

const MODELS = new Set(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5']);

export function mountJobs(app, ctx) {
  const { db, jobs, scheduler } = ctx;

  const jobRow = (r) => ({
    id: r.id,
    createdAt: r.created_at,
    sessionId: r.session_id,
    resumeOf: r.resume_of,
    projectId: r.project_id,
    projectPath: r.project_path,
    prompt: r.prompt,
    model: r.model,
    maxTurns: r.max_turns,
    permissionMode: r.permission_mode,
    status: r.status === 'running' && !jobs.isRunning(r.id) ? 'error' : r.status,
    exitCode: r.exit_code,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    outputTail: r.output_tail,
  });

  app.get('/api/jobs', (req, res) => {
    const rows = db.prepare('SELECT * FROM pulse_jobs ORDER BY id DESC LIMIT 50').all();
    ok(res, { jobs: rows.map(jobRow), running: jobs.runningCount() });
  });

  app.post('/api/jobs', (req, res) => {
    const b = req.body ?? {};
    const project = /** @type {any} */ (db.prepare('SELECT id, path FROM projects WHERE id=?').get(Number(b.projectId)));
    if (!project) return bad(res, 'unknown project', 404);
    const model = b.model && MODELS.has(String(b.model)) ? String(b.model) : null;
    const maxTurns = Number.isFinite(Number(b.maxTurns)) && Number(b.maxTurns) > 0 ? Math.min(Number(b.maxTurns), 50) : 15;
    try {
      const { jobId, sessionId } = jobs.launch({
        projectId: project.id,
        projectPath: project.path,
        prompt: String(b.prompt ?? ''),
        model,
        maxTurns,
        permissionMode: typeof b.permissionMode === 'string' ? b.permissionMode : 'default',
      });
      if (b.templateId) {
        try {
          db.prepare('UPDATE prompt_templates SET run_count=run_count+1, last_run_at=? WHERE id=?').run(Date.now(), Number(b.templateId));
        } catch { /* ignore */ }
      }
      ok(res, { jobId, sessionId });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e));
    }
  });

  // Continue a finished session with full context (claude -p --resume).
  app.post('/api/sessions/:id/continue', (req, res) => {
    const sid = String(req.params.id);
    const row = /** @type {any} */ (db
      .prepare('SELECT s.project_id, p.path FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?')
      .get(sid));
    if (!row) return bad(res, 'unknown session', 404);
    const b = req.body ?? {};
    const model = b.model && MODELS.has(String(b.model)) ? String(b.model) : null;
    try {
      const { jobId } = jobs.launch({
        projectId: row.project_id,
        projectPath: row.path,
        prompt: String(b.prompt ?? ''),
        model,
        maxTurns: 15,
        permissionMode: typeof b.permissionMode === 'string' ? b.permissionMode : 'default',
        resumeOf: sid,
      });
      ok(res, { jobId });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e));
    }
  });

  app.post('/api/jobs/:id/kill', (req, res) => {
    const id = Number(req.params.id);
    if (!jobs.kill(id)) return bad(res, 'job is not running', 404);
    log.info(`job ${id}: kill requested via UI`);
    ok(res, { killed: id });
  });

  /* ── prompt templates ─────────────────────────────────────────────── */
  const tplRow = (r) => ({
    id: r.id,
    name: r.name,
    body: r.body,
    projectId: r.project_id,
    model: r.model,
    maxTurns: r.max_turns,
    permissionMode: r.permission_mode,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    runCount: r.run_count,
    lastRunAt: r.last_run_at,
  });

  app.get('/api/templates', (req, res) => {
    const rows = db.prepare('SELECT * FROM prompt_templates ORDER BY pinned DESC, COALESCE(last_run_at, created_at) DESC').all();
    ok(res, rows.map(tplRow));
  });

  app.post('/api/templates', (req, res) => {
    const b = req.body ?? {};
    if (!String(b.name ?? '').trim() || !String(b.body ?? '').trim()) return bad(res, 'name and body are required');
    const r = db.prepare(
      'INSERT INTO prompt_templates(name, body, project_id, model, max_turns, permission_mode, pinned, created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(
      String(b.name).slice(0, 80), String(b.body).slice(0, 10_000),
      b.projectId != null ? Number(b.projectId) : null,
      b.model ? String(b.model) : null,
      b.maxTurns != null ? Number(b.maxTurns) : null,
      b.permissionMode ? String(b.permissionMode) : null,
      b.pinned ? 1 : 0, Date.now()
    );
    ok(res, { id: Number(r.lastInsertRowid) });
  });

  app.put('/api/templates/:id', (req, res) => {
    const b = req.body ?? {};
    const cur = db.prepare('SELECT id FROM prompt_templates WHERE id=?').get(Number(req.params.id));
    if (!cur) return bad(res, 'unknown template', 404);
    db.prepare(
      'UPDATE prompt_templates SET name=?, body=?, project_id=?, model=?, max_turns=?, permission_mode=?, pinned=? WHERE id=?'
    ).run(
      String(b.name ?? '').slice(0, 80), String(b.body ?? '').slice(0, 10_000),
      b.projectId != null ? Number(b.projectId) : null,
      b.model ? String(b.model) : null,
      b.maxTurns != null ? Number(b.maxTurns) : null,
      b.permissionMode ? String(b.permissionMode) : null,
      b.pinned ? 1 : 0, Number(req.params.id)
    );
    ok(res, { updated: Number(req.params.id) });
  });

  app.delete('/api/templates/:id', (req, res) => {
    db.prepare('DELETE FROM prompt_templates WHERE id=?').run(Number(req.params.id));
    ok(res, { deleted: Number(req.params.id) });
  });

  /* ── scheduled recurring jobs ─────────────────────────────────────── */
  const schedRow = (r) => ({
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    projectPath: r.project_path,
    model: r.model,
    maxTurns: r.max_turns,
    permissionMode: r.permission_mode,
    cadence: r.cadence,
    hour: r.hour,
    minute: r.minute,
    dow: r.dow,
    enabled: !!r.enabled,
    lastRunAt: r.last_run_at,
    lastJobId: r.last_job_id,
    lastStatus: r.last_status,
    consecutiveFailures: r.consecutive_failures,
  });

  app.get('/api/schedules', (req, res) => {
    ok(res, db.prepare('SELECT * FROM scheduled_jobs ORDER BY id').all().map(schedRow));
  });

  app.post('/api/schedules', (req, res) => {
    const b = req.body ?? {};
    const project = /** @type {any} */ (db.prepare('SELECT path FROM projects WHERE id=?').get(Number(b.projectId)));
    if (!project) return bad(res, 'unknown project', 404);
    if (!String(b.name ?? '').trim() || !String(b.prompt ?? '').trim()) return bad(res, 'name and prompt are required');
    const cadence = b.cadence === 'weekly' ? 'weekly' : 'daily';
    const hour = Math.min(Math.max(Number(b.hour) || 0, 0), 23);
    const minute = Math.min(Math.max(Number(b.minute) || 0, 0), 59);
    const r = db.prepare(
      `INSERT INTO scheduled_jobs(name, prompt, project_path, model, max_turns, permission_mode, cadence, hour, minute, dow, enabled, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,1,?)`
    ).run(
      String(b.name).slice(0, 80), String(b.prompt).slice(0, 10_000), project.path,
      b.model && MODELS.has(String(b.model)) ? String(b.model) : null,
      Number(b.maxTurns) > 0 ? Math.min(Number(b.maxTurns), 50) : 15,
      typeof b.permissionMode === 'string' ? b.permissionMode : 'default',
      cadence, hour, minute, cadence === 'weekly' ? Math.min(Math.max(Number(b.dow) || 1, 0), 6) : null,
      Date.now()
    );
    ok(res, { id: Number(r.lastInsertRowid) });
  });

  app.put('/api/schedules/:id', (req, res) => {
    const cur = /** @type {any} */ (db.prepare('SELECT id FROM scheduled_jobs WHERE id=?').get(Number(req.params.id)));
    if (!cur) return bad(res, 'unknown schedule', 404);
    const b = req.body ?? {};
    if (typeof b.enabled === 'boolean') {
      db.prepare('UPDATE scheduled_jobs SET enabled=?, consecutive_failures=CASE WHEN ? THEN 0 ELSE consecutive_failures END WHERE id=?')
        .run(b.enabled ? 1 : 0, b.enabled ? 1 : 0, Number(req.params.id));
    }
    ok(res, { updated: Number(req.params.id) });
  });

  app.delete('/api/schedules/:id', (req, res) => {
    db.prepare('DELETE FROM scheduled_jobs WHERE id=?').run(Number(req.params.id));
    ok(res, { deleted: Number(req.params.id) });
  });

  // Run a schedule immediately (ignores cadence; counts as its last run).
  app.post('/api/schedules/:id/run', (req, res) => {
    const row = /** @type {any} */ (db.prepare('SELECT * FROM scheduled_jobs WHERE id=?').get(Number(req.params.id)));
    if (!row) return bad(res, 'unknown schedule', 404);
    try {
      const projectId = /** @type {any} */ (db.prepare('SELECT id FROM projects WHERE path=?').get(row.project_path))?.id ?? null;
      const { jobId } = jobs.launch({
        projectId,
        projectPath: row.project_path,
        prompt: row.prompt,
        model: row.model,
        maxTurns: row.max_turns ?? 15,
        permissionMode: row.permission_mode ?? 'default',
      });
      db.prepare("UPDATE scheduled_jobs SET last_run_at=?, last_job_id=?, last_status='launched' WHERE id=?").run(Date.now(), jobId, row.id);
      ok(res, { jobId });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e));
    }
  });
}
