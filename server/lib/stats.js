// Query-time analytics over the small derived tables (turns/prompts/sessions/
// agent_runs). Interval math runs in JS — a few hundred turns — so every
// request recomputes fresh; no rollup tables to invalidate.
import { mergeIntervals, sumIntervals, clipInterval, dayBounds, localDayKey, addDays, todayKey } from './util.js';
import { timingSettings } from './aggregate.js';
import { estimateCost } from './pricing.js';

/** All turns + between-turn review gaps (user-active intervals), per session. */
export function activityData(db) {
  const turns = db
    .prepare('SELECT session_id, started_at, ended_at, claude_ms, est_cost_usd, output_tokens, input_tokens FROM turns ORDER BY session_id, started_at')
    .all();
  const { idleMs } = timingSettings(db);
  const gaps = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const a = turns[i];
    const b = turns[i + 1];
    if (a.session_id !== b.session_id) continue;
    const gap = b.started_at - a.ended_at;
    if (gap > 0 && gap <= idleMs) gaps.push({ session_id: a.session_id, start: a.ended_at, end: b.started_at });
  }
  return { turns, gaps };
}

function pushDayClipped(bucketFor, iv, key) {
  // an interval spans at most a couple of local days (gaps are idle-capped)
  let day = localDayKey(iv.start);
  const lastDay = localDayKey(iv.end);
  for (;;) {
    const [a, b] = dayBounds(day);
    const clipped = clipInterval(iv, a, b);
    if (clipped) bucketFor(day)[key].push(clipped);
    if (day === lastDay) break;
    day = addDays(day, 1);
  }
}

/**
 * Per-local-day activity between fromDay..toDay inclusive.
 * Returns array of {date, claudeMs, userActiveMs, wallMs, prompts, turns,
 * sessions, estCostUsd, outputTokens, subagentMs} with zero-filled days.
 */
