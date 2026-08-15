// Cloud Routines (claude.ai scheduled agents) bridge. There is no public REST
// surface Pulse can hit directly — the RemoteTrigger API authenticates
// in-process inside Claude Code — so every operation shells out to a headless
// `claude -p` session that calls the tool and prints raw JSON. Slow (~20-60s)
// and quota-bearing, so list results are cached and refreshes are explicit.
import { runClaude } from './llm.js';
import { safeJsonParse } from './util.js';
import { log } from './logger.js';

const OPTS = { model: 'claude-sonnet-5', maxTurns: 6, timeoutMs: 150_000 };

/** Ask a headless session to make one RemoteTrigger call and print raw JSON. */
async function remoteTrigger(action, extra = '') {
  const out = await runClaude(
    'Load the RemoteTrigger tool via ToolSearch (query select:RemoteTrigger), then call RemoteTrigger with ' +
      `${action}. Print ONLY the raw JSON response from the tool — no commentary, no markdown fences.${extra}`,
    OPTS
  );
  // tolerate stray text/fences around the JSON
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  const parsed = start >= 0 && end > start ? safeJsonParse(out.slice(start, end + 1)) : null;
  if (!parsed) throw new Error(`could not parse RemoteTrigger response: ${out.slice(0, 120)}`);
  return parsed;
}

const normalize = (t) => ({
  id: t.id,
  name: t.name ?? t.id,
  cron: t.cron_expression || null,
  runOnceAt: t.run_once_at || null,
  enabled: !!t.enabled,
  endedReason: t.ended_reason || null,
  lastFiredAt: t.last_fired_at ? Date.parse(t.last_fired_at) : null,
  nextRunAt: t.next_run_at ? Date.parse(t.next_run_at) : null,
  createdVia: t.created_via ?? null,
  prompt: (t.job_config?.ccr?.events?.[0]?.data?.message?.content ?? '').slice(0, 400),
});

export function createRoutinesBridge() {
  let cache = { at: 0, routines: /** @type {any[]|null} */ (null) };
  let inflight = /** @type {Promise<any[]>|null} */ (null);

  async function list(force = false) {
    if (!force && cache.routines && Date.now() - cache.at < 10 * 60_000) return cache.routines;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const j = await remoteTrigger('{"action":"list"}');
        const routines = (j.data ?? []).map(normalize);
        cache = { at: Date.now(), routines };
        log.info(`routines: refreshed ${routines.length} from claude.ai`);
        return routines;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function runNow(id) {
    const j = await remoteTrigger(`{"action":"run","trigger_id":"${id}"}`);
    cache.at = 0;
    return j;
  }

  async function setEnabled(id, enabled) {
    const j = await remoteTrigger(`{"action":"update","trigger_id":"${id}","body":{"enabled":${enabled ? 'true' : 'false'}}}`);
    cache.at = 0;
    return j;
  }

  /**
   * @param {{ name: string, prompt: string, cron?: string|null, runOnceAt?: string|null,
   *           environmentId: string, model?: string, repoUrl?: string|null }} r
   */
  async function create(r) {
    const { randomUUID } = await import('node:crypto');
    const body = {
      name: r.name,
      enabled: true,
      ...(r.cron ? { cron_expression: r.cron } : { run_once_at: r.runOnceAt }),
      job_config: {
        ccr: {
          environment_id: r.environmentId,
          session_context: {
            model: r.model || 'claude-sonnet-5',
            ...(r.repoUrl ? { sources: [{ git_repository: { url: r.repoUrl } }] } : {}),
            allowed_tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
          },
          events: [
            {
              data: {
                uuid: randomUUID(),
                session_id: '',
                type: 'user',
                parent_tool_use_id: null,
                message: { content: r.prompt, role: 'user' },
              },
            },
          ],
        },
      },
    };
    const j = await remoteTrigger(`{"action":"create","body":${JSON.stringify(body)}}`);
    cache.at = 0;
    return { id: j.id ?? j.data?.id ?? null, raw: j };
  }

  return { list, runNow, setEnabled, create, get cachedAt() { return cache.at; } };
}

// Cloud environments the create form offers. The harness injects these into
// /schedule sessions; there is no discovery API Pulse can call, so this list
// is a snapshot (2026-08-14) — update via the constant below when it changes.
export const CLOUD_ENVIRONMENTS = [
  { id: 'env_016MdUb4xBmGgCWdmwJhThCf', name: 'Default' },
  { id: 'env_012PNXSpbj6VfvX8FdfHv9ca', name: 'ChargeOps2' },
  { id: 'env_01MBH4ws6pH3DgGnPAhKVJiq', name: 'ChargeOps Website' },
  { id: 'env_01GzpGqWVF9k4Lngf6DusBGK', name: 'ChargeOps' },
  { id: 'env_01HrwrYDojapY12suDy61W6T', name: 'Prospector' },
  { id: 'env_01RFgtf9kbx7Hxwu2iHdqFf2', name: 'Environnement Cloud par défaut' },
];
