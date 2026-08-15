// In-memory live-session state. Hooks are ground truth (UserPromptSubmit ->
// working, Stop -> idle, SessionEnd -> closed); transcript file activity is the
// fallback signal for sessions without hook coverage.
import fs from 'node:fs';
import path from 'node:path';
import { SESSIONS_DIR, LIVE_FILE_ACTIVITY_MS } from '../config.js';

const FILE_DECAY_MS = 90_000; // file-signal "working" decays to idle after this
// Cloud/worktree sessions sync their transcripts in bursts — give them a much
// longer window before declaring them idle.
const CLOUD_FILE_DECAY_MS = 5 * 60_000;
const HOOK_WORKING_MAX_MS = 30 * 60_000; // safety: a working state can't outlive this without a Stop
// A "working" session whose transcript hasn't grown for this long is flagged
// as possibly stalled (permission prompt, hang) — distinct from stall_cap.
const STALL_FLAG_MS = 5 * 60_000;
// A needs-you state (permission prompt) holds until the user acts; expire it
// only after a long time so a missed prompt doesn't linger forever.
const NEEDS_YOU_MAX_MS = 4 * 3600_000;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ onChange?: (rows: any[]) => void }} [opts]
 */
export function createLiveMap(db, { onChange = () => {} } = {}) {
  /** @type {Map<string, {status:string, since:number, updatedAt:number, source:string, cwd:string|null, lastPrompt:string|null, cloud?:boolean, lastFileAt?:number, stalled?:boolean, notification?:string|null}>} */
  const map = new Map();

  // Coalesce broadcasts: every hook event and file change used to rebuild and
  // serialize the whole snapshot per event, on the thread that serves HTTP.
  // The FIRST event in a quiet period still emits immediately (the UI must
  // feel instant); a burst then collapses into one trailing emit that carries
  // final state. 250ms is imperceptible next to SSE + React batching.
  const BROADCAST_QUIET_MS = 250;
  let lastBroadcastAt = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let broadcastTimer = null;
  function broadcast() {
    if (broadcastTimer) return; // trailing emit already armed
    const sinceLast = Date.now() - lastBroadcastAt;
    if (sinceLast >= BROADCAST_QUIET_MS) {
      lastBroadcastAt = Date.now();
      onChange(snapshot());
      return;
    }
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      lastBroadcastAt = Date.now();
      onChange(snapshot());
    }, BROADCAST_QUIET_MS - sinceLast);
    broadcastTimer.unref?.();
  }

  const decay = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [sid, e] of map) {
      if (e.status === 'working') {
        const limit = e.source === 'file' ? (e.cloud ? CLOUD_FILE_DECAY_MS : FILE_DECAY_MS) : HOOK_WORKING_MAX_MS;
        if (now - e.updatedAt > limit) {
          e.status = 'idle';
          e.updatedAt = now;
          changed = true;
        }
      } else if (e.status === 'needs-you') {
        if (now - e.updatedAt > NEEDS_YOU_MAX_MS) {
          e.status = 'idle';
          e.updatedAt = now;
          changed = true;
        }
      } else if (now - e.updatedAt > 6 * 3600_000) {
        map.delete(sid);
        changed = true;
      }
    }
    // stalled flags can flip without any event arriving — recheck each tick
    for (const [, e] of map) {
      const stalled = e.status === 'working' && e.source === 'hook' && !e.cloud &&
        now - Math.max(e.since, e.lastFileAt ?? 0) > STALL_FLAG_MS;
      if (stalled !== !!e.stalled) {
        e.stalled = stalled;
        changed = true;
      }
    }
    if (changed) broadcast();
  }, 15_000);
  decay.unref();

  function set(sid, patch) {
    const cur = map.get(sid) ?? { status: 'idle', since: Date.now(), updatedAt: 0, source: 'hook', cwd: null, lastPrompt: null };
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    map.set(sid, next);
    broadcast();
  }

  /** Called with a parsed hook payload from notify.mjs. */
  function onHook(evt) {
    const sid = evt.session_id;
    if (!sid) return;
    const cwd = typeof evt.cwd === 'string' ? evt.cwd : null;
    switch (evt.hook_event_name) {
      case 'UserPromptSubmit':
        set(sid, {
          status: 'working', since: Date.now(), source: 'hook', cwd, stalled: false, notification: null,
          lastPrompt: typeof evt.prompt === 'string' ? evt.prompt.slice(0, 200) : null,
        });
        break;
      case 'Notification':
        // Claude is blocked on the user (permission prompt / attention request)
        set(sid, {
          status: 'needs-you', source: 'hook', cwd, stalled: false,
          notification: typeof evt.message === 'string' ? evt.message.slice(0, 200) : null,
        });
        break;
      case 'Stop':
        set(sid, { status: 'idle', source: 'hook', cwd, stalled: false, notification: null });
        break;
      case 'SessionStart':
        set(sid, { status: 'idle', source: 'hook', cwd });
        break;
      case 'SessionEnd':
        map.delete(sid);
        try {
          db.prepare('UPDATE sessions SET ended_at=? WHERE id=? AND ended_at IS NULL').run(Date.now(), sid);
        } catch { /* session may not be ingested yet */ }
        broadcast();
        break;
      case 'SubagentStop':
        if (map.has(sid)) set(sid, {});
        break;
      default:
        break;
    }
  }

  const selCloud = db.prepare(
    'SELECT (p.worktree_branch IS NOT NULL) c FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?'
  );

  /** Fallback: a main transcript file changed -> that session is (probably) active. */
  function onFileActivity(sessionIds) {
    const now = Date.now();
    for (const sid of sessionIds) {
      const cur = map.get(sid);
      // never downgrade a fresh hook-driven state — but still record the file
      // heartbeat, or every hook-driven session would read as stalled
      if (cur && cur.source === 'hook' && now - cur.updatedAt < LIVE_FILE_ACTIVITY_MS) {
        cur.lastFileAt = now;
        if (cur.stalled) { cur.stalled = false; broadcast(); }
        continue;
      }
      let cloud = cur?.cloud ?? false;
      if (cur?.cloud === undefined) {
        try { cloud = !!(/** @type {any} */ (selCloud.get(sid))?.c); } catch { cloud = false; }
      }
      // file growth clears a stall flag but must NOT clear needs-you (the
      // permission prompt is still open even though bytes trickled in)
      const status = cur?.status === 'needs-you' ? 'needs-you' : 'working';
      set(sid, { status, source: cur?.status === 'needs-you' ? cur.source : 'file', cloud, lastFileAt: now, stalled: false, since: cur?.status === 'working' || cur?.status === 'needs-you' ? cur.since : now });
    }
  }

  /** Cross-check with Claude Code's own live process registry. Windows recycles
   * PIDs aggressively, so a liveness probe alone passes for long-dead sessions —
   * also require a recent startedAt and dedupe by sessionId. */
  const REGISTRY_MAX_AGE_MS = 12 * 3600_000;
  // The registry scan is synchronous fs + a kill(0) probe per file, and every
  // hook event rebuilds the snapshot that calls it — a burst of hooks was
  // paying that cost per event, on the thread that serves HTTP. A short TTL
  // lets a burst reuse one scan; 2.5s is far below the 15s decay cadence.
  const REGISTRY_TTL_MS = 2_500;
  let registryCache = { at: 0, value: /** @type {any[]} */ ([]) };
  function liveRegistry() {
    if (Date.now() - registryCache.at < REGISTRY_TTL_MS) return registryCache.value;
    const value = scanRegistry();
    registryCache = { at: Date.now(), value };
    return value;
  }
  function scanRegistry() {
    /** @type {Map<string, any>} */
    const bySession = new Map();
    try {
      for (const f of fs.readdirSync(SESSIONS_DIR)) {
        if (!f.endsWith('.json')) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          if (!j?.sessionId || !j?.pid) continue;
          if (typeof j.startedAt !== 'number' || Date.now() - j.startedAt > REGISTRY_MAX_AGE_MS) continue;
          let alive = false;
          try { process.kill(j.pid, 0); alive = true; } catch { alive = false; }
          if (!alive) continue;
          const prev = bySession.get(j.sessionId);
          if (!prev || (j.startedAt ?? 0) > (prev.startedAt ?? 0)) {
            bySession.set(j.sessionId, { sessionId: j.sessionId, pid: j.pid, cwd: j.cwd ?? null, name: j.name ?? null, startedAt: j.startedAt ?? null });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* registry dir may not exist */ }
    return [...bySession.values()];
  }

  function snapshot() {
    const reg = liveRegistry();
    const regById = new Map(reg.map((r) => [r.sessionId, r]));
    const rows = [];
    const seen = new Set();
    for (const [sid, e] of map) {
      seen.add(sid);
      rows.push(enrich(sid, e.status, e.since, e.lastPrompt, e.cwd ?? regById.get(sid)?.cwd ?? null, e));
    }
    // registry-only sessions (running process, no hook/file signal yet)
    for (const r of reg) {
      if (seen.has(r.sessionId)) continue;
      rows.push(enrich(r.sessionId, 'open', r.startedAt ?? Date.now(), null, r.cwd, null));
    }
    const prio = (s) => (s.status === 'needs-you' ? 0 : s.status === 'working' ? 1 : 2);
    rows.sort((a, b) => prio(a) - prio(b) || b.since - a.since);
    return rows;
  }

  const selSession = db.prepare(
    `SELECT s.title, s.last_prompt, s.project_id, s.est_cost_usd, s.models, s.claude_ms, s.prompt_count,
            p.name project_name, p.worktree_branch
       FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?`
  );
  const selLiveAgents = db.prepare(
    'SELECT count(*) c FROM agent_runs WHERE session_id=? AND last_ts>?'
  );
  // last credited API call's input side ≈ current context size (estimate:
  // system prompt/tool overhead shifts it, and compaction resets it)
  const selContext = db.prepare(
    `SELECT input_tokens + cache_read_tokens + cache_create_5m + cache_create_1h ctx, model
       FROM events WHERE session_id=? AND usage_credited=1 AND kind='assistant'
       ORDER BY ts DESC LIMIT 1`
  );

  function enrich(sid, status, since, lastPrompt, cwd, entry) {
    let row = /** @type {any} */ (null);
    try { row = selSession.get(sid); } catch { /* ignore */ }
    const cloud = !!row?.worktree_branch || /[\\/]\.claude[\\/]worktrees[\\/]/.test(cwd ?? '');
    let agentsActive = 0;
    if (status === 'working') {
      try { agentsActive = /** @type {any} */ (selLiveAgents.get(sid, Date.now() - 10 * 60_000))?.c ?? 0; } catch { /* ignore */ }
    }
    let models = [];
    try { models = row?.models ? JSON.parse(row.models) : []; } catch { /* ignore */ }
    let contextTokens = null;
    let contextWindow = null;
    if (status === 'working' || status === 'needs-you') {
      try {
        const c = /** @type {any} */ (selContext.get(sid));
        if (c?.ctx) {
          contextTokens = c.ctx;
          // Fable/Mythos are natively 1M; other models only via the [1m] variant
          contextWindow = /\[1m\]|fable|mythos/.test(c.model ?? '') ? 1_000_000 : 200_000;
        }
      } catch { /* ignore */ }
    }
    return {
      sessionId: sid,
      status,
      since,
      cloud,
      stalled: !!entry?.stalled,
      notification: entry?.notification ?? null,
      lastPrompt: lastPrompt ?? row?.last_prompt ?? null,
      title: row?.title ?? null,
      projectId: row?.project_id ?? null,
      projectName: row?.project_name ?? (cwd ? cwd.split(/[\\/]/).pop() : null),
      cwd,
      estCostUsd: row?.est_cost_usd ?? null,
      claudeMs: row?.claude_ms ?? 0,
      promptCount: row?.prompt_count ?? 0,
      models,
      agentsActive,
      contextTokens,
      contextWindow,
    };
  }

  /** Live process-registry entry for a session (kill switch / resume guard). */
  function registryFor(sessionId) {
    return liveRegistry().find((r) => r.sessionId === sessionId) ?? null;
  }

  return { onHook, onFileActivity, snapshot, registryFor };
}