export function rangeDaily(db, fromDay, toDay) {
  const [fromMs] = dayBounds(fromDay);
  const [, toMs] = dayBounds(toDay);
  const { turns, gaps } = activityData(db);

  /** @type {Map<string, any>} */
  const days = new Map();
  const bucketFor = (day) => {
    let d = days.get(day);
    if (!d) {
      d = { claudeMs: 0, turns: 0, estCostUsd: 0, outputTokens: 0, sessions: new Set(), user: [], work: [], subagentMs: 0 };
      days.set(day, d);
    }
    return d;
  };

  for (const t of turns) {
    if (t.started_at < fromMs || t.started_at >= toMs) {
      // still contribute the wall interval if it overlaps the range
      if (t.ended_at > fromMs && t.started_at < toMs) pushDayClipped(bucketFor, { start: t.started_at, end: t.ended_at }, 'work');
      continue;
    }
    const d = bucketFor(localDayKey(t.started_at));
    d.claudeMs += t.claude_ms;
    d.turns += 1;
    d.estCostUsd += t.est_cost_usd || 0;
    d.outputTokens += t.output_tokens || 0;
    d.sessions.add(t.session_id);
    pushDayClipped(bucketFor, { start: t.started_at, end: t.ended_at }, 'work');
  }
  for (const g of gaps) {
    if (g.end <= fromMs || g.start >= toMs) continue;
    pushDayClipped(bucketFor, g, 'user');
  }

  const promptRows = db
    .prepare(
      "SELECT date(ts/1000,'unixepoch','localtime') d, count(*) c FROM prompts WHERE ts>=? AND ts<? GROUP BY d"
    )
    .all(fromMs, toMs);
  const promptsByDay = new Map(promptRows.map((r) => [r.d, r.c]));

  const agentRows = db
    .prepare(
      `SELECT date(first_ts/1000,'unixepoch','localtime') d,
              sum(coalesce(duration_ms, last_ts-first_ts, 0)) ms
         FROM agent_runs WHERE first_ts>=? AND first_ts<? GROUP BY d`
    )
    .all(fromMs, toMs);
  const agentByDay = new Map(agentRows.map((r) => [r.d, r.ms]));

  const out = [];
  for (let day = fromDay; ; day = addDays(day, 1)) {
    const d = days.get(day);
    const userIv = d ? mergeIntervals(d.user) : [];
    const wallIv = d ? mergeIntervals([...d.work, ...d.user]) : [];
    out.push({
      date: day,
      claudeMs: d ? Math.round(d.claudeMs) : 0,
      userActiveMs: Math.round(sumIntervals(userIv)),
      wallMs: Math.round(sumIntervals(wallIv)),
      prompts: promptsByDay.get(day) ?? 0,
      turns: d ? d.turns : 0,
      sessions: d ? d.sessions.size : 0,
      estCostUsd: d ? round2(d.estCostUsd) : 0,
      outputTokens: d ? d.outputTokens : 0,
      subagentMs: agentByDay.get(day) ?? 0,
    });
    if (day === toDay) break;
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Daily series merged with legacy (pre-transcript) counts, for the heatmap. */
export function heatmapDays(db, fromDay, toDay) {
  const daily = rangeDaily(db, fromDay, toDay);
  const legacyRows = db.prepare('SELECT * FROM legacy_daily WHERE date>=? AND date<=?').all(fromDay, toDay);
  const legacy = new Map(legacyRows.map((r) => [r.date, r]));
  return daily.map((d) => {
    const lg = legacy.get(d.date);
    const isLegacy = !!lg && d.claudeMs === 0;
    return {
      date: d.date,
      claudeMs: d.claudeMs,
      userActiveMs: d.userActiveMs,
      prompts: d.prompts,
      sessions: isLegacy ? (lg.session_count ?? 0) : d.sessions,
      messages: isLegacy ? (lg.message_count ?? 0) : null,
      legacy: isLegacy,
    };
  });
}

/** Earliest day with any recorded activity (events, prompts, or legacy). */
export function firstActivityDay(db) {
  const evTs = db.prepare('SELECT min(ts) t FROM events').get()?.t ?? null;
  const prTs = db.prepare('SELECT min(ts) t FROM prompts').get()?.t ?? null;
  const lg = db.prepare('SELECT min(date) d FROM legacy_daily').get()?.d ?? null;
  const candidates = [];
  if (evTs) candidates.push(localDayKey(evTs));
  if (prTs) candidates.push(localDayKey(prTs));
  if (lg) candidates.push(lg);
  return candidates.length ? candidates.sort()[0] : todayKey();
}

/** Streaks + personal records across the whole recorded history. */
export function records(db) {
  const from = firstActivityDay(db);
  const today = todayKey();
  const series = heatmapDays(db, from, today);
  const isActive = (d) => d.claudeMs > 0 || d.prompts > 0 || (d.messages ?? 0) > 0;

  let longest = 0;
  let cur = 0;
  let busiest = null;
  let mostPrompts = null;
  let biggestTokens = null;
  const dailyFull = rangeDaily(db, from, today);
  for (let i = 0; i < series.length; i++) {
    const d = series[i];
    if (isActive(d)) {
      cur += 1;
      if (cur > longest) longest = cur;
    } else {
      cur = 0;
    }
    if (!busiest || d.claudeMs > busiest.claudeMs) busiest = d;
    if (!mostPrompts || d.prompts > mostPrompts.prompts) mostPrompts = d;
    const df = dailyFull[i];
    if (!biggestTokens || df.outputTokens > biggestTokens.outputTokens) biggestTokens = df;
  }
  // current streak: run ending today (or yesterday when today is quiet so far)
  let current = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (isActive(series[i])) current++;
    else if (i === series.length - 1) continue; // today inactive doesn't break the streak yet
    else break;
  }
  const longestSession = db
    .prepare(
      `SELECT s.id, s.title, s.claude_ms, s.started_at, p.name project FROM sessions s
        JOIN projects p ON p.id=s.project_id ORDER BY s.claude_ms DESC LIMIT 1`
    )
    .get();
  return {
    currentStreak: current,
    longestStreak: longest,
    busiestDay: busiest ? { date: busiest.date, claudeMs: busiest.claudeMs } : null,
    mostPromptsDay: mostPrompts ? { date: mostPrompts.date, prompts: mostPrompts.prompts } : null,
    biggestTokenDay: biggestTokens ? { date: biggestTokens.date, outputTokens: biggestTokens.outputTokens } : null,
    longestSession: longestSession
      ? { sessionId: longestSession.id, title: longestSession.title, project: longestSession.project, claudeMs: longestSession.claude_ms, startedAt: longestSession.started_at }
      : null,
  };
}

/** Hour-of-day histogram (local) over a ms range. */
export function hourHistogram(db, fromMs, toMs) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, prompts: 0, claudeMs: 0 }));
  const promptRows = db
    .prepare(
      "SELECT CAST(strftime('%H', ts/1000,'unixepoch','localtime') AS INTEGER) h, count(*) c FROM prompts WHERE ts>=? AND ts<? GROUP BY h"
    )
    .all(fromMs, toMs);
  for (const r of promptRows) buckets[r.h].prompts = r.c;
  const turnRows = db
    .prepare('SELECT started_at, claude_ms FROM turns WHERE started_at>=? AND started_at<?')
    .all(fromMs, toMs);
  for (const t of turnRows) buckets[new Date(t.started_at).getHours()].claudeMs += t.claude_ms;
  return buckets;
}

