// Cloud Routines endpoints. Every operation runs a headless claude -p session
// under the hood (20-60s) — the UI warns accordingly. Deletion is not exposed
// by the API at all; users are pointed at https://claude.ai/code/routines.
import { CLOUD_ENVIRONMENTS } from '../lib/routines.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

const CRON_RE = /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$/;
const ID_RE = /^trig_[\w-]+$/;

export function mountRoutines(app, ctx) {
  const { routines } = ctx;

  app.get('/api/routines', async (req, res) => {
    try {
      const list = await routines.list(req.query.refresh === '1');
      ok(res, { routines: list, cachedAt: routines.cachedAt, environments: CLOUD_ENVIRONMENTS });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });

  app.post('/api/routines/:id/run', async (req, res) => {
    if (!ID_RE.test(req.params.id)) return bad(res, 'invalid routine id');
    try {
      await routines.runNow(req.params.id);
      ok(res, { ran: req.params.id });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });

  app.put('/api/routines/:id', async (req, res) => {
    if (!ID_RE.test(req.params.id)) return bad(res, 'invalid routine id');
    if (typeof req.body?.enabled !== 'boolean') return bad(res, 'enabled boolean required');
    try {
      await routines.setEnabled(req.params.id, req.body.enabled);
      ok(res, { updated: req.params.id });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });

  app.post('/api/routines', async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim().slice(0, 80);
    const prompt = String(b.prompt ?? '').trim().slice(0, 8000);
    const environmentId = String(b.environmentId ?? '');
    if (!name || !prompt) return bad(res, 'name and prompt are required');
    if (!CLOUD_ENVIRONMENTS.some((e) => e.id === environmentId)) return bad(res, 'unknown environment');
    const cron = b.cron ? String(b.cron).trim() : null;
    const runOnceAt = b.runOnceAt ? String(b.runOnceAt) : null;
    if (!cron && !runOnceAt) return bad(res, 'either a cron expression or a one-time UTC timestamp is required');
    if (cron && !CRON_RE.test(cron)) return bad(res, 'cron must be a 5-field expression (UTC, min interval 1h)');
    if (runOnceAt && (Number.isNaN(Date.parse(runOnceAt)) || Date.parse(runOnceAt) < Date.now())) {
      return bad(res, 'one-time run must be a valid future UTC timestamp');
    }
    try {
      const r = await routines.create({
        name, prompt, cron, runOnceAt, environmentId,
        model: typeof b.model === 'string' ? b.model : undefined,
        repoUrl: b.repoUrl && /^https:\/\/github\.com\//.test(String(b.repoUrl)) ? String(b.repoUrl) : null,
      });
      ok(res, { id: r.id, url: r.id ? `https://claude.ai/code/routines/${r.id}` : null });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });
}
