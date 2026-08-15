import fs from 'node:fs';
import { dayBounds, addDays, todayKey, safeJsonParse } from '../lib/util.js';
import {
  rangeDaily, heatmapDays, records, hourHistogram, modelSplit, toolUsage, skillUsage,
  projectSplit, timelineDay, firstActivityDay,
} from '../lib/stats.js';
import { readLines } from '../lib/lineReader.js';
import { classifyLine, extractPrompt, assistantMeta, tsMs } from '../lib/parse.js';
import { runClaude } from '../lib/llm.js';
import { summaryRow } from './report.js';
import { ratesFor } from '../lib/pricing.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

function dayParam(v, fallback = todayKey()) {
  return typeof v === 'string' && DAY_RE.test(v) ? v : fallback;
}

/** Upper bound on any day walk in this file, so none can run away. */
const MAX_RANGE_DAYS = 400;

/**
 * Parse from/to. Returns `null` when the range is inverted so the caller can
 * reject it: the day walks downstream are synchronous, and an inverted range
 * used to run forever, blocking the whole server rather than crashing it.
 */
function rangeParams(q, defaultDays = 30) {
  const to = dayParam(q.to);
  const from = dayParam(q.from, addDays(to, -(defaultDays - 1)));
  if (from > to) return null;
  const [fromMs] = dayBounds(from);
  const [, toMs] = dayBounds(to);
  return { from, to, fromMs, toMs };
}

function sessionRow(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    parentProjectId: r.parent_project_id ?? null,
    worktreeBranch: r.worktree_branch ?? null,
    title: r.title,
    lastPrompt: r.last_prompt,
    firstPrompt: r.first_prompt ?? null,
    starred: !!r.starred,
    tags: safeJsonParse(r.meta_tags ?? '[]') ?? [],
    note: r.meta_note ?? null,
    gitBranch: r.git_branch,
    ccVersion: r.cc_version,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    lastEventAt: r.last_event_at,
    promptCount: r.prompt_count,
    turnCount: r.turn_count,
    claudeMs: r.claude_ms,
    userActiveMs: r.user_active_ms,
    subagentCount: r.subagent_count,
    subagentMs: r.subagent_ms,
    toolUseCount: r.tool_use_count,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: (r.cache_create_5m_tokens || 0) + (r.cache_create_1h_tokens || 0),
    estCostUsd: r.est_cost_usd,
    hasUnpricedTokens: !!r.has_unpriced_tokens,
    models: safeJsonParse(r.models ?? '') ?? [],
    prLinks: safeJsonParse(r.pr_links ?? '') ?? [],
  };
}

const SESSION_SELECT = `
  SELECT s.*, p.name project_name, p.parent_project_id, p.worktree_branch,
         (st.session_id IS NOT NULL) starred,
         sm.tags meta_tags, sm.note meta_note,
         (SELECT substr(p2.text,1,100) FROM prompts p2 WHERE p2.session_id=s.id ORDER BY p2.ts LIMIT 1) first_prompt
    FROM sessions s JOIN projects p ON p.id = s.project_id
    LEFT JOIN starred st ON st.session_id = s.id
    LEFT JOIN session_meta sm ON sm.session_id = s.id`;