/** Token/cost split per model: main-transcript credited events + subagent runs. */
export function modelSplit(db, fromMs, toMs) {
  /** @type {Map<string, any>} */
  const byModel = new Map();
  const bucket = (model) => {
    let m = byModel.get(model);
    if (!m) {
      m = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estCostUsd: 0, unpriced: false, messages: 0 };
      byModel.set(model, m);
    }
    return m;
  };
  const evRows = db
    .prepare(
      `SELECT model, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr,
              sum(cache_create_5m) c5, sum(cache_create_1h) c1, count(*) n
         FROM events WHERE usage_credited=1 AND ts>=? AND ts<? AND model IS NOT NULL GROUP BY model`
    )
    .all(fromMs, toMs);
  for (const r of evRows) {
    const m = bucket(r.model);
    addUsage(m, r.i, r.o, r.cr, r.c5, r.c1, r.n);
  }
  const agRows = db
    .prepare(
      `SELECT resolved_model model, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr,
              sum(cache_create_5m_tokens) c5, sum(cache_create_1h_tokens) c1, count(*) n
         FROM agent_runs WHERE first_ts>=? AND first_ts<? AND resolved_model IS NOT NULL GROUP BY resolved_model`
    )
    .all(fromMs, toMs);
  for (const r of agRows) {
    const m = bucket(r.model);
    addUsage(m, r.i, r.o, r.cr, r.c5, r.c1, r.n);
  }
  return [...byModel.values()].sort((a, b) => b.estCostUsd - a.estCostUsd);

  function addUsage(m, i, o, cr, c5, c1, n) {
    m.inputTokens += i || 0;
    m.outputTokens += o || 0;
    m.cacheReadTokens += cr || 0;
    m.cacheWriteTokens += (c5 || 0) + (c1 || 0);
    m.messages += n || 0;
    const c = estimateCost(m.model, { input: i || 0, output: o || 0, cacheRead: cr || 0, cache5m: c5 || 0, cache1h: c1 || 0 });
    if (c.cost != null) m.estCostUsd = round2(m.estCostUsd + c.cost);
    else m.unpriced = true;
  }
}

/** Tool call counts: main-transcript tool_use blocks + subagent toolStats rollups. */
export function toolUsage(db, fromMs, toMs) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  const add = (name, n) => { if (n) counts.set(name, (counts.get(name) ?? 0) + n); };
  const evRows = db
    .prepare(
      'SELECT tool_name, sum(tool_use_count) c FROM events WHERE tool_name IS NOT NULL AND ts>=? AND ts<? GROUP BY tool_name'
    )
    .all(fromMs, toMs);
  for (const r of evRows) add(r.tool_name, r.c);

  let linesAdded = 0;
  let linesRemoved = 0;
  const agRows = db
    .prepare('SELECT tool_stats FROM agent_runs WHERE first_ts>=? AND first_ts<? AND tool_stats IS NOT NULL')
    .all(fromMs, toMs);
  for (const r of agRows) {
    try {
      const ts = JSON.parse(r.tool_stats);
      add('Read', ts.readCount);
      add('Bash', ts.bashCount);
      add('Edit', ts.editFileCount);
      add('Search', ts.searchCount);
      add('(other)', ts.otherToolCount);
      linesAdded += ts.linesAdded || 0;
      linesRemoved += ts.linesRemoved || 0;
    } catch { /* ignore */ }
  }
  const tools = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { tools, linesAdded, linesRemoved };
}

/** Skill/plugin attribution counts from assistant events. */
export function skillUsage(db, fromMs, toMs) {
  const skills = db
    .prepare(
      'SELECT attr_skill name, count(*) c FROM events WHERE attr_skill IS NOT NULL AND ts>=? AND ts<? GROUP BY attr_skill ORDER BY c DESC LIMIT 30'
    )
    .all(fromMs, toMs)
    .map((r) => ({ name: r.name, count: r.c }));
  const plugins = db
    .prepare(
      'SELECT attr_plugin name, count(*) c FROM events WHERE attr_plugin IS NOT NULL AND ts>=? AND ts<? GROUP BY attr_plugin ORDER BY c DESC LIMIT 30'
    )
    .all(fromMs, toMs)
    .map((r) => ({ name: r.name, count: r.c }));
  return { skills, plugins };
}

