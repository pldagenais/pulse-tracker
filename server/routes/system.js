import fs from 'node:fs';
import path from 'node:path';
import { APP_NAME, APP_VERSION, PORT, CLAUDE_DIR, DATA_DIR, DB_PATH } from '../config.js';
import { getSetting, setSetting } from '../lib/db.js';
import { DEFAULT_IDLE_THRESHOLD_MIN, DEFAULT_STALL_CAP_MIN } from '../config.js';
import { recomputeAll } from '../lib/aggregate.js';
import { rangeDaily, firstActivityDay } from '../lib/stats.js';
import { csvEscape, todayKey, addDays, safeJsonParse } from '../lib/util.js';
import { log } from '../lib/logger.js';
import {
  resolveAccount, recordSessionAccount, setSessionAccount, listAccounts, readPlanUsage, syncAccounts,
} from '../lib/accounts.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const bootTime = Date.now();

// The report summarizer's own claude -p children run from data/llm and fire
// the global hooks — their events must not appear as live sessions/activity.
const LLM_CWD = path.join(DATA_DIR, 'llm').toLowerCase();

export function mountSystem(app, ctx) {
  const { db, sse, live, ingester, watcherState } = ctx;

  // Debounced targeted ingest per transcript path (hooks fire before CC flushes).
  /** @type {Map<string, NodeJS.Timeout>} */
  const pendingIngest = new Map();
  const scheduleIngest = (p) => {
    clearTimeout(pendingIngest.get(p));
    pendingIngest.set(p, setTimeout(() => {
      pendingIngest.delete(p);
      ingester.enqueuePath(p);
    }, 500));
  };

  app.post('/api/hook', (req, res) => {
    res.status(204).end(); // always succeed — never make hooks wait
    try {
      const b = req.body;
      if (!b || typeof b !== 'object' || typeof b.hook_event_name !== 'string') return;
      if (typeof b.cwd === 'string' && path.normalize(b.cwd).toLowerCase() === LLM_CWD) return;
      db.prepare('INSERT INTO hook_events(ts, event, session_id, cwd, payload) VALUES(?,?,?,?,?)').run(
        Date.now(), b.hook_event_name, b.session_id ?? null, b.cwd ?? null,
        JSON.stringify({
          prompt: typeof b.prompt === 'string' ? b.prompt.slice(0, 500) : undefined,
          source: b.source,
          reason: b.reason,
          // keep the raw marker so attribution stays auditable after the fact
          userDataDir: b._tracker?.userDataDir ?? undefined,
        })
      );
      // Which subscription is this? The hook env is the only signal that says
      // so — transcripts carry no account identity. First write wins.
      if (b.session_id) {
        const acct = resolveAccount(db, b._tracker);
        if (acct) recordSessionAccount(db, b.session_id, acct);
      }
      live.onHook(b);
      if (typeof b.transcript_path === 'string' && b.transcript_path.endsWith('.jsonl')) {
        scheduleIngest(b.transcript_path);
      }
      sse.broadcast('hook', { event: b.hook_event_name, sessionId: b.session_id ?? null });
    } catch (e) {
      log.warn('hook handling failed:', e.message);
    }
  });

  app.get('/api/live', (req, res) => {
    sse.handler(req, res, { live: live.snapshot(), ingest: ingester.progress });
  });

  const backupInfo = () => {
    try {
      const dir = path.join(DATA_DIR, 'backups');
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('tracker-') && f.endsWith('.db')).sort();
      if (!files.length) return { count: 0, latestAt: null, latestSizeBytes: null };
      const latest = files[files.length - 1];
      const st = fs.statSync(path.join(dir, latest));
      return { count: files.length, latestAt: st.mtimeMs, latestSizeBytes: st.size };
    } catch {
      return { count: 0, latestAt: null, latestSizeBytes: null };
    }
  };

  // Max-plan pressure: trailing 5-hour and 7-day consumption (Claude's rate
  // windows are rolling). Ceilings are user-estimated (Anthropic doesn't
  // publish exact quotas) — set via settings, blank = just show consumption.
  app.get('/api/usage-window', (req, res) => {
    const now = Date.now();
    /** @param {number} since @param {string} [acct] scope to one subscription */
    const win = (since, acct) => {
      const t = /** @type {any} */ (acct
        ? db.prepare(
          `SELECT coalesce(sum(t.est_cost_usd),0) cost, coalesce(sum(t.output_tokens),0) outTok, count(*) turns
             FROM turns t JOIN session_accounts sa ON sa.session_id=t.session_id
            WHERE t.started_at>? AND sa.account_uuid=?`
        ).get(since, acct)
        : db.prepare(
          'SELECT coalesce(sum(est_cost_usd),0) cost, coalesce(sum(output_tokens),0) outTok, count(*) turns FROM turns WHERE started_at>?'
        ).get(since));
      const p = /** @type {any} */ (acct
        ? db.prepare(
          `SELECT count(*) c FROM prompts p JOIN session_accounts sa ON sa.session_id=p.session_id
            WHERE p.ts>? AND sa.account_uuid=? AND p.kind IN ('typed','command')`
        ).get(since, acct)
        : db.prepare("SELECT count(*) c FROM prompts WHERE ts>? AND kind IN ('typed','command')").get(since));
      return { estCostUsd: t.cost, outputTokens: t.outTok, turns: t.turns, prompts: p.c };
    };
    const h5 = win(now - 5 * 3600_000);
    const d7 = win(now - 7 * 24 * 3600_000);

    // Two subscriptions have two independent rolling quotas, so a single
    // combined figure overstates the pressure on each. Prefer the real
    // percentages the desktop app records; fall back to our cost estimate.
    const planUsage = readPlanUsage(db);
    const byAccount = listAccounts(db).map((a) => ({
      accountUuid: a.uuid,
      name: a.name,
      isDefault: a.isDefault,
      window5h: win(now - 5 * 3600_000, a.uuid),
      window7d: win(now - 7 * 24 * 3600_000, a.uuid),
      planUsage: planUsage.find((u) => u.accountUuid === a.uuid) ?? null,
    }));
    // Turns we could not attribute — say so rather than let the split silently
    // fail to add up to the combined total.
    const unattributed = /** @type {any} */ (db.prepare(
      `SELECT count(*) c FROM turns t LEFT JOIN session_accounts sa ON sa.session_id=t.session_id
        WHERE t.started_at>? AND sa.session_id IS NULL`
    ).get(now - 7 * 24 * 3600_000));
    // oldest turn inside the 5h window tells when pressure starts easing
    const oldest = /** @type {any} */ (db.prepare('SELECT min(started_at) t FROM turns WHERE started_at>?').get(now - 5 * 3600_000));
    // live burn: credited output tokens over the trailing 15 minutes
    const burn = /** @type {any} */ (db.prepare(
      'SELECT coalesce(sum(output_tokens),0) o FROM events WHERE ts>? AND usage_credited=1'
    ).get(now - 15 * 60_000));
    ok(res, {
      window5h: h5,
      window7d: d7,
      easesAt: oldest?.t ? oldest.t + 5 * 3600_000 : null,
      burnTokPerMin: Math.round(burn.o / 15),
      ceiling5hUsd: Number(getSetting(db, 'window5h_budget_usd', '')) || null,
      ceiling7dUsd: Number(getSetting(db, 'window7d_budget_usd', '')) || null,
      byAccount,
      unattributedTurns7d: unattributed.c,
    });
  });

  /* ── accounts (two subscriptions on one machine) ──────────────────── */

  app.get('/api/accounts', (req, res) => {
    const usage = readPlanUsage(db);
    // Join through sessions: attribution outlives a reingest (by design), so
    // rows can point at sessions the rebuild no longer produced. Counting
    // those would overstate the per-account totals.
    const counts = db.prepare(
      `SELECT sa.account_uuid, count(*) c FROM session_accounts sa
         JOIN sessions s ON s.id=sa.session_id GROUP BY sa.account_uuid`
    ).all();
    ok(res, {
      accounts: listAccounts(db).map((a) => ({
        ...a,
        sessions: Number(counts.find((c) => c.account_uuid === a.uuid)?.c ?? 0),
        planUsage: usage.find((u) => u.accountUuid === a.uuid) ?? null,
      })),
      // A terminal CLI shares one credential store, so only the user knows
      // which account it is signed into.
      cliAccountUuid: getSetting(db, 'cli_account_uuid', '') || null,
      unattributedSessions: /** @type {any} */ (db.prepare(
        'SELECT count(*) c FROM sessions s LEFT JOIN session_accounts sa ON sa.session_id=s.id WHERE sa.session_id IS NULL'
      ).get()).c,
    });
  });

  app.get('/api/plan-usage', (req, res) => {
    syncAccounts(db); // cheap (mtime-cached) and picks up a profile added since boot
    ok(res, readPlanUsage(db));
  });

  app.put('/api/accounts/:uuid', (req, res) => {
    const uuid = String(req.params.uuid);
    const exists = db.prepare('SELECT 1 FROM accounts WHERE uuid=?').get(uuid);
    if (!exists) return bad(res, 'unknown account', 404);
    const label = req.body?.label;
    if (label !== undefined) {
      const clean = String(label).trim().slice(0, 60);
      db.prepare('UPDATE accounts SET label=? WHERE uuid=?').run(clean || null, uuid);
    }
    ok(res, listAccounts(db).find((a) => a.uuid === uuid) ?? null);
  });

  app.put('/api/accounts/cli/current', (req, res) => {
    const uuid = req.body?.accountUuid;
    if (uuid === null || uuid === undefined || uuid === '') {
      setSetting(db, 'cli_account_uuid', '');
      return ok(res, { cliAccountUuid: null });
    }
    const clean = String(uuid);
    if (!db.prepare('SELECT 1 FROM accounts WHERE uuid=?').get(clean)) return bad(res, 'unknown account', 404);
    setSetting(db, 'cli_account_uuid', clean);
    ok(res, { cliAccountUuid: clean });
  });

  app.put('/api/sessions/:id/account', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT 1 FROM sessions WHERE id=?').get(id)) return bad(res, 'unknown session', 404);
    const uuid = String(req.body?.accountUuid ?? '');
    if (!db.prepare('SELECT 1 FROM accounts WHERE uuid=?').get(uuid)) return bad(res, 'unknown account', 404);
    setSessionAccount(db, id, uuid);
    sse.broadcast('data-changed', { sessions: [id] });
    ok(res, { sessionId: id, accountUuid: uuid, source: 'manual' });
  });

  /* ── alerts (bell drawer) + outbound webhooks ─────────────────────── */
  app.get('/api/alerts', (req, res) => {
    const rows = db.prepare('SELECT id, ts, rule, message, acked FROM alerts ORDER BY id DESC LIMIT 50').all();
    const unacked = /** @type {any} */ (db.prepare('SELECT count(*) c FROM alerts WHERE acked=0').get()).c;
    ok(res, { unacked, alerts: rows.map((r) => ({ id: r.id, ts: r.ts, rule: r.rule, message: r.message, acked: !!r.acked })) });
  });

  app.post('/api/alerts/ack', (req, res) => {
    if (req.body?.all) db.prepare('UPDATE alerts SET acked=1 WHERE acked=0').run();
    else if (Array.isArray(req.body?.ids)) {
      const upd = db.prepare('UPDATE alerts SET acked=1 WHERE id=?');
      for (const id of req.body.ids) upd.run(Number(id));
    }
    ok(res, { acked: true });
  });

  app.get('/api/webhooks', (req, res) => {
    ok(res, db.prepare('SELECT * FROM webhooks ORDER BY id').all().map((r) => ({
      id: r.id, url: r.url, events: safeJsonParse(r.events) ?? [], enabled: !!r.enabled,
      lastFiredAt: r.last_fired_at, lastStatus: r.last_status,
    })));
  });

  app.post('/api/webhooks', (req, res) => {
    const url = String(req.body?.url ?? '').trim();
    if (!/^https?:\/\/.+/i.test(url)) return bad(res, 'url must start with http(s)://');
    const events = Array.isArray(req.body?.events) ? req.body.events.map((e) => String(e).slice(0, 30)).slice(0, 10) : [];
    const r = db.prepare('INSERT INTO webhooks(url, events, enabled, created_at) VALUES(?,?,1,?)').run(url.slice(0, 500), JSON.stringify(events), Date.now());
    ok(res, { id: Number(r.lastInsertRowid) });
  });

  app.put('/api/webhooks/:id', (req, res) => {
    if (typeof req.body?.enabled === 'boolean') {
      db.prepare('UPDATE webhooks SET enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, Number(req.params.id));
    }
    ok(res, { updated: Number(req.params.id) });
  });

  app.delete('/api/webhooks/:id', (req, res) => {
    db.prepare('DELETE FROM webhooks WHERE id=?').run(Number(req.params.id));
    ok(res, { deleted: Number(req.params.id) });
  });

  // Parse-failure inbox: recent rows + per-file rollup for the Status page.
  app.get('/api/parse-failures', (req, res) => {
    const recent = db.prepare('SELECT id, ts, file, reason, snippet FROM parse_failures ORDER BY id DESC LIMIT 100').all();
    const byFile = db.prepare('SELECT file, count(*) n, max(ts) last FROM parse_failures GROUP BY file ORDER BY last DESC LIMIT 40').all();
    ok(res, { recent, byFile });
  });

  app.post('/api/parse-failures/reparse', (req, res) => {
    const p = String(req.body?.path ?? '');
    const known = db.prepare('SELECT path FROM ingest_files WHERE path=?').get(p);
    if (!known) return bad(res, 'unknown transcript path', 404);
    db.prepare('DELETE FROM parse_failures WHERE file=?').run(p);
    ingester.reparseFile(p);
    ok(res, { reparsing: p });
  });

  // Cheap liveness probe. The cloud mirror answers the same path from the
  // agent heartbeat rather than the status snapshot; served here too so the
  // path means the same thing in both modes.
  app.get('/api/heartbeat', (req, res) => {
    ok(res, { lastHeartbeatAt: Date.now(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });

  app.get('/api/status', (req, res) => {
    const count = (t) => db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
    let dbSize = 0;
    try { dbSize = fs.statSync(DB_PATH).size; } catch { /* ignore */ }
    let hooksInstalled = false;
    try {
      hooksInstalled = fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8').includes('notify.mjs');
    } catch { /* ignore */ }
    const hookRows = db.prepare('SELECT event, max(ts) last, count(*) n FROM hook_events GROUP BY event').all();
    ok(res, {
      app: APP_NAME,
      version: APP_VERSION,
      port: PORT,
      uptimeMs: Date.now() - bootTime,
      claudeDir: CLAUDE_DIR,
      dataDir: DATA_DIR,
      db: {
        sizeBytes: dbSize,
        sessions: count('sessions'),
        events: count('events'),
        prompts: count('prompts'),
        turns: count('turns'),
        agentRuns: count('agent_runs'),
        journal: count('journal'),
        parseErrors: db.prepare('SELECT coalesce(sum(parse_errors),0) s FROM ingest_files').get().s,
        parseErrors24h: db.prepare('SELECT count(*) c FROM parse_failures WHERE ts>?').get(Date.now() - 24 * 3600_000).c,
      },
      backup: backupInfo(),
      ingest: ingester.progress,
      watcher: { watching: watcherState.watching, lastEventAt: watcherState.lastEventAt },
      hooks: {
        installed: hooksInstalled,
        lastSeenAt: hookRows.length ? Math.max(...hookRows.map((r) => r.last)) : null,
        byEvent: Object.fromEntries(hookRows.map((r) => [r.event, { last: r.last, count: r.n }])),
      },
      sseClients: sse.clientCount,
    });
  });

  app.get('/api/activity', (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.id, h.ts, h.event, h.session_id, h.cwd, h.payload, s.title, p.name project_name
           FROM hook_events h
           LEFT JOIN sessions s ON s.id = h.session_id
           LEFT JOIN projects p ON p.id = s.project_id
          ORDER BY h.ts DESC LIMIT 40`
      )
      .all()
      .map((r) => {
        const payload = safeJsonParse(r.payload ?? '') ?? {};
        return {
          id: r.id,
          ts: r.ts,
          event: r.event,
          sessionId: r.session_id,
          title: r.title,
          projectName: r.project_name ?? (r.cwd ? String(r.cwd).split(/[\\/]/).pop() : null),
          prompt: payload.prompt ?? null,
        };
      });
    ok(res, rows);
  });

  app.get('/api/settings', (req, res) => {
    const budget = getSetting(db, 'monthly_budget_usd', '');
    const w5 = getSetting(db, 'window5h_budget_usd', '');
    const ad = getSetting(db, 'alert_daily_cost_usd', '');
    const as = getSetting(db, 'alert_session_cost_usd', '');
    ok(res, {
      idleThresholdMin: Number(getSetting(db, 'idle_threshold_min', DEFAULT_IDLE_THRESHOLD_MIN)),
      stallCapMin: Number(getSetting(db, 'stall_cap_min', DEFAULT_STALL_CAP_MIN)),
      monthlyBudgetUsd: budget === '' ? null : Number(budget),
      window5hBudgetUsd: w5 === '' ? null : Number(w5),
      alertDailyCostUsd: ad === '' ? null : Number(ad),
      alertSessionCostUsd: as === '' ? null : Number(as),
      llmConfigDir: getSetting(db, 'llm_config_dir', '') || null,
      llmModel: getSetting(db, 'llm_model', 'claude-opus-5'),
    });
  });

  app.put('/api/settings', (req, res) => {
    const b = req.body ?? {};
    const idle = Number(b.idleThresholdMin);
    const cap = Number(b.stallCapMin);
    if (!Number.isFinite(idle) || idle < 1 || idle > 240) return bad(res, 'idleThresholdMin must be 1-240');
    if (!Number.isFinite(cap) || cap < 1 || cap > 240) return bad(res, 'stallCapMin must be 1-240');
    if (b.monthlyBudgetUsd === null || b.monthlyBudgetUsd === undefined || b.monthlyBudgetUsd === '') {
      setSetting(db, 'monthly_budget_usd', '');
    } else {
      const budget = Number(b.monthlyBudgetUsd);
      if (!Number.isFinite(budget) || budget < 0 || budget > 1_000_000) return bad(res, 'monthlyBudgetUsd must be 0-1000000');
      setSetting(db, 'monthly_budget_usd', String(budget));
    }
    const optionalUsd = (key, v) => {
      if (v === null || v === undefined || v === '') setSetting(db, key, '');
      else if (Number.isFinite(Number(v)) && Number(v) >= 0) setSetting(db, key, String(Number(v)));
    };
    optionalUsd('window5h_budget_usd', b.window5hBudgetUsd);
    optionalUsd('alert_daily_cost_usd', b.alertDailyCostUsd);
    optionalUsd('alert_session_cost_usd', b.alertSessionCostUsd);
    setSetting(db, 'idle_threshold_min', String(Math.round(idle)));
    setSetting(db, 'stall_cap_min', String(Math.round(cap)));
    if (b.llmConfigDir !== undefined) {
      setSetting(db, 'llm_config_dir', String(b.llmConfigDir ?? '').trim().slice(0, 400));
    }
    if (b.llmModel !== undefined) {
      const m = String(b.llmModel ?? '').trim();
      if (!/^[a-z0-9.-]{0,60}$/.test(m)) return bad(res, 'llmModel must be a model id');
      setSetting(db, 'llm_model', m || 'claude-opus-5');
    }
    ok(res, { recomputing: true });
    setImmediate(() => {
      try {
        const n = recomputeAll(db);
        log.info(`settings changed; recomputed ${n} sessions`);
        sse.broadcast('data-changed', { all: true });
      } catch (e) {
        log.error('recompute after settings change failed:', e);
      }
    });
  });

  app.post('/api/rescan', (req, res) => {
    ok(res, { started: true });
    ingester.scanAndIngest({ phase: 'rescan' }).catch((e) => log.error('rescan failed:', e));
  });

  app.get('/api/export', (req, res) => {
    const what = String(req.query.what ?? 'daily');
    const format = String(req.query.format ?? 'csv');
    const to = DAY_RE.test(String(req.query.to)) ? String(req.query.to) : todayKey();
    const from = DAY_RE.test(String(req.query.from)) ? String(req.query.from) : firstActivityDay(db);
    if (from > to) return res.status(400).json({ ok: false, error: 'from must be on or before to' });

    let rows;
    let columns;
    if (what === 'daily') {
      rows = rangeDaily(db, from, to);
      columns = ['date', 'claudeMs', 'userActiveMs', 'wallMs', 'subagentMs', 'prompts', 'turns', 'sessions', 'outputTokens', 'estCostUsd'];
    } else if (what === 'sessions') {
      rows = db
        .prepare(
          `SELECT s.id, p.name project, s.title, s.git_branch, s.started_at, s.last_event_at,
                  s.prompt_count, s.turn_count, s.claude_ms, s.user_active_ms, s.subagent_count,
                  s.subagent_ms, s.input_tokens, s.output_tokens, s.cache_read_tokens,
                  s.cache_create_5m_tokens + s.cache_create_1h_tokens cache_write_tokens,
                  s.est_cost_usd, s.models
             FROM sessions s JOIN projects p ON p.id=s.project_id ORDER BY s.started_at`
        )
        .all()
        .map((r) => ({ ...r, models: (safeJsonParse(r.models ?? '') ?? []).join(' ') }));
      columns = Object.keys(rows[0] ?? { id: 1 });
    } else if (what === 'prompts') {
      rows = db
        .prepare(
          `SELECT pr.ts, p.name project, pr.session_id, pr.kind, pr.command_name, pr.text
             FROM prompts pr LEFT JOIN projects p ON p.id=pr.project_id ORDER BY pr.ts`
        )
        .all();
      columns = ['ts', 'project', 'session_id', 'kind', 'command_name', 'text'];
    } else {
      return bad(res, `unknown export: ${what}`);
    }

    const stamp = todayKey();
    if (format === 'json') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('content-disposition', `attachment; filename="claude-tracker-${what}-${stamp}.json"`);
      return res.end(JSON.stringify(rows, null, 2));
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="claude-tracker-${what}-${stamp}.csv"`);
    res.write(columns.join(',') + '\r\n');
    for (const r of rows) {
      res.write(columns.map((c) => csvEscape(r[c])).join(',') + '\r\n');
    }
    res.end();
  });
}