export function mountData(app, ctx) {
  const { db, live } = ctx;

  app.get('/api/overview', (req, res) => {
    const date = dayParam(req.query.date);
    const day = rangeDaily(db, date, date)[0];
    const [a, b] = dayBounds(date);
    // 14 local days ending on `date` — powers the 7-day chart, sparklines,
    // and vs-yesterday / vs-last-week deltas client-side.
    const trend = rangeDaily(db, addDays(date, -13), date);
    ok(res, {
      date,
      ...day,
      byProject: projectSplit(db, a, b),
      liveSessions: live.snapshot(),
      records: records(db),
      trend,
    });
  });

  app.get('/api/timeline', (req, res) => {
    ok(res, timelineDay(db, dayParam(req.query.date)));
  });

  app.get('/api/stats', (req, res) => {
    const groupBy = String(req.query.groupBy ?? 'day');
    const range = rangeParams(req.query);
    if (!range) return bad(res, 'from must be on or before to');
    const { from, to, fromMs, toMs } = range;
    switch (groupBy) {
      case 'day':
        return ok(res, { groupBy, from, to, rows: rangeDaily(db, from, to) });
      case 'hour':
        return ok(res, { groupBy, from, to, rows: hourHistogram(db, fromMs, toMs) });
      case 'project':
        return ok(res, { groupBy, from, to, rows: projectSplit(db, fromMs, toMs) });
      case 'model':
        return ok(res, { groupBy, from, to, rows: modelSplit(db, fromMs, toMs) });
      case 'tool':
        return ok(res, { groupBy, from, to, ...toolUsage(db, fromMs, toMs) });
      case 'skill':
        return ok(res, { groupBy, from, to, ...skillUsage(db, fromMs, toMs) });
      default:
        return bad(res, `unknown groupBy: ${groupBy}`);
    }
  });

  app.get('/api/heatmap', (req, res) => {
    const to = dayParam(req.query.to);
    const from = dayParam(req.query.from, addDays(to, -370));
    if (from > to) return bad(res, 'from must be on or before to');
    ok(res, { from, to, days: heatmapDays(db, from, to), firstActivityDay: firstActivityDay(db) });
  });

  app.get('/api/projects', (req, res) => {
    // Include sessionless PARENT projects too — a repo whose work all happens
    // in worktrees still needs its root row for the UI to group under.
    const rows = db
      .prepare(
        `SELECT p.*, count(s.id) session_count, coalesce(sum(s.claude_ms),0) claude_ms,
                coalesce(sum(s.user_active_ms),0) user_active_ms, coalesce(sum(s.prompt_count),0) prompt_count,
                coalesce(sum(s.est_cost_usd),0) est_cost_usd, coalesce(sum(s.subagent_count),0) subagent_count,
                max(s.last_event_at) last_active
           FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
          GROUP BY p.id
         HAVING count(s.id) > 0
             OR p.id IN (SELECT DISTINCT p2.parent_project_id FROM projects p2
                           JOIN sessions s2 ON s2.project_id = p2.id
                          WHERE p2.parent_project_id IS NOT NULL)
          ORDER BY last_active DESC`
      )
      .all();
    ok(res, rows.map((r) => ({
      id: r.id,
      path: r.path,
      name: r.name,
      parentProjectId: r.parent_project_id,
      worktreeBranch: r.worktree_branch,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      lastActive: r.last_active,
      sessionCount: r.session_count,
      claudeMs: r.claude_ms,
      userActiveMs: r.user_active_ms,
      promptCount: r.prompt_count,
      subagentCount: r.subagent_count,
      estCostUsd: r.est_cost_usd,
    })));
  });

  // Month calendar for one project family: claude time per local day.
  app.get('/api/projects/:id/calendar', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM projects WHERE id=?').get(id)) return bad(res, 'project not found', 404);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : todayKey().slice(0, 7);
    const familyIds = db.prepare('SELECT id FROM projects WHERE id=? OR parent_project_id=?').all(id, id).map((r) => r.id);
    const ph = familyIds.map(() => '?').join(',');
    const [y, m] = month.split('-').map(Number);
    const [a] = dayBounds(`${month}-01`);
    const lastDay = new Date(y, m, 0).getDate();
    const [, b] = dayBounds(`${month}-${String(lastDay).padStart(2, '0')}`);
    const days = db.prepare(
      `SELECT date(t.started_at/1000,'unixepoch','localtime') d, sum(t.claude_ms) ms, count(*) turns,
              count(DISTINCT t.session_id) sessions,
              sum(CASE WHEN p2.worktree_branch IS NOT NULL THEN t.claude_ms ELSE 0 END) cloudMs
         FROM turns t
         JOIN sessions s ON s.id=t.session_id
         JOIN projects p2 ON p2.id=s.project_id
        WHERE s.project_id IN (${ph}) AND t.started_at>=? AND t.started_at<?
        GROUP BY d`
    ).all(...familyIds, a, b);
    ok(res, {
      month,
      days: days.map((r) => ({ date: r.d, claudeMs: r.ms ?? 0, cloudMs: r.cloudMs ?? 0, turns: r.turns, sessions: r.sessions })),
    });
  });

  app.get('/api/projects/:id', (req, res) => {
    const id = Number(req.params.id);
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!p) return bad(res, 'project not found', 404);
    // A repo's work often lives entirely in its worktree children (cloud /
    // background sessions check out under .claude\worktrees\) — the detail
    // page must roll up the whole family, matching the projects list.
    const familyIds = db
      .prepare('SELECT id FROM projects WHERE id=? OR parent_project_id=?')
      .all(id, id)
      .map((r) => r.id);
    const ph = familyIds.map(() => '?').join(',');

    const to = todayKey();
    const from = addDays(to, -29);
    const sessions = db
      .prepare(`${SESSION_SELECT} WHERE s.project_id IN (${ph}) ORDER BY s.started_at DESC LIMIT 200`)
      .all(...familyIds)
      .map(sessionRow);
    const totalsRow = db
      .prepare(
        `SELECT count(*) n, coalesce(sum(claude_ms),0) cms, coalesce(sum(user_active_ms),0) ums,
                coalesce(sum(prompt_count),0) pc, coalesce(sum(est_cost_usd),0) cost,
                coalesce(sum(subagent_count),0) agents
           FROM sessions WHERE project_id IN (${ph})`
      )
      .get(...familyIds);

    const [fromMs] = dayBounds(from);
    const [, toMs] = dayBounds(to);
    const turnRows = db
      .prepare(
        `SELECT date(t.started_at/1000,'unixepoch','localtime') d, sum(t.claude_ms) c, count(*) n
           FROM turns t JOIN sessions s ON s.id=t.session_id
          WHERE s.project_id IN (${ph}) AND t.started_at>=? AND t.started_at<? GROUP BY d`
      )
      .all(...familyIds, fromMs, toMs);
    const byDay = new Map(turnRows.map((r) => [r.d, r]));
    const daily = [];
    for (let day = from, i = 0; day <= to && i < MAX_RANGE_DAYS; day = addDays(day, 1), i++) {
      const r = byDay.get(day);
      daily.push({ date: day, claudeMs: r?.c ?? 0, turns: r?.n ?? 0 });
    }
    ok(res, {
      project: { id: p.id, path: p.path, name: p.name, parentProjectId: p.parent_project_id, worktreeBranch: p.worktree_branch },
      // "latest changes" prose (generated on demand from the project page);
      // included here so the cloud mirror carries it with the project snapshot
      changesSummary: summaryRow(db, p.path, familyIds),
      worktreeCount: familyIds.length - 1,
      totals: {
        sessions: totalsRow.n,
        claudeMs: totalsRow.cms,
        userActiveMs: totalsRow.ums,
        prompts: totalsRow.pc,
        estCostUsd: totalsRow.cost,
        subagents: totalsRow.agents,
      },
      daily,
      sessions,
    });
  });

  app.get('/api/sessions', (req, res) => {
    const page = Math.max(Number(req.query.page) || 0, 0);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 200);
    const where = [];
    const args = [];
    if (req.query.project) { where.push('s.project_id=?'); args.push(Number(req.query.project)); }
    if (req.query.from && DAY_RE.test(String(req.query.from))) {
      where.push('s.started_at>=?'); args.push(dayBounds(String(req.query.from))[0]);
    }
    if (req.query.to && DAY_RE.test(String(req.query.to))) {
      where.push('s.started_at<?'); args.push(dayBounds(String(req.query.to))[1]);
    }
    const sort = { recent: 's.started_at DESC', duration: 's.claude_ms DESC', cost: 's.est_cost_usd DESC' }[String(req.query.sort ?? 'recent')] ?? 's.started_at DESC';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT count(*) c FROM sessions s ${whereSql}`).get(...args).c;
    const rows = db
      .prepare(`${SESSION_SELECT} ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, page * pageSize)
      .map(sessionRow);
    ok(res, { total, page, pageSize, rows });
  });

  app.get('/api/sessions/:id', (req, res) => {
    const id = String(req.params.id);
    const r = db.prepare(`${SESSION_SELECT} WHERE s.id=?`).get(id);
    if (!r) return bad(res, 'session not found', 404);
    const turns = db
      .prepare(
        `SELECT t.started_at, t.ended_at, t.claude_ms, t.event_count, t.tool_use_count,
                t.input_tokens, t.output_tokens, t.cache_read_tokens, t.cache_create_tokens,
                t.est_cost_usd, t.prompt_uuid
           FROM turns t WHERE t.session_id=? ORDER BY t.started_at`
      )
      .all(id)
      .map((t) => ({
        start: t.started_at, end: t.ended_at, claudeMs: t.claude_ms, eventCount: t.event_count,
        toolUseCount: t.tool_use_count, inputTokens: t.input_tokens, outputTokens: t.output_tokens,
        cacheReadTokens: t.cache_read_tokens, cacheWriteTokens: t.cache_create_tokens,
        estCostUsd: t.est_cost_usd, promptUuid: t.prompt_uuid,
      }));
    const prompts = db
      .prepare('SELECT uuid, ts, kind, command_name, text, char_count FROM prompts WHERE session_id=? ORDER BY ts')
      .all(id)
      .map((p) => ({ uuid: p.uuid, ts: p.ts, kind: p.kind, commandName: p.command_name, text: p.text, charCount: p.char_count }));
    const agents = db
      .prepare('SELECT * FROM agent_runs WHERE session_id=? ORDER BY first_ts')
      .all(id)
      .map((a) => ({
        agentId: a.agent_id, agentType: a.agent_type, model: a.resolved_model, status: a.status,
        firstTs: a.first_ts, lastTs: a.last_ts,
        durationMs: a.duration_ms ?? (a.first_ts != null && a.last_ts != null ? a.last_ts - a.first_ts : null),
        inputTokens: a.input_tokens, outputTokens: a.output_tokens,
        toolUseCount: a.tool_use_count, estCostUsd: a.est_cost_usd,
        toolStats: safeJsonParse(a.tool_stats ?? '') ?? null,
      }));
    const toolBreakdown = db
      .prepare(
        'SELECT tool_name name, sum(tool_use_count) count FROM events WHERE session_id=? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC'
      )
      .all(id);
    const skills = db
      .prepare(
        'SELECT attr_skill name, count(*) count FROM events WHERE session_id=? AND attr_skill IS NOT NULL GROUP BY attr_skill ORDER BY count DESC'
      )
      .all(id);
    const efforts = db
      .prepare("SELECT effort, count(*) c FROM events WHERE session_id=? AND effort IS NOT NULL GROUP BY effort")
      .all(id)
      .map((e) => e.effort);
    const commits = db
      .prepare('SELECT sha, author_ts ts, message, additions, deletions FROM commits WHERE session_id=? ORDER BY author_ts')
      .all(id)
      .map((c) => ({ sha: c.sha, ts: c.ts, message: c.message, additions: c.additions, deletions: c.deletions }));
    const prStates = Object.fromEntries(
      db.prepare('SELECT url, state, merged_at FROM pr_status WHERE session_id=?').all(id)
        .map((p) => [p.url, { state: p.state, mergedAt: p.merged_at }])
    );
    ok(res, { session: sessionRow(r), turns, prompts, agents, toolBreakdown, skills, efforts, commits, prStates });
  });

  // API/tool failure feed (Insights). History predating this feature fills in
  // after the next reingest.
  app.get('/api/errors', (req, res) => {
    const since = Date.now() - 30 * 24 * 3600_000;
    const byKind = db.prepare('SELECT kind, count(*) n FROM error_events WHERE ts>? GROUP BY kind').all(since);
    const recent = db.prepare(
      `SELECT e.id, e.ts, e.kind, e.snippet, e.session_id, p.name project
         FROM error_events e
         LEFT JOIN sessions s ON s.id=e.session_id LEFT JOIN projects p ON p.id=s.project_id
        WHERE e.ts>? ORDER BY e.id DESC LIMIT 30`
    ).all(since);
    ok(res, {
      apiErrors: byKind.find((k) => k.kind === 'api')?.n ?? 0,
      toolErrors: byKind.find((k) => k.kind === 'tool')?.n ?? 0,
      recent: recent.map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, snippet: r.snippet, sessionId: r.session_id, project: r.project })),
    });
  });

  // claude.ai chat layer (imported via scripts/import-claudeai.mjs) — kept
  // separate from Claude Code stats; exports carry no tokens/cost.
  app.get('/api/claudeai', (req, res) => {
    const totals = /** @type {any} */ (db.prepare(
      'SELECT count(*) chats, coalesce(sum(messages),0) messages, coalesce(sum(human_messages),0) humanMessages, max(last_ts) lastTs FROM claudeai_chats'
    ).get());
    const since = Date.now() - 30 * 24 * 3600_000;
    const days = db.prepare(
      `SELECT date(last_ts/1000,'unixepoch','localtime') d, count(*) chats, sum(messages) messages
         FROM claudeai_chats WHERE last_ts>? GROUP BY d ORDER BY d`
    ).all(since);
    const recent = db.prepare('SELECT uuid, name, last_ts, messages FROM claudeai_chats ORDER BY last_ts DESC LIMIT 8').all();
    ok(res, {
      chats: totals.chats,
      messages: totals.messages,
      humanMessages: totals.humanMessages,
      lastTs: totals.lastTs,
      days: days.map((r) => ({ date: r.d, chats: r.chats, messages: r.messages ?? 0 })),
      recent: recent.map((r) => ({ uuid: r.uuid, name: r.name, lastTs: r.last_ts, messages: r.messages })),
    });
  });

  // Token-economics flow (Insights sankey): per-model input composition and
  // output over a range, plus what caching saved vs paying full input rates.
  app.get('/api/token-flow', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = Date.now() - days * 24 * 3600_000;
    const rows = db.prepare(
      `SELECT model, sum(input_tokens) fresh, sum(cache_read_tokens) cacheRead,
              sum(cache_create_5m) cw5, sum(cache_create_1h) cw1, sum(output_tokens) outTok
         FROM events WHERE ts>? AND usage_credited=1 AND model IS NOT NULL
        GROUP BY model ORDER BY outTok DESC`
    ).all(since);
    let savedUsd = 0;
    const models = rows.map((r) => {
      const rates = ratesFor(r.model);
      if (rates) {
        // reads billed at 0.1× input; the "saving" is the other 0.9×
        savedUsd += (r.cacheRead / 1_000_000) * rates.input * 0.9;
      }
      return {
        model: r.model,
        freshInput: r.fresh ?? 0,
        cacheRead: r.cacheRead ?? 0,
        cacheWrite: (r.cw5 ?? 0) + (r.cw1 ?? 0),
        output: r.outTok ?? 0,
      };
    });
    ok(res, { days, models, savedUsd });
  });

  /* ── session tags & notes (user data, survives reingest) ──────────── */
  const TAG_VOCAB = ['bugfix', 'feature', 'refactor', 'exploration', 'infra', 'docs', 'review', 'wasted'];

  app.put('/api/sessions/:id/meta', (req, res) => {
    const sid = String(req.params.id);
    if (!db.prepare('SELECT id FROM sessions WHERE id=?').get(sid)) return bad(res, 'unknown session', 404);
    const b = req.body ?? {};
    const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => String(t).toLowerCase().slice(0, 24)))].slice(0, 8) : [];
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.slice(0, 2000) : null;
    db.prepare(
      `INSERT INTO session_meta(session_id, tags, note, updated_at) VALUES(?,?,?,?)
       ON CONFLICT(session_id) DO UPDATE SET tags=excluded.tags, note=excluded.note, updated_at=excluded.updated_at`
    ).run(sid, JSON.stringify(tags), note, Date.now());
    ok(res, { tags, note });
  });

  // Suggest up to 3 tags from the fixed vocabulary via a one-shot haiku call.
  app.post('/api/sessions/:id/autotag', async (req, res) => {
    const sid = String(req.params.id);
    const s = /** @type {any} */ (db.prepare('SELECT title, last_prompt FROM sessions WHERE id=?').get(sid));
    if (!s) return bad(res, 'unknown session', 404);
    const prompts = db.prepare("SELECT substr(text,1,200) t FROM prompts WHERE session_id=? AND kind IN ('typed','command') ORDER BY ts LIMIT 12").all(sid);
    try {
      const out = await runClaude(
        `Classify this Claude Code session with 1-3 tags from EXACTLY this list: ${TAG_VOCAB.join(', ')}.\n` +
        'Output ONLY the tags, comma-separated, nothing else.\n\n' +
        `Title: ${s.title ?? s.last_prompt ?? 'untitled'}\nPrompts:\n${prompts.map((p) => `- ${p.t}`).join('\n')}`,
        { timeoutMs: 60_000 }
      );
      const tags = out.toLowerCase().split(/[,\n]/).map((t) => t.trim()).filter((t) => TAG_VOCAB.includes(t)).slice(0, 3);
      ok(res, { suggestions: tags });
    } catch (e) {
      bad(res, e instanceof Error ? e.message : String(e), 500);
    }
  });

  // Cost spike explainer: decompose one day's est. cost into sessions, model
  // mix, and cache economics, with plain-English findings.
  app.get('/api/cost-explain', (req, res) => {
    const date = dayParam(req.query.date);
    const [a, b] = dayBounds(date);
    const sessions = db.prepare(
      `SELECT t.session_id, sum(t.est_cost_usd) cost, sum(t.output_tokens) outTok, count(*) turns,
              s.title, s.last_prompt, s.subagent_count, p.name project
         FROM turns t JOIN sessions s ON s.id=t.session_id JOIN projects p ON p.id=s.project_id
        WHERE t.started_at>=? AND t.started_at<? GROUP BY t.session_id ORDER BY cost DESC`
    ).all(a, b);
    const models = db.prepare(
      `SELECT model, sum(output_tokens) outTok, sum(input_tokens) inTok, sum(cache_read_tokens) cacheRead,
              sum(cache_create_5m + cache_create_1h) cacheWrite, count(*) calls
         FROM events WHERE ts>=? AND ts<? AND usage_credited=1 AND model IS NOT NULL GROUP BY model ORDER BY outTok DESC`
    ).all(a, b);
    const total = sessions.reduce((t, s) => t + (s.cost ?? 0), 0);
    // baseline: median daily cost over the prior 14 days
    const prior = db.prepare(
      `SELECT date(started_at/1000,'unixepoch','localtime') d, sum(est_cost_usd) c
         FROM turns WHERE started_at>=? AND started_at<? GROUP BY d ORDER BY c`
    ).all(a - 14 * 24 * 3600_000, a);
    const median = prior.length ? prior[Math.floor(prior.length / 2)].c : 0;

    const findings = [];
    if (median > 0) {
      const ratio = total / median;
      if (ratio > 1.4) findings.push(`This day ran ${ratio.toFixed(1)}× your 14-day median ($${median.toFixed(0)}).`);
      else if (ratio < 0.6) findings.push(`A quiet day — ${Math.round(ratio * 100)}% of your 14-day median.`);
    }
    if (sessions.length > 0 && total > 0) {
      const top = sessions[0];
      const share = (top.cost / total) * 100;
      if (share > 45) findings.push(`One session — “${(top.title ?? top.last_prompt ?? 'untitled').slice(0, 60)}” (${top.project}) — was ${Math.round(share)}% of the day.`);
    }
    const cacheRead = models.reduce((t, m) => t + m.cacheRead, 0);
    const cacheWrite = models.reduce((t, m) => t + m.cacheWrite, 0);
    if (cacheWrite > 0 && cacheRead / Math.max(cacheWrite, 1) < 3) {
      findings.push('Cache writes were high relative to reads — lots of fresh context (new sessions or heavy compaction) instead of cheap cache hits.');
    }
    const subagentHeavy = sessions.filter((s) => (s.subagent_count ?? 0) > 5).length;
    if (subagentHeavy > 0) findings.push(`${subagentHeavy} session(s) fanned out 6+ subagents — parallel agents multiply token spend.`);

    ok(res, {
      date,
      totalUsd: total,
      medianUsd: median,
      findings,
      sessions: sessions.slice(0, 8).map((s) => ({
        sessionId: s.session_id,
        title: s.title ?? s.last_prompt ?? 'untitled',
        project: s.project,
        costUsd: s.cost ?? 0,
        outputTokens: s.outTok ?? 0,
        turns: s.turns,
        subagents: s.subagent_count ?? 0,
      })),
      models: models.map((m) => ({
        model: m.model,
        outputTokens: m.outTok ?? 0,
        cacheReadTokens: m.cacheRead ?? 0,
        cacheWriteTokens: m.cacheWrite ?? 0,
        calls: m.calls,
      })),
    });
  });

  // PR outcomes across all sessions (Insights card)
  app.get('/api/prs', (req, res) => {
    const since = Date.now() - 30 * 24 * 3600_000;
    const rows = db.prepare(
      `SELECT p.url, p.repo, p.number, p.title, p.state, p.merged_at, p.additions, p.deletions, p.session_id,
              s.started_at
         FROM pr_status p LEFT JOIN sessions s ON s.id=p.session_id
        WHERE s.started_at IS NULL OR s.started_at > ?
        ORDER BY COALESCE(s.started_at, 0) DESC LIMIT 60`
    ).all(since);
    const opened = rows.length;
    const merged = rows.filter((r) => r.state === 'MERGED').length;
    ok(res, {
      opened,
      merged,
      open: rows.filter((r) => r.state === 'OPEN').length,
      rows: rows.map((r) => ({
        url: r.url, repo: r.repo, number: r.number, title: r.title, state: r.state,
        mergedAt: r.merged_at, additions: r.additions, deletions: r.deletions,
        sessionId: r.session_id, sessionStartedAt: r.started_at,
      })),
    });
  });

  app.post('/api/sessions/:id/star', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT 1 FROM sessions WHERE id=?').get(id)) return bad(res, 'session not found', 404);
    db.prepare('INSERT OR REPLACE INTO starred(session_id, ts) VALUES(?,?)').run(id, Date.now());
    ctx.sse.broadcast('data-changed', { starred: true });
    ok(res, { starred: true });
  });

  app.delete('/api/sessions/:id/star', (req, res) => {
    db.prepare('DELETE FROM starred WHERE session_id=?').run(String(req.params.id));
    ctx.sse.broadcast('data-changed', { starred: true });
    ok(res, { starred: false });
  });

  // Conversation replay: lazily read the transcript and return an interleaved
  // digest — prompts, Claude's visible replies (capped), and condensed tool
  // activity. The DB never stores assistant text; this is the on-demand path.
  app.get('/api/sessions/:id/replay', async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const s = db.prepare('SELECT transcript_path FROM sessions WHERE id=?').get(id);
      if (!s) return bad(res, 'session not found', 404);
      if (!s.transcript_path || !fs.existsSync(String(s.transcript_path))) {
        return ok(res, { items: [], truncated: false, missing: true });
      }
      const MAX_ITEMS = 800;
      const items = [];
      let truncated = false;
      for await (const { text } of readLines(String(s.transcript_path), 0)) {
        if (items.length >= MAX_ITEMS) { truncated = true; break; }
        const obj = safeJsonParse(text);
        if (!obj || obj.sessionId !== id) continue; // fork files carry foreign lines
        const { kind } = classifyLine(obj);
        const ts = tsMs(obj);
        if (ts == null) continue;
        if (kind === 'prompt' || kind === 'command') {
          const { text: ptext } = extractPrompt(obj, kind);
          items.push({ kind: 'prompt', ts, promptUuid: obj.uuid ?? null, text: ptext.slice(0, 2000) });
        } else if (kind === 'assistant') {
          const meta = assistantMeta(obj);
          if (meta.toolUseCount > 0 && meta.toolName) {
            const last = items[items.length - 1];
            if (last?.kind === 'tools') last.tools[meta.toolName] = (last.tools[meta.toolName] ?? 0) + meta.toolUseCount;
            else items.push({ kind: 'tools', ts, tools: { [meta.toolName]: meta.toolUseCount } });
          }
          // code diffs: Edit/Write/MultiEdit inputs are the session's real story.
          // Read on demand from the transcript, hard-truncated — never persisted.
          const editBlocks = Array.isArray(obj.message?.content) ? obj.message.content : [];
          for (const b of editBlocks) {
            if (!b || b.type !== 'tool_use' || !b.input?.file_path) continue;
            const CAP = 1400;
            let edits = null;
            if (b.name === 'Edit' && typeof b.input.old_string === 'string') {
              edits = [{ old: b.input.old_string.slice(0, CAP), new: String(b.input.new_string ?? '').slice(0, CAP) }];
            } else if (b.name === 'Write' && typeof b.input.content === 'string') {
              edits = [{ old: null, new: b.input.content.slice(0, CAP) }];
            } else if (b.name === 'MultiEdit' && Array.isArray(b.input.edits)) {
              edits = b.input.edits.slice(0, 6).map((e) => ({
                old: String(e?.old_string ?? '').slice(0, CAP),
                new: String(e?.new_string ?? '').slice(0, CAP),
              }));
            }
            if (edits) items.push({ kind: 'edit', ts, file: String(b.input.file_path).slice(0, 260), tool: b.name, edits });
          }
          if (meta.charCount > 0) {
            const blocks = Array.isArray(obj.message?.content) ? obj.message.content : [];
            const out = blocks
              .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text)
              .join('\n')
              .trim();
            if (out) {
              const last = items[items.length - 1];
              if (last?.kind === 'reply' && last.text.length < 1500) last.text = `${last.text}\n${out}`.slice(0, 1500);
              else items.push({ kind: 'reply', ts, text: out.slice(0, 1500) });
            }
          }
        }
      }
      ok(res, { items, truncated });
    } catch (e) {
      next(e);
    }
  });

  app.get('/api/prompts', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const page = Math.max(Number(req.query.page) || 0, 0);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 200);
    const where = [];
    const args = [];
    if (req.query.project) { where.push('p.project_id=?'); args.push(Number(req.query.project)); }
    if (req.query.kind && ['typed', 'command', 'legacy'].includes(String(req.query.kind))) {
      where.push('p.kind=?'); args.push(String(req.query.kind));
    }
    if (req.query.from && DAY_RE.test(String(req.query.from))) { where.push('p.ts>=?'); args.push(dayBounds(String(req.query.from))[0]); }
    if (req.query.to && DAY_RE.test(String(req.query.to))) { where.push('p.ts<?'); args.push(dayBounds(String(req.query.to))[1]); }

    const select = `p.uuid, p.ts, p.session_id, p.project_id, p.kind, p.command_name,
      substr(p.text,1,500) text, p.char_count, pr.name project_name, s.title session_title`;
    const joins = `LEFT JOIN projects pr ON pr.id=p.project_id LEFT JOIN sessions s ON s.id=p.session_id`;

    const respond = (total, rows, mode) => ok(res, {
      total, page, pageSize, mode,
      rows: rows.map((r) => ({
        uuid: r.uuid, ts: r.ts, sessionId: r.session_id, projectId: r.project_id,
        projectName: r.project_name, sessionTitle: r.session_title, kind: r.kind,
        commandName: r.command_name, text: r.text, charCount: r.char_count,
        snippet: r.snip ?? null,
      })),
    });

    if (!q) {
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT count(*) c FROM prompts p ${whereSql}`).get(...args).c;
      const rows = db
        .prepare(`SELECT ${select} FROM prompts p ${joins} ${whereSql} ORDER BY p.ts DESC LIMIT ? OFFSET ?`)
        .all(...args, pageSize, page * pageSize);
      return respond(total, rows, 'recent');
    }

    // FTS5: quote every token so user input can't inject query syntax.
    const match = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`).join(' ');
    try {
      const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
      const total = db
        .prepare(`SELECT count(*) c FROM prompts_fts f JOIN prompts p ON p.rowid=f.rowid WHERE prompts_fts MATCH ? ${whereSql}`)
        .get(match, ...args).c;
      const rows = db
        .prepare(
          `SELECT ${select}, snippet(prompts_fts, 0, char(1), char(2), ' … ', 24) snip
             FROM prompts_fts f JOIN prompts p ON p.rowid=f.rowid ${joins}
            WHERE prompts_fts MATCH ? ${whereSql} ORDER BY p.ts DESC LIMIT ? OFFSET ?`
        )
        .all(match, ...args, pageSize, page * pageSize);
      return respond(total, rows, 'fts');
    } catch {
      // LIKE fallback for anything FTS rejects
      const like = `%${q.replace(/[%_]/g, (c) => '\\' + c)}%`;
      const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
      const total = db
        .prepare(`SELECT count(*) c FROM prompts p WHERE p.text LIKE ? ESCAPE '\\' ${whereSql}`)
        .get(like, ...args).c;
      const rows = db
        .prepare(
          `SELECT ${select} FROM prompts p ${joins} WHERE p.text LIKE ? ESCAPE '\\' ${whereSql} ORDER BY p.ts DESC LIMIT ? OFFSET ?`
        )
        .all(like, ...args, pageSize, page * pageSize);
      return respond(total, rows, 'like');
    }
  });
}