/** Per-project rollup for a ms range (or all time when range is null). */
export function projectSplit(db, fromMs = null, toMs = null) {
  const where = fromMs != null ? 'WHERE t.started_at>=? AND t.started_at<?' : '';
  const args = fromMs != null ? [fromMs, toMs] : [];
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.parent_project_id, p.worktree_branch,
              sum(t.claude_ms) claudeMs, count(t.id) turns, sum(t.est_cost_usd) estCostUsd,
              count(DISTINCT t.session_id) sessions
         FROM turns t JOIN sessions s ON s.id=t.session_id JOIN projects p ON p.id=s.project_id
         ${where} GROUP BY p.id ORDER BY claudeMs DESC`
    )
    .all(...args);
  const promptWhere = fromMs != null ? 'WHERE pr.ts>=? AND pr.ts<?' : '';
  const promptRows = db
    .prepare(
      `SELECT pr.project_id id, count(*) c FROM prompts pr ${promptWhere} GROUP BY pr.project_id`
    )
    .all(...args);
  const promptsBy = new Map(promptRows.map((r) => [r.id, r.c]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentProjectId: r.parent_project_id,
    worktreeBranch: r.worktree_branch,
    claudeMs: r.claudeMs ?? 0,
    turns: r.turns,
    sessions: r.sessions,
    prompts: promptsBy.get(r.id) ?? 0,
    estCostUsd: round2(r.estCostUsd ?? 0),
  }));
}

/** Day-view payload: sessions with clipped turn blocks, review gaps, prompt markers. */
export function timelineDay(db, dayKey) {
  const [a, b] = dayBounds(dayKey);
  const turnRows = db
    .prepare(
      `SELECT t.session_id, t.started_at, t.ended_at, t.claude_ms, t.tool_use_count, t.prompt_uuid,
              substr(p.text, 1, 200) prompt_text
         FROM turns t LEFT JOIN prompts p ON p.uuid=t.prompt_uuid
        WHERE t.ended_at>? AND t.started_at<? ORDER BY t.started_at`
    )
    .all(a, b);
  const { gaps } = activityData(db);

  /** @type {Map<string, any>} */
  const bySession = new Map();
  for (const t of turnRows) {
    let s = bySession.get(t.session_id);
    if (!s) {
      s = { turns: [], gaps: [], prompts: [] };
      bySession.set(t.session_id, s);
    }
    s.turns.push({
      start: Math.max(t.started_at, a),
      end: Math.min(Math.max(t.ended_at, t.started_at + 1), b),
      contLeft: t.started_at < a,
      contRight: t.ended_at > b,
      claudeMs: t.claude_ms,
      toolUseCount: t.tool_use_count,
      promptUuid: t.prompt_uuid,
      promptText: t.prompt_text,
    });
  }
  for (const g of gaps) {
    const s = bySession.get(g.session_id);
    if (!s) continue;
    const clipped = clipInterval(g, a, b);
    if (clipped) s.gaps.push(clipped);
  }
  const promptRows = db
    .prepare(
      "SELECT session_id, uuid, ts, kind, substr(text,1,200) text FROM prompts WHERE ts>=? AND ts<? AND kind!='legacy' ORDER BY ts"
    )
    .all(a, b);
  for (const p of promptRows) {
    const s = bySession.get(p.session_id);
    if (s) s.prompts.push({ uuid: p.uuid, ts: p.ts, kind: p.kind, text: p.text });
  }

  const ids = [...bySession.keys()];
  const sessions = [];
  if (ids.length) {
    const rows = db
      .prepare(
        `SELECT s.id, s.title, s.last_prompt, s.started_at, s.ended_at, s.project_id,
                p.name project_name, p.parent_project_id, p.worktree_branch
           FROM sessions s JOIN projects p ON p.id=s.project_id
          WHERE s.id IN (${ids.map(() => '?').join(',')})`
      )
      .all(...ids);
    for (const r of rows) {
      const s = bySession.get(r.id);
      sessions.push({
        sessionId: r.id,
        title: r.title,
        lastPrompt: r.last_prompt,
        projectId: r.project_id,
        projectName: r.project_name,
        parentProjectId: r.parent_project_id,
        worktreeBranch: r.worktree_branch,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        turns: s.turns,
        activeGaps: s.gaps,
        prompts: s.prompts,
      });
    }
    sessions.sort((x, y) => (x.turns[0]?.start ?? 0) - (y.turns[0]?.start ?? 0));
  }
  // Legacy prompt-only days (pre-transcript era)
  const legacy = db.prepare('SELECT * FROM legacy_daily WHERE date=?').get(dayKey) ?? null;
  return { date: dayKey, sessions, legacy };
}
