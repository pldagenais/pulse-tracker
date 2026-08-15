// Alert rules engine: evaluates a fixed rule set every 5 minutes against data
// the server already computes, records fired alerts (bell drawer), pushes them
// over SSE, and dispatches enabled outbound webhooks. Per-rule dedupe keys
// keep alert fatigue down: daily rules fire once per local day, per-entity
// rules once per entity ever.
import { getSetting } from './db.js';
import { dayBounds, todayKey } from './util.js';
import { log } from './logger.js';

const TICK_MS = 5 * 60_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ onAlert?: (alert: any) => void }} [opts]
 */
export function createAlertEngine(db, { onAlert = () => {} } = {}) {
  const S = {
    exists: db.prepare('SELECT 1 x FROM alerts WHERE rule=? AND ts>=? LIMIT 1'),
    existsEver: db.prepare('SELECT 1 x FROM alerts WHERE rule=? LIMIT 1'),
    ins: db.prepare('INSERT INTO alerts(ts, rule, message) VALUES(?,?,?)'),
    prune: db.prepare('DELETE FROM alerts WHERE id <= (SELECT COALESCE(MAX(id),0) FROM alerts) - 500'),
    hooks: db.prepare('SELECT * FROM webhooks WHERE enabled=1'),
    hookResult: db.prepare('UPDATE webhooks SET last_fired_at=?, last_status=? WHERE id=?'),
  };

  function fire(rule, message, { daily = false } = {}) {
    const guardTs = daily ? dayBounds(todayKey())[0] : 0;
    if (daily ? S.exists.get(rule, guardTs) : S.existsEver.get(rule)) return false;
    const ts = Date.now();
    const id = Number(S.ins.run(ts, rule, message).lastInsertRowid);
    S.prune.run();
    const alert = { id, ts, rule, message };
    log.info(`alert: [${rule}] ${message}`);
    onAlert(alert);
    dispatchWebhooks(alert);
    return true;
  }

  async function dispatchWebhooks(alert) {
    let hooks;
    try {
      hooks = /** @type {any[]} */ (S.hooks.all());
    } catch {
      return;
    }
    const family = alert.rule.split(':')[0];
    for (const h of hooks) {
      let filter = [];
      try { filter = JSON.parse(h.events || '[]'); } catch { /* treat as all */ }
      if (filter.length && !filter.includes(family)) continue;
      try {
        const r = await fetch(h.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'pulse', rule: alert.rule, message: alert.message, ts: alert.ts }),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        S.hookResult.run(Date.now(), `HTTP ${r.status}`, h.id);
      } catch (e) {
        S.hookResult.run(Date.now(), (e instanceof Error ? e.message : String(e)).slice(0, 80), h.id);
      }
    }
  }

  function tick() {
    try {
      const today = todayKey();
      const [a, b] = dayBounds(today);
      const num = (key) => Number(getSetting(db, key, '')) || null;

      // 1. daily est. cost threshold
      const dailyCap = num('alert_daily_cost_usd');
      if (dailyCap) {
        const cost = /** @type {any} */ (db.prepare('SELECT coalesce(sum(est_cost_usd),0) c FROM turns WHERE started_at>=? AND started_at<?').get(a, b)).c;
        if (cost >= dailyCap) {
          fire(`daily-cost:${today}`, `Today's est. cost hit $${cost.toFixed(0)} (your alert threshold is $${dailyCap}).`, { daily: true });
        }
      }

      // 2. single-session cost threshold (per session, once ever)
      const sessCap = num('alert_session_cost_usd');
      if (sessCap) {
        const rows = db.prepare('SELECT id, title, last_prompt, est_cost_usd FROM sessions WHERE est_cost_usd>=? AND last_event_at>=?').all(sessCap, a);
        for (const s of /** @type {any[]} */ (rows)) {
          fire(`session-cost:${s.id}`, `Session “${(s.title ?? s.last_prompt ?? s.id).slice(0, 60)}” passed $${Math.round(s.est_cost_usd)} est.`);
        }
      }

      // 3. monthly budget pace (needs the existing monthly budget setting)
      const budget = num('monthly_budget_usd');
      if (budget) {
        const [ms] = dayBounds(`${today.slice(0, 7)}-01`);
        const mtd = /** @type {any} */ (db.prepare('SELECT coalesce(sum(est_cost_usd),0) c FROM turns WHERE started_at>=?').get(ms)).c;
        if (mtd >= budget) {
          fire(`budget-blown:${today.slice(0, 7)}`, `Month-to-date est. cost ($${mtd.toFixed(0)}) has passed your $${budget} budget.`);
        }
      }

      // 4. parse-failure spike (transcript schema drift early warning)
      const spikes = /** @type {any} */ (db.prepare('SELECT count(*) c FROM parse_failures WHERE ts>?').get(Date.now() - 24 * 3600_000)).c;
      if (spikes > 20) {
        fire(`parse-spike:${today}`, `${spikes} transcript parse failures in 24h — a Claude Code update may have changed the format.`, { daily: true });
      }

      // 5. failed headless jobs (per job, once)
      for (const j of /** @type {any[]} */ (db.prepare("SELECT id, prompt FROM pulse_jobs WHERE status='error' AND ended_at>=?").all(Date.now() - 24 * 3600_000))) {
        fire(`job-failed:${j.id}`, `Headless job #${j.id} failed: “${j.prompt.replace(/\s+/g, ' ').slice(0, 60)}”.`);
      }
    } catch (e) {
      log.warn('alert tick failed:', e instanceof Error ? e.message : String(e));
    }
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  setTimeout(tick, 20_000).unref(); // first pass shortly after boot

  return { tick, fire };
}
