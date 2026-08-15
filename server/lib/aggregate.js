import { getSetting } from './db.js';
import { DEFAULT_IDLE_THRESHOLD_MIN, DEFAULT_STALL_CAP_MIN } from '../config.js';
import { estimateCost } from './pricing.js';

export function timingSettings(db) {
  return {
    idleMs: Number(getSetting(db, 'idle_threshold_min', DEFAULT_IDLE_THRESHOLD_MIN)) * 60_000,
    capMs: Number(getSetting(db, 'stall_cap_min', DEFAULT_STALL_CAP_MIN)) * 60_000,
  };
}

function prepare(db) {
  return {
    selEvents: db.prepare(
      `SELECT uuid, ts, kind, usage_credited, input_tokens, output_tokens, cache_read_tokens,
              cache_create_5m, cache_create_1h, tool_use_count, model
         FROM events WHERE session_id=? ORDER BY ts, uuid`
    ),
    selAgents: db.prepare('SELECT * FROM agent_runs WHERE session_id=?'),
    delTurns: db.prepare('DELETE FROM turns WHERE session_id=?'),
    insTurn: db.prepare(
      `INSERT INTO turns(session_id, prompt_uuid, started_at, ended_at, claude_ms, event_count,
                         tool_use_count, input_tokens, output_tokens, cache_read_tokens,
                         cache_create_tokens, est_cost_usd)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    ),
    updAgentCost: db.prepare('UPDATE agent_runs SET est_cost_usd=? WHERE agent_id=?'),
    updSession: db.prepare(
      `UPDATE sessions SET
         started_at=?, last_event_at=?,
         ended_at=CASE WHEN ended_at IS NOT NULL AND ended_at < ? THEN NULL ELSE ended_at END,
         prompt_count=?, turn_count=?, claude_ms=?, user_active_ms=?,
         input_tokens=?, output_tokens=?, cache_read_tokens=?,
         cache_create_5m_tokens=?, cache_create_1h_tokens=?,
         est_cost_usd=?, has_unpriced_tokens=?,
         tool_use_count=?, subagent_count=?, subagent_ms=?, models=?
       WHERE id=?`
    ),
    updProject: db.prepare(
      `UPDATE projects SET
         first_seen=CASE WHEN first_seen IS NULL OR ? < first_seen THEN ? ELSE first_seen END,
         last_seen=CASE WHEN last_seen IS NULL OR ? > last_seen THEN ? ELSE last_seen END
       WHERE id=(SELECT project_id FROM sessions WHERE id=?)`
    ),
  };
}

/**
 * Rebuild turns + aggregates for the given sessions from the slim events table.
 * Idempotent; safe to call repeatedly.
 */
export function recomputeSessions(db, sessionIds) {
  const t = timingSettings(db);
  const S = prepare(db);
  for (const sid of sessionIds) recomputeSession(db, sid, t, S);
}

export function recomputeAll(db) {
  const ids = db.prepare('SELECT id FROM sessions').all().map((r) => r.id);
  recomputeSessions(db, ids);
  return ids.length;
}

function recomputeSession(db, sid, { idleMs, capMs }, S) {
  const events = S.selEvents.all(sid);
  const agents = S.selAgents.all(sid);
  S.delTurns.run(sid);

  const models = new Set();
  let toolUseTotal = 0;
  const promptIdx = [];
  events.forEach((e, i) => {
    if (e.model) models.add(e.model);
    toolUseTotal += e.tool_use_count || 0;
    if (e.kind === 'prompt' || e.kind === 'command') promptIdx.push(i);
  });

  // ---- turns (claude working time) ----
  const turns = [];
  let claudeTotal = 0;
  for (let k = 0; k < promptIdx.length; k++) {
    const s = promptIdx[k];
    const e = k + 1 < promptIdx.length ? promptIdx[k + 1] - 1 : events.length - 1;
    let claudeMs = 0;
    let claudeEnd = events[s].ts;
    for (let i = s; i < e; i++) {
      // A gap counts as "Claude working" only when it leads up to actual model
      // output or a tool result. Gaps ending in system/attachment noise (hook
      // pings, task reminders that keep firing while a session sits open
      // overnight, hook events fired just before the NEXT prompt) are not work —
      // without this filter a session left open for days accumulates phantom
      // hours, and the user's own reading time would vanish into the turn.
      const nxt = events[i + 1];
      if (nxt.kind !== 'assistant' && nxt.kind !== 'tool_result') continue;
      claudeMs += Math.min(Math.max(nxt.ts - events[i].ts, 0), capMs);
      claudeEnd = nxt.ts;
    }
    let tin = 0, tout = 0, tcr = 0, tc5 = 0, tc1 = 0, ttools = 0, tcost = 0;
    for (let i = s; i <= e; i++) {
      const ev = events[i];
      ttools += ev.tool_use_count || 0;
      if (ev.usage_credited) {
        tin += ev.input_tokens || 0;
        tout += ev.output_tokens || 0;
        tcr += ev.cache_read_tokens || 0;
        tc5 += ev.cache_create_5m || 0;
        tc1 += ev.cache_create_1h || 0;
        const c = estimateCost(ev.model, {
          input: ev.input_tokens || 0,
          output: ev.output_tokens || 0,
          cacheRead: ev.cache_read_tokens || 0,
          cache5m: ev.cache_create_5m || 0,
          cache1h: ev.cache_create_1h || 0,
        });
        if (c.cost != null) tcost += c.cost;
      }
    }
    claudeMs = Math.round(claudeMs);
    // The turn ends at Claude's last real output — not at trailing noise events.
    // This makes gantt blocks honest AND lets the review gap before the next
    // prompt (claudeEnd -> next prompt ts) be measured as user-active time.
    S.insTurn.run(sid, events[s].uuid, events[s].ts, claudeEnd, claudeMs, e - s + 1,
      ttools, tin, tout, tcr, tc5 + tc1, tcost);
    turns.push({ start: events[s].ts, end: claudeEnd });
    claudeTotal += claudeMs;
  }

  // ---- your active time (review gaps between turns, capped by idle threshold) ----
  let userActive = 0;
  if (turns.length && events.length) {
    const leadIn = turns[0].start - events[0].ts;
    if (leadIn > 0 && leadIn <= idleMs) userActive += leadIn;
    for (let k = 0; k + 1 < turns.length; k++) {
      const gap = turns[k + 1].start - turns[k].end;
      if (gap > 0 && gap <= idleMs) userActive += gap;
    }
  }

  // ---- session token/cost totals: ALL credited events (incl. any outside turn ranges) ----
  const tok = { in: 0, out: 0, cr: 0, c5: 0, c1: 0 };
  let cost = 0;
  let unpriced = 0;
  for (const ev of events) {
    if (!ev.usage_credited) continue;
    tok.in += ev.input_tokens || 0;
    tok.out += ev.output_tokens || 0;
    tok.cr += ev.cache_read_tokens || 0;
    tok.c5 += ev.cache_create_5m || 0;
    tok.c1 += ev.cache_create_1h || 0;
    const c = estimateCost(ev.model, {
      input: ev.input_tokens || 0, output: ev.output_tokens || 0, cacheRead: ev.cache_read_tokens || 0,
      cache5m: ev.cache_create_5m || 0, cache1h: ev.cache_create_1h || 0,
    });
    if (c.cost != null) cost += c.cost;
    else unpriced = 1;
  }

  // ---- subagents: tokens/cost roll into the session; time tracked separately ----
  let agentMs = 0;
  for (const a of agents) {
    if (a.resolved_model) models.add(a.resolved_model);
    const dur = a.duration_ms != null
      ? a.duration_ms
      : a.first_ts != null && a.last_ts != null ? a.last_ts - a.first_ts : 0;
    agentMs += Math.max(dur || 0, 0);
    const c = estimateCost(a.resolved_model, {
      input: a.input_tokens || 0, output: a.output_tokens || 0, cacheRead: a.cache_read_tokens || 0,
      cache5m: a.cache_create_5m_tokens || 0, cache1h: a.cache_create_1h_tokens || 0,
    });
    S.updAgentCost.run(c.cost, a.agent_id);
    const hasTokens = (a.input_tokens || 0) + (a.output_tokens || 0) > 0;
    if (c.cost != null) cost += c.cost;
    else if (hasTokens) unpriced = 1;
    tok.in += a.input_tokens || 0;
    tok.out += a.output_tokens || 0;
    tok.cr += a.cache_read_tokens || 0;
    tok.c5 += a.cache_create_5m_tokens || 0;
    tok.c1 += a.cache_create_1h_tokens || 0;
  }

  const startedAt = events.length ? events[0].ts : null;
  const lastEventAt = events.length ? events[events.length - 1].ts : null;
  const anyTokens = tok.in + tok.out + tok.cr + tok.c5 + tok.c1 > 0;

  S.updSession.run(
    startedAt, lastEventAt, lastEventAt ?? 0,
    promptIdx.length, turns.length, claudeTotal, Math.round(userActive),
    tok.in, tok.out, tok.cr, tok.c5, tok.c1,
    anyTokens ? cost : null, unpriced,
    toolUseTotal, agents.length, Math.round(agentMs),
    JSON.stringify([...models].sort()),
    sid
  );
  if (startedAt != null) {
    S.updProject.run(startedAt, startedAt, lastEventAt, lastEventAt, sid);
  }
}
