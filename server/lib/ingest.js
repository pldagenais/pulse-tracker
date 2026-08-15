import fs from 'node:fs';
import path from 'node:path';
import { INGEST_BATCH_BYTES } from '../config.js';
import { readLines } from './lineReader.js';
import { classifyLine, envelope, extractPrompt, extractUsage, assistantMeta, extractAgentRun, errorInfo } from './parse.js';
import { scanTranscripts, classifyPath } from './scan.js';
import { makeProjectResolver } from './projects.js';
import { recomputeSessions } from './aggregate.js';
import { sha1, safeJsonParse, yieldLoop } from './util.js';
import { log } from './logger.js';

const PROMPT_TEXT_CAP = 100_000;
const LAST_PROMPT_CAP = 500;

/**
 * Creates the ingestion engine. Single-flight: files are processed strictly
 * serially (DatabaseSync is synchronous); between batches we yield to the
 * event loop so HTTP/SSE stay responsive.
 *
 * onEvent(type, payload) receives: 'ingest-progress', 'sessions-updated'.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ onEvent?: (type: string, payload?: any) => void }} [opts]
 */
export function createIngester(db, { onEvent = () => {} } = {}) {
  const projectIdFor = makeProjectResolver(db);

  const S = {
    selCursor: db.prepare('SELECT * FROM ingest_files WHERE path=?'),
    insCursor: db.prepare(
      'INSERT OR IGNORE INTO ingest_files(path, file_kind, agent_id) VALUES(?,?,?)'
    ),
    updCursor: db.prepare(
      `UPDATE ingest_files SET size=?, mtime_ms=?, offset=?, session_ids=?, last_message_id=?,
        last_ingested_at=?, parse_errors=parse_errors+?, error=NULL WHERE path=?`
    ),
    updCursorError: db.prepare('UPDATE ingest_files SET error=?, last_ingested_at=? WHERE path=?'),
    resetCursor: db.prepare(
      "UPDATE ingest_files SET offset=0, last_message_id=NULL, size=-1, mtime_ms=-1 WHERE path=?"
    ),
    delCursor: db.prepare('DELETE FROM ingest_files WHERE path=?'),
    allCursors: db.prepare('SELECT path, file_kind, session_ids FROM ingest_files'),

    insSession: db.prepare('INSERT OR IGNORE INTO sessions(id, project_id) VALUES(?,?)'),
    selSessionProject: db.prepare('SELECT project_id FROM sessions WHERE id=?'),
    updSessionProject: db.prepare(
      'UPDATE sessions SET project_id=? WHERE id=? AND project_id=0'
    ),
    updSessionPath: db.prepare(
      'UPDATE sessions SET transcript_path=? WHERE id=? AND transcript_path IS NULL'
    ),
    updSessionMeta: db.prepare(
      `UPDATE sessions SET
         title=coalesce(?, title), last_prompt=coalesce(?, last_prompt),
         git_branch=coalesce(?, git_branch), cc_version=coalesce(?, cc_version),
         entrypoint=coalesce(?, entrypoint), pr_links=coalesce(?, pr_links)
       WHERE id=?`
    ),
    selSessionPr: db.prepare('SELECT pr_links FROM sessions WHERE id=?'),

    insEvent: db.prepare(
      `INSERT OR IGNORE INTO events(uuid, session_id, ts, kind, message_id, model, effort,
         usage_credited, input_tokens, output_tokens, cache_read_tokens, cache_create_5m,
         cache_create_1h, tool_name, tool_use_count, agent_id, attr_skill, attr_plugin,
         attr_mcp_server, attr_mcp_tool, char_count)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ),
    hasCredited: db.prepare('SELECT 1 FROM events WHERE message_id=? AND usage_credited=1 LIMIT 1'),

    insPrompt: db.prepare(
      `INSERT OR IGNORE INTO prompts(uuid, session_id, project_id, ts, kind, command_name, text, char_count)
       VALUES(?,?,?,?,?,?,?,?)`
    ),

    upAgentFromFile: db.prepare(
      `INSERT INTO agent_runs(agent_id, session_id, transcript_path, resolved_model, first_ts, last_ts,
         input_tokens, output_tokens, cache_read_tokens, cache_create_5m_tokens, cache_create_1h_tokens, tool_use_count)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(agent_id) DO UPDATE SET
         session_id=excluded.session_id,
         transcript_path=excluded.transcript_path,
         resolved_model=coalesce(agent_runs.resolved_model, excluded.resolved_model),
         first_ts=CASE WHEN agent_runs.first_ts IS NULL OR excluded.first_ts < agent_runs.first_ts
                       THEN excluded.first_ts ELSE agent_runs.first_ts END,
         last_ts=CASE WHEN agent_runs.last_ts IS NULL OR excluded.last_ts > agent_runs.last_ts
                      THEN excluded.last_ts ELSE agent_runs.last_ts END,
         input_tokens=agent_runs.input_tokens+excluded.input_tokens,
         output_tokens=agent_runs.output_tokens+excluded.output_tokens,
         cache_read_tokens=agent_runs.cache_read_tokens+excluded.cache_read_tokens,
         cache_create_5m_tokens=agent_runs.cache_create_5m_tokens+excluded.cache_create_5m_tokens,
         cache_create_1h_tokens=agent_runs.cache_create_1h_tokens+excluded.cache_create_1h_tokens,
         tool_use_count=agent_runs.tool_use_count+excluded.tool_use_count`
    ),
    // Metadata from the parent-session Agent toolUseResult (authoritative for
    // duration/status/toolStats). Token columns stay owned by the file scan.
    upAgentFromResult: db.prepare(
      `INSERT INTO agent_runs(agent_id, session_id, agent_type, resolved_model, status, duration_ms, tool_stats)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(agent_id) DO UPDATE SET
         session_id=coalesce(agent_runs.session_id, excluded.session_id),
         agent_type=coalesce(excluded.agent_type, agent_runs.agent_type),
         resolved_model=coalesce(excluded.resolved_model, agent_runs.resolved_model),
         status=coalesce(excluded.status, agent_runs.status),
         duration_ms=coalesce(excluded.duration_ms, agent_runs.duration_ms),
         tool_stats=coalesce(excluded.tool_stats, agent_runs.tool_stats)`
    ),
  };

  // ---- work queue (strictly serial; dedupe + re-run-if-dirty) ----
  const queued = new Set();
  const running = new Set();
  const dirty = new Set();
  let chain = Promise.resolve();

  const progress = {
    phase: 'idle', // idle | backfill | watching
    filesTotal: 0,
    filesDone: 0,
    bytesTotal: 0,
    bytesDone: 0,
    parseErrors: 0,
    lastFile: null,
  };

  let deferRecompute = false;
  const deferredTouched = new Set();

  function emitProgress() {
    onEvent('ingest-progress', { ...progress });
  }

  function enqueue(info) {
    // Central skip guard: every entrypoint funnels through here. The hook
    // route in particular forwards transcript paths from the summarizer's
    // own claude -p children (hooks are installed globally).
    if (info.fileKind === 'skip') return chain;
    const key = info.path;
    if (running.has(key)) {
      dirty.add(key);
      return chain;
    }
    if (queued.has(key)) return chain;
    queued.add(key);
    chain = chain.then(async () => {
      queued.delete(key);
      running.add(key);
      try {
        await ingestFile(info);
      } catch (e) {
        log.error('ingest failed:', key, e);
        try { S.updCursorError.run(String(e.message || e), Date.now(), key); } catch { /* ignore */ }
      } finally {
        running.delete(key);
        if (dirty.delete(key)) enqueue(info);
      }
    });
    return chain;
  }

  function afterFile(touched) {
    if (!touched.size) return;
    if (deferRecompute) {
      for (const sid of touched) deferredTouched.add(sid);
      return;
    }
    recomputeSessions(db, [...touched]);
    onEvent('sessions-updated', { sessionIds: [...touched] });
  }

  // ---- per-file incremental pass ----
  async function ingestFile(info) {
    let st;
    try {
      st = fs.statSync(info.path);
    } catch {
      S.delCursor.run(info.path); // file removed
      return;
    }
    const mtimeMs = Math.trunc(st.mtimeMs);
    S.insCursor.run(info.path, info.fileKind, info.agentId ?? null);
    const cur = /** @type {any} */ (S.selCursor.get(info.path));
    if (cur.size === st.size && cur.mtime_ms === mtimeMs) {
      bumpDone(st.size);
      return;
    }
    if (st.size < cur.offset) {
      // Shrunk/rewritten file (rare): rebuild every session this file feeds.
      const sids = JSON.parse(cur.session_ids || '[]');
      log.warn('file shrank, rebuilding sessions:', info.path, sids);
      await rebuildSessions(sids.length ? sids : []);
      bumpDone(st.size);
      return;
    }

    const state = {
      filePath: info.path,
      lastMessageId: cur.last_message_id,
      creditedThisPass: new Set(),
      parseErrors: 0,
      sessionIds: new Set(JSON.parse(cur.session_ids || '[]')),
      /** @type {Map<string, any>} per-session marker/meta accumulation */
      meta: new Map(),
      // subagent accumulator
      agent: info.fileKind === 'subagent'
        ? { agentId: info.agentId, sessionId: null, minTs: null, maxTs: null, model: null,
            in: 0, out: 0, cr: 0, c5: 0, c1: 0, toolUse: 0 }
        : null,
    };
    const touched = new Set();
    let consumed = cur.offset;
    let batchStart = cur.offset;

    const flushCursor = () => {
      S.updCursor.run(
        st.size, mtimeMs, consumed, JSON.stringify([...state.sessionIds]),
        state.lastMessageId, Date.now(), state.parseErrors, info.path
      );
      state.parseErrors = 0;
    };

    db.exec('BEGIN');
    try {
      for await (const { text, endOffset } of readLines(info.path, cur.offset)) {
        if (info.fileKind === 'subagent') processSubagentLine(text, state);
        else processMainLine(text, info, state, touched);
        consumed = endOffset;
        if (endOffset - batchStart >= INGEST_BATCH_BYTES) {
          flushAgentAccum(info, state, touched);
          flushSessionMeta(state);
          flushCursor();
          db.exec('COMMIT');
          progress.bytesDone += endOffset - batchStart;
          batchStart = endOffset;
          emitProgress();
          await yieldLoop();
          db.exec('BEGIN');
        }
      }
      flushAgentAccum(info, state, touched);
      flushSessionMeta(state);
      flushCursor();
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    progress.bytesDone += Math.max(consumed - batchStart, 0);
    bumpDone(0);
    progress.lastFile = path.basename(info.path);
    emitProgress();
    afterFile(touched);
  }

  function bumpDone(_bytes) {
    progress.filesDone = Math.min(progress.filesDone + 1, progress.filesTotal || progress.filesDone + 1);
  }

  function metaFor(state, sid) {
    let m = state.meta.get(sid);
    if (!m) {
      m = { title: null, lastPrompt: null, summary: null, gitBranch: null, version: null,
            entrypoint: null, prLinks: [], projectId: null };
      state.meta.set(sid, m);
    }
    return m;
  }

  const insErrorEvent = db.prepare('INSERT INTO error_events(ts, session_id, kind, snippet) VALUES(?,?,?,?)');
  const pruneErrorEvents = db.prepare('DELETE FROM error_events WHERE id <= (SELECT COALESCE(MAX(id),0) FROM error_events) - 1000');
  function recordErrorSignal(obj, kind, sid, ts) {
    const e = errorInfo(obj, kind === 'tool_result' ? 'tool_result' : 'assistant');
    if (!e) return;
    try {
      insErrorEvent.run(ts ?? Date.now(), sid, e.kind, e.snippet);
      pruneErrorEvents.run();
    } catch { /* diagnostics must never break ingestion */ }
  }

  const insFailure = db.prepare('INSERT INTO parse_failures(ts, file, reason, snippet) VALUES(?,?,?,?)');
  const pruneFailures = db.prepare('DELETE FROM parse_failures WHERE id <= (SELECT COALESCE(MAX(id),0) FROM parse_failures) - 500');
  function recordParseFailure(file, text) {
    try {
      insFailure.run(Date.now(), file, 'invalid JSON line', text.slice(0, 120));
      pruneFailures.run();
    } catch { /* diagnostics must never break ingestion */ }
  }

  function processMainLine(text, info, state, touched) {
    const obj = safeJsonParse(text);
    if (!obj) { state.parseErrors++; recordParseFailure(info.path, text); return; }
    const { kind } = classifyLine(obj);
    if (kind === 'skip') return;

    const sid = typeof obj.sessionId === 'string' ? obj.sessionId : null;
    if (!sid) return;
    state.sessionIds.add(sid);
    const m = metaFor(state, sid);

    // Markers without timestamps: last occurrence wins.
    if (kind === 'title') { m.title = str(obj.customTitle); return; }
    if (kind === 'last_prompt') { m.lastPrompt = str(obj.lastPrompt)?.slice(0, LAST_PROMPT_CAP) ?? null; return; }
    if (kind === 'summary') { m.summary = str(obj.summary); return; }
    if (kind === 'pr_link') {
      if (obj.prUrl) m.prLinks.push({ number: obj.prNumber ?? null, url: obj.prUrl, repo: obj.prRepository ?? null });
      return;
    }

    const env = envelope(obj);
    if (env.ts == null) return;

    // A session belongs to ONE project: its first-seen cwd. Later lines may carry
    // a different cwd (the agent cd'd into a subdirectory) — those must not spawn
    // separate project rows.
    if (m.projectId == null) {
      const existing = /** @type {any} */ (S.selSessionProject.get(sid))?.project_id;
      if (existing) m.projectId = existing;
      else if (env.cwd) m.projectId = projectIdFor(env.cwd);
    }
    S.insSession.run(sid, m.projectId ?? 0);
    if (m.projectId != null) S.updSessionProject.run(m.projectId, sid);
    const projectId = m.projectId;
    const ownFile = path.basename(info.path, '.jsonl') === sid;
    if (ownFile) S.updSessionPath.run(info.path, sid);
    touched.add(sid);
    if (env.gitBranch) m.gitBranch = env.gitBranch;
    if (env.version) m.version = env.version;
    if (env.entrypoint) m.entrypoint = env.entrypoint;

    const uuid = env.uuid ?? `q:${sha1(`${sid}|${env.ts}|${obj.operation ?? ''}|${str(obj.content)?.slice(0, 80) ?? ''}`)}`;

    switch (kind) {
      case 'prompt':
      case 'command': {
        const { text: ptext, commandName } = extractPrompt(obj, kind);
        S.insPrompt.run(
          uuid, sid, projectId ?? 0, env.ts,
          kind === 'prompt' ? 'typed' : 'command', commandName,
          ptext.slice(0, PROMPT_TEXT_CAP), ptext.length
        );
        S.insEvent.run(uuid, sid, env.ts, kind, null, null, null, 0,
          null, null, null, null, null, null, 0, null, null, null, null, null, ptext.length);
        break;
      }
      case 'assistant': {
        const a = assistantMeta(obj);
        const u = extractUsage(obj.message);
        let credit = false;
        if (u && a.messageId) {
          if (!state.creditedThisPass.has(a.messageId) && a.messageId !== state.lastMessageId
              && !S.hasCredited.get(a.messageId)) {
            credit = true;
          }
          state.creditedThisPass.add(a.messageId);
          state.lastMessageId = a.messageId;
        }
        S.insEvent.run(uuid, sid, env.ts, 'assistant', a.messageId, a.model, a.effort,
          credit ? 1 : 0,
          credit ? u.input : null, credit ? u.output : null, credit ? u.cacheRead : null,
          credit ? u.cache5m : null, credit ? u.cache1h : null,
          a.toolName, a.toolUseCount, null,
          a.attrSkill, a.attrPlugin, a.attrMcpServer, a.attrMcpTool, a.charCount);
        break;
      }
      case 'tool_result': {
        const run = extractAgentRun(obj);
        recordErrorSignal(obj, 'tool_result', sid, env.ts);
        S.insEvent.run(uuid, sid, env.ts, 'tool_result', null, null, null, 0,
          null, null, null, null, null, null, 0, run?.agentId ?? null,
          null, null, null, null, null);
        if (run) {
          S.upAgentFromResult.run(
            run.agentId, sid, run.agentType, run.resolvedModel, run.status,
            run.totalDurationMs, run.toolStats ? JSON.stringify(run.toolStats) : null
          );
        }
        break;
      }
      default: {
        // system | attachment | queue_op — activity markers for turn segmentation
        S.insEvent.run(uuid, sid, env.ts, kind, null, null, null, 0,
          null, null, null, null, null, null, 0, null, null, null, null, null, null);
      }
    }
  }

  function processSubagentLine(text, state) {
    const obj = safeJsonParse(text);
    if (!obj) { state.parseErrors++; recordParseFailure(state.filePath, text); return; }
    const acc = state.agent;
    const env = envelope(obj);
    if (env.sessionId && !acc.sessionId) acc.sessionId = env.sessionId;
    if (env.agentId && !acc.agentId) acc.agentId = env.agentId;
    if (env.ts != null) {
      if (acc.minTs == null || env.ts < acc.minTs) acc.minTs = env.ts;
      if (acc.maxTs == null || env.ts > acc.maxTs) acc.maxTs = env.ts;
    }
    if (obj.type === 'assistant') {
      const a = assistantMeta(obj);
      if (!acc.model && a.model && a.model !== '<synthetic>') acc.model = a.model;
      acc.toolUse += a.toolUseCount;
      const u = extractUsage(obj.message);
      if (u && a.messageId && a.messageId !== state.lastMessageId && !state.creditedThisPass.has(a.messageId)) {
        acc.in += u.input; acc.out += u.output; acc.cr += u.cacheRead;
        acc.c5 += u.cache5m; acc.c1 += u.cache1h;
        state.creditedThisPass.add(a.messageId);
        state.lastMessageId = a.messageId;
      }
    }
  }

  function flushAgentAccum(info, state, touched) {
    const acc = state.agent;
    if (!acc || !acc.agentId) return;
    const hasData = acc.sessionId || acc.minTs != null || acc.in + acc.out + acc.cr + acc.c5 + acc.c1 + acc.toolUse > 0;
    if (!hasData) return;
    S.upAgentFromFile.run(
      acc.agentId, acc.sessionId ?? '', info.path, acc.model, acc.minTs, acc.maxTs,
      acc.in, acc.out, acc.cr, acc.c5, acc.c1, acc.toolUse
    );
    if (acc.sessionId) {
      state.sessionIds.add(acc.sessionId);
      touched.add(acc.sessionId);
    }
    // reset additive fields; keep identity so later batches keep accumulating correctly
    acc.in = 0; acc.out = 0; acc.cr = 0; acc.c5 = 0; acc.c1 = 0; acc.toolUse = 0;
    acc.minTs = null; acc.maxTs = null;
  }

  function flushSessionMeta(state) {
    for (const [sid, m] of state.meta) {
      let prJson = null;
      if (m.prLinks.length) {
        const existing = safeJsonParse(/** @type {any} */ (S.selSessionPr.get(sid))?.pr_links ?? '') ?? [];
        const byUrl = new Map(existing.map((p) => [p.url, p]));
        for (const p of m.prLinks) byUrl.set(p.url, p);
        prJson = JSON.stringify([...byUrl.values()]);
      }
      S.updSessionMeta.run(
        m.title ?? m.summary ?? null, m.lastPrompt, m.gitBranch, m.version, m.entrypoint, prJson, sid
      );
      m.prLinks = [];
    }
  }

  // ---- rebuild path (fork rewrites, settings that require reparse) ----
  async function rebuildSessions(sessionIds) {
    if (!sessionIds.length) return;
    const targets = new Set(sessionIds);
    const files = [];
    for (const row of /** @type {any[]} */ (S.allCursors.all())) {
      const sids = JSON.parse(row.session_ids || '[]');
      if (sids.some((s) => targets.has(s))) files.push(row.path);
    }
    log.info(`rebuild: ${sessionIds.length} sessions across ${files.length} files`);
    db.exec('BEGIN');
    try {
      const delEvents = db.prepare('DELETE FROM events WHERE session_id=?');
      const delPrompts = db.prepare('DELETE FROM prompts WHERE session_id=?');
      const delTurns = db.prepare('DELETE FROM turns WHERE session_id=?');
      const delAgents = db.prepare('DELETE FROM agent_runs WHERE session_id=?');
      for (const sid of targets) {
        delEvents.run(sid); delPrompts.run(sid); delTurns.run(sid); delAgents.run(sid);
      }
      for (const f of files) S.resetCursor.run(f);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    for (const f of files) {
      await ingestFile(classifyPath(f));
    }
  }

  // ---- backfill / rescan ----
  async function scanAndIngest({ filter = null, phase = 'backfill' } = {}) {
    const all = scanTranscripts().filter((f) => !filter || f.path.includes(filter));
    // Main transcripts first (sessions/prompts appear in the UI sooner), then subagents.
    all.sort((a, b) => (a.fileKind === b.fileKind ? 0 : a.fileKind === 'main' ? -1 : 1));

    const work = [];
    let bytes = 0;
    for (const f of all) {
      let st;
      try { st = fs.statSync(f.path); } catch { continue; }
      const cur = /** @type {any} */ (S.selCursor.get(f.path));
      if (cur && cur.size === st.size && cur.mtime_ms === Math.trunc(st.mtimeMs)) continue;
      work.push(f);
      bytes += Math.max(st.size - (cur?.offset ?? 0), 0);
    }

    progress.phase = phase;
    progress.filesTotal = work.length;
    progress.filesDone = 0;
    progress.bytesTotal = bytes;
    progress.bytesDone = 0;
    emitProgress();

    deferRecompute = true;
    try {
      for (const f of work) enqueue(f);
      await chain;
    } finally {
      deferRecompute = false;
    }
    if (deferredTouched.size) {
      log.info(`recomputing ${deferredTouched.size} sessions after ${phase}`);
      const ids = [...deferredTouched];
      deferredTouched.clear();
      // recompute in chunks so we keep yielding to the event loop
      for (let i = 0; i < ids.length; i += 25) {
        recomputeSessions(db, ids.slice(i, i + 25));
        await yieldLoop();
      }
      onEvent('sessions-updated', { sessionIds: ids });
    }
    progress.phase = 'watching';
    emitProgress();
    log.info(`${phase} complete: ${progress.filesDone}/${progress.filesTotal} files`);
  }

  return {
    enqueue,
    enqueuePath: (p) => enqueue(classifyPath(p)),
    /** Reset a file's cursor and re-ingest it from byte 0 (parse-failure inbox). */
    reparseFile: (p) => {
      S.resetCursor.run(p);
      return enqueue(classifyPath(p));
    },
    scanAndIngest,
    rebuildSessions,
    projectIdFor,
    get progress() { return { ...progress }; },
    /** Await outstanding queue work (tests/scripts). */
    idle: () => chain,
  };
}

function str(v) {
  return typeof v === 'string' && v.length ? v : null;
}
