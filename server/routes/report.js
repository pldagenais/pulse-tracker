// Per-project work changelog: date-grouped activity, optional AI-written
// summaries (claude -p, cached in `reports`), and a professional PDF export.
import PDFDocument from 'pdfkit';
import { runClaude } from '../lib/llm.js';
import { dayBounds, addDays, todayKey, localDayKey, safeJsonParse, sha1 } from '../lib/util.js';
import { firstActivityDay } from '../lib/stats.js';
import { log } from '../lib/logger.js';
import { buildDayReview, renderReviewInput, DAY_REVIEW_INSTRUCTIONS, MAX_REVIEW_INPUT_CHARS } from '../lib/review.js';
import { getSetting } from '../lib/db.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const fmtH = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
};
const fmtUsd = (v) => (v >= 1000 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`);

function buildReport(db, projectId, fromDay, toDay) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  const fam = db.prepare('SELECT id, path FROM projects WHERE id=? OR parent_project_id=?').all(projectId, projectId);
  const ids = fam.map((r) => r.id);
  const paths = fam.map((r) => r.path);
  const ph = ids.map(() => '?').join(',');
  const [fromMs] = dayBounds(fromDay);
  const [, toMs] = dayBounds(toDay);

  const sessions = db
    .prepare(
      `SELECT s.id, s.title, s.last_prompt, s.started_at, s.claude_ms, s.user_active_ms,
              s.prompt_count, s.est_cost_usd, s.pr_links, s.subagent_count, p2.worktree_branch,
              (SELECT substr(x.text,1,100) FROM prompts x WHERE x.session_id=s.id ORDER BY x.ts LIMIT 1) first_prompt
         FROM sessions s JOIN projects p2 ON p2.id=s.project_id
        WHERE s.project_id IN (${ph}) AND s.started_at>=? AND s.started_at<?
        ORDER BY s.started_at`
    )
    .all(...ids, fromMs, toMs);

  const lines = new Map();
  for (const r of db
    .prepare(`SELECT session_id, tool_stats FROM agent_runs WHERE session_id IN (SELECT id FROM sessions WHERE project_id IN (${ph})) AND tool_stats IS NOT NULL`)
    .all(...ids)) {
    const ts = safeJsonParse(r.tool_stats);
    if (!ts) continue;
    const cur = lines.get(r.session_id) ?? { added: 0, removed: 0 };
    cur.added += ts.linesAdded || 0;
    cur.removed += ts.linesRemoved || 0;
    lines.set(r.session_id, cur);
  }

  const jph = paths.map(() => '?').join(',');
  const journal = db
    .prepare(`SELECT id, ts, text, source FROM journal WHERE project_path IN (${jph}) AND ts>=? AND ts<? ORDER BY ts`)
    .all(...paths, fromMs, toMs);

  /** @type {Map<string, any>} */
  const byDay = new Map();
  const dayOf = (key) => {
    let d = byDay.get(key);
    if (!d) {
      d = { date: key, sessions: [], journal: [], prompts: 0 };
      byDay.set(key, d);
    }
    return d;
  };
  for (const s of sessions) {
    const l = lines.get(s.id);
    dayOf(localDayKey(s.started_at)).sessions.push({
      id: s.id,
      title: s.title ?? s.last_prompt ?? s.first_prompt ?? 'Untitled session',
      startedAt: s.started_at,
      claudeMs: s.claude_ms,
      promptCount: s.prompt_count,
      estCostUsd: s.est_cost_usd,
      worktreeBranch: s.worktree_branch,
      subagentCount: s.subagent_count,
      prLinks: safeJsonParse(s.pr_links ?? '') ?? [],
      linesAdded: l?.added ?? 0,
      linesRemoved: l?.removed ?? 0,
    });
  }
  for (const j of journal) dayOf(localDayKey(j.ts)).journal.push({ id: j.id, ts: j.ts, text: j.text, source: j.source });
  for (const r of db
    .prepare(
      `SELECT date(ts/1000,'unixepoch','localtime') d, count(*) c FROM prompts WHERE project_id IN (${ph}) AND ts>=? AND ts<? GROUP BY d`
    )
    .all(...ids, fromMs, toMs)) {
    dayOf(r.d).prompts = r.c;
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = {
    sessions: sessions.length,
    claudeMs: sessions.reduce((t, s) => t + s.claude_ms, 0),
    userActiveMs: sessions.reduce((t, s) => t + s.user_active_ms, 0),
    prompts: days.reduce((t, d) => t + d.prompts, 0),
    estCostUsd: sessions.reduce((t, s) => t + (s.est_cost_usd ?? 0), 0),
    linesAdded: [...lines.values()].reduce((t, l) => t + l.added, 0),
    linesRemoved: [...lines.values()].reduce((t, l) => t + l.removed, 0),
    prCount: days.reduce((t, d) => t + d.sessions.reduce((n, s) => n + s.prLinks.length, 0), 0),
  };

  // v bumps when SUMMARIZE_INSTRUCTIONS changes shape — marks old summaries stale
  const inputHash = sha1(
    JSON.stringify({
      v: 2,
      s: sessions.map((s) => `${s.id}:${s.prompt_count}:${s.claude_ms}`),
      j: journal.map((j) => j.id),
    })
  );
  const cached = db
    .prepare('SELECT markdown, input_hash, created_at FROM reports WHERE project_id=? AND period_from=? AND period_to=? ORDER BY created_at DESC LIMIT 1')
    .get(projectId, fromDay, toDay);

  return {
    project: { id: p.id, name: p.name, path: p.path },
    from: fromDay,
    to: toDay,
    totals,
    days,
    inputHash,
    summary: cached
      ? { markdown: cached.markdown, createdAt: cached.created_at, stale: cached.input_hash !== inputHash }
      : null,
  };
}

/** Build the condensed activity log fed to the summarizer. */
function buildAiInput(db, report, ids) {
  const ph = ids.map(() => '?').join(',');
  const parts = [];
  for (const d of report.days) {
    const [a, b] = dayBounds(d.date);
    const promptRows = db
      .prepare(
        `SELECT substr(text,1,400) t FROM prompts WHERE project_id IN (${ph}) AND ts>=? AND ts<? AND kind IN ('typed','command') ORDER BY ts LIMIT 20`
      )
      .all(...ids, a, b);
    const sec = [
      `## ${d.date}`,
      ...d.sessions.map((s) =>
        `Session: ${s.title} (${fmtH(s.claudeMs)} of work, ${s.promptCount} prompts${s.linesAdded ? `, +${s.linesAdded}/-${s.linesRemoved} lines` : ''}${s.prLinks.length ? `, PRs: ${s.prLinks.map((x) => `#${x.number}`).join(' ')}` : ''}${s.worktreeBranch ? `, branch ${s.worktreeBranch}` : ''})`
      ),
      ...(promptRows.length ? ['Prompts:', ...promptRows.map((r) => `- ${r.t.replace(/\s+/g, ' ')}`)] : []),
      ...(d.journal.length ? ['Notes:', ...d.journal.map((j) => `- ${j.text}`)] : []),
    ];
    parts.push(sec.join('\n'));
  }
  let input = parts.join('\n\n');
  if (input.length > 60000) input = `…(earliest days truncated)\n\n${input.slice(input.length - 60000)}`;
  return input;
}

const SUMMARIZE_INSTRUCTIONS = `You are writing a professional, client-facing work changelog from a raw activity log of AI-assisted development sessions.
Output STRICT markdown, nothing else — no preamble, no closing remarks, no code fences.

Group the work by FEATURE CATEGORY, not by date. Identify the major feature areas and themes present in the log (for example: a specific product feature or subsystem, "Reporting & exports", "UI & design", "Infrastructure, performance & fixes") and output one "### <Category name>" heading per area, ordered from most to least significant. Use the log's own domain vocabulary for category names, not generic labels.

Under each category write 3-8 detailed bullet points ("- ..."). Each bullet must:
- start with the date or date range in parentheses, e.g. "(Jul 19)" or "(Jul 19–22)";
- describe the concrete change in past tense AND explain what it does or enables — the capability, workflow, or behavior it adds, and for whom (end users, admins, technicians, etc.) when the log says so;
- be 1-3 full sentences; prefer substance and specifics (named screens, roles, rules, limits, integrations) over brevity.

Merge duplicate or related items across days into a single bullet with a date range. Skip administrative noise (model switches, retries, trivial Q&A). Do not invent work, features, or motivations not present in the log.

Aim for a thorough summary of roughly 400-800 words.

RAW ACTIVITY LOG:
`;

const CHANGES_INSTRUCTIONS = `You are summarizing the latest development work on a software project for the developer returning to it.
Write 2-3 paragraphs of plain prose — no headings, no bullet points, no code fences, no preamble.

Describe the most recent changes concretely: what was built or fixed, what it enables, and where the work concentrated. Use the log's own vocabulary for features and subsystems. Past tense, specific, no filler. Skip administrative noise (model switches, retries, trivial Q&A). Do not invent work not present in the log. Roughly 120-250 words total.

RAW ACTIVITY LOG (most recent work in this project):
`;

/** @type {Map<string, Promise<any>>} */
const inflight = new Map();

/**
 * Freshness for the "latest changes" card: the summary is stale once any
 * session in the project family has activity after it was written. A single
 * indexed query, so /api/projects/:id can afford it on every load.
 */
export function summaryRow(db, projectPath, familyIds) {
  const row = /** @type {any} */ (db
    .prepare('SELECT markdown, created_at FROM project_summaries WHERE project_path=?')
    .get(projectPath));
  if (!row) return null;
  const ph = familyIds.map(() => '?').join(',');
  const latest = /** @type {any} */ (db
    .prepare(`SELECT max(COALESCE(last_event_at, started_at, 0)) m FROM sessions WHERE project_id IN (${ph})`)
    .get(...familyIds));
  return {
    markdown: row.markdown,
    createdAt: row.created_at,
    stale: (latest?.m ?? 0) > row.created_at,
  };
}

export function mountReport(app, ctx) {
  const { db } = ctx;

  /** Returns null on an inverted range so callers reject rather than walk it. */
  const parseRange = (req) => {
    const to = DAY_RE.test(String(req.query.to)) ? String(req.query.to) : todayKey();
    const from = DAY_RE.test(String(req.query.from)) ? String(req.query.from) : firstActivityDay(db);
    return from > to ? null : { from, to };
  };

  app.get('/api/report/:projectId', (req, res) => {
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const { from, to } = range;
    const data = buildReport(db, Number(req.params.projectId), from, to);
    if (!data) return bad(res, 'project not found', 404);
    const { inputHash, ...rest } = data;
    ok(res, rest);
  });

  app.get('/api/review/:projectId', async (req, res) => {
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const lang = req.query?.lang === 'fr' ? 'fr' : 'en';
    const data = await buildDayReview(db, Number(req.params.projectId), range.from, range.to, lang);
    if (!data) return bad(res, 'project not found', 404);
    const { inputHash, ...rest } = data;
    ok(res, rest);
  });

  app.post('/api/review/:projectId/generate', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const lang = req.body?.lang === 'fr' ? 'fr' : 'en';
    try {
      const review = await buildDayReview(db, projectId, range.from, range.to, lang);
      if (!review) return bad(res, 'project not found', 404);
      // Refuse before spending quota, like changes-summary does.
      if (!review.days.length) return bad(res, 'no activity in this range');

      const input = renderReviewInput(review);
      // range=all / custom can span an unbounded window — refuse BEFORE
      // calling runClaude rather than spending quota on an oversized prompt.
      if (input.length > MAX_REVIEW_INPUT_CHARS) {
        return bad(res, `this range is too large to review (${input.length.toLocaleString('en-US')} chars, max ${MAX_REVIEW_INPUT_CHARS.toLocaleString('en-US')}) — narrow the date range and try again`);
      }

      const key = `review|${review.project.path}|${range.from}|${range.to}|${lang}`;
      let job = inflight.get(key);
      if (!job) {
        const model = getSetting(db, 'llm_model', 'claude-opus-5');
        const configDir = getSetting(db, 'llm_config_dir', '') || '';
        log.info(`day-review: project ${projectId} ${range.from}..${range.to} (${input.length} chars, ${model})`);
        const langLine = lang === 'fr' ? 'Écris la réponse entièrement en français.\n' : '';
        job = runClaude(DAY_REVIEW_INSTRUCTIONS + langLine + input, {
          model, maxTurns: 1, timeoutMs: 600_000, configDir,
        }).then((markdown) => {
          db.prepare(
            `INSERT INTO project_reviews(project_path, period_from, period_to, lang, input_hash, model, markdown, created_at)
             VALUES(?,?,?,?,?,?,?,?)
             ON CONFLICT(project_path, period_from, period_to, lang) DO UPDATE SET
               input_hash=excluded.input_hash, model=excluded.model,
               markdown=excluded.markdown, created_at=excluded.created_at`
          ).run(review.project.path, range.from, range.to, lang, review.inputHash, model, markdown, Date.now());
          return markdown;
        });
        inflight.set(key, job);
        job.finally(() => inflight.delete(key)).catch(() => {});
      }
      const markdown = await job;
      ok(res, { markdown, createdAt: Date.now(), stale: false });
    } catch (e) {
      // The previously cached review is left in place on failure.
      log.warn('day-review failed:', e instanceof Error ? e.message : String(e));
      bad(res, `review failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  });

  /* "Latest changes" prose for the project page: 2-3 paragraphs over the last
   * 14 days of family activity, cached by project path. */
  app.post('/api/projects/:id/changes-summary', async (req, res) => {
    const projectId = Number(req.params.id);
    const p = /** @type {any} */ (db.prepare('SELECT id, path FROM projects WHERE id=?').get(projectId));
    if (!p) return bad(res, 'project not found', 404);
    const lang = req.body?.lang === 'fr' ? 'fr' : 'en';
    const key = `changes|${p.path}|${lang}`;
    try {
      const to = todayKey();
      const from = addDays(to, -13);
      const report = buildReport(db, projectId, from, to);
      if (!report || !report.days.length) return bad(res, 'no activity in the last 14 days');
      let job = inflight.get(key);
      if (!job) {
        const ids = db
          .prepare('SELECT id FROM projects WHERE id=? OR parent_project_id=?')
          .all(projectId, projectId)
          .map((r) => /** @type {any} */ (r).id);
        const input = buildAiInput(db, report, ids);
        log.info(`changes-summary: project ${projectId} (${input.length} chars, ${lang})`);
        const langLine = lang === 'fr' ? 'Écris la réponse entièrement en français.\n' : '';
        job = runClaude(CHANGES_INSTRUCTIONS + langLine + input).then((markdown) => {
          db.prepare(
            `INSERT INTO project_summaries(project_path, markdown, created_at) VALUES(?,?,?)
             ON CONFLICT(project_path) DO UPDATE SET markdown=excluded.markdown, created_at=excluded.created_at`
          ).run(p.path, markdown, Date.now());
          return markdown;
        });
        inflight.set(key, job);
        job.finally(() => inflight.delete(key)).catch(() => {});
      }
      const markdown = await job;
      ok(res, { markdown, createdAt: Date.now(), stale: false });
    } catch (e) {
      log.warn('changes-summary failed:', e instanceof Error ? e.message : String(e));
      bad(res, `summarizer failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  });

  app.post('/api/report/:projectId/summarize', async (req, res) => {
    const projectId = Number(req.params.projectId);
    const from = DAY_RE.test(String(req.body?.from)) ? String(req.body.from) : firstActivityDay(db);
    const to = DAY_RE.test(String(req.body?.to)) ? String(req.body.to) : todayKey();
    const key = `${projectId}|${from}|${to}`;
    try {
      const report = buildReport(db, projectId, from, to);
      if (!report) return bad(res, 'project not found', 404);
      if (!report.days.length) return bad(res, 'no activity in this period');
      if (report.summary && !report.summary.stale) {
        return ok(res, { markdown: report.summary.markdown, createdAt: report.summary.createdAt, cached: true });
      }
      let job = inflight.get(key);
      if (!job) {
        const ids = db
          .prepare('SELECT id FROM projects WHERE id=? OR parent_project_id=?')
          .all(projectId, projectId)
          .map((r) => r.id);
        const input = buildAiInput(db, report, ids);
        const summaryLang = req.body?.lang === 'fr' ? 'Écris la réponse entièrement en français (les titres de catégories aussi).\n' : '';
        log.info(`report: summarizing project ${projectId} ${from}..${to} (${input.length} chars)`);
        job = runClaude(SUMMARIZE_INSTRUCTIONS + summaryLang + input).then((markdown) => {
          db.prepare(
            'INSERT INTO reports(project_id, period_from, period_to, input_hash, markdown, created_at) VALUES(?,?,?,?,?,?)'
          ).run(projectId, from, to, report.inputHash, markdown, Date.now());
          return markdown;
        });
        inflight.set(key, job);
        // .finally() derives a new promise that mirrors job's rejection; swallow
        // it or a failed run becomes an unhandledRejection and kills the server.
        job.finally(() => inflight.delete(key)).catch(() => {});
      }
      const markdown = await job;
      ok(res, { markdown, createdAt: Date.now(), cached: false });
    } catch (e) {
      log.warn('report summarize failed:', e instanceof Error ? e.message : String(e));
      bad(res, `summarizer failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  });

  app.get('/api/report/:projectId/pdf', (req, res) => {
    const range = parseRange(req);
    if (!range) return bad(res, 'from must be on or before to');
    const { from, to } = range;
    const data = buildReport(db, Number(req.params.projectId), from, to);
    if (!data) return bad(res, 'project not found', 404);
    renderPdf(res, data);
  });
}

/* ── PDF rendering (pdfkit, Letter, light professional document) ────────── */
const INK = '#111827';
const MID = '#6b7280';
const FAINT = '#e5e7eb';
const ACCENT = '#0e7490';

function renderPdf(res, data) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 64, bottom: 72, left: 64, right: 64 },
    bufferPages: true,
    info: { Title: `${data.project.name} — Work changelog`, Author: 'Pulse · Claude Code tracker' },
  });
  const safe = data.project.name.replace(/[^\w.-]+/g, '_');
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${safe}-changelog-${data.from}-to-${data.to}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width - 128;

  // header
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(data.project.name);
  doc.moveDown(0.15);
  doc.font('Helvetica').fontSize(11).fillColor(MID)
    .text(`Work changelog · ${prettyDay(data.from)} — ${prettyDay(data.to)}`);
  doc.fontSize(9).text(`Generated ${prettyDay(todayKey())} · Pulse — Claude Code time tracker`);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text(
    [
      `${data.totals.sessions} sessions`,
      `${fmtH(data.totals.claudeMs)} of AI compute`,
      `${data.totals.prompts} prompts`,
      data.totals.linesAdded ? `+${data.totals.linesAdded.toLocaleString('en-US')} / -${data.totals.linesRemoved.toLocaleString('en-US')} lines` : null,
      data.totals.prCount ? `${data.totals.prCount} pull requests` : null,
      `est. ${fmtUsd(data.totals.estCostUsd)} API-equivalent`,
    ].filter(Boolean).join('   ·   ')
  );
  rule(doc, W);

  // AI summary (if fresh enough to be useful)
  if (data.summary && !data.summary.stale) {
    heading(doc, 'Summary of changes');
    renderMarkdownish(doc, data.summary.markdown, W);
    doc.moveDown(0.6);
    rule(doc, W);
    heading(doc, 'Activity detail');
  }

  // per-day detail
  for (const d of data.days) {
    ensureRoom(doc, 64);
    doc.moveDown(0.55);
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ACCENT).text(prettyDay(d.date));
    doc.moveDown(0.15);
    for (const s of d.sessions) {
      ensureRoom(doc, 30);
      const meta = [
        fmtH(s.claudeMs),
        `${s.promptCount} prompt${s.promptCount === 1 ? '' : 's'}`,
        s.linesAdded ? `+${s.linesAdded}/-${s.linesRemoved} lines` : null,
        s.worktreeBranch ? `branch ${s.worktreeBranch}` : null,
        ...s.prLinks.map((x) => (x.repo ? `${x.repo}#${x.number}` : `PR #${x.number}`)),
      ].filter(Boolean).join(' · ');
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(`•  ${s.title}`, { indent: 8, width: W });
      doc.font('Helvetica').fontSize(8.5).fillColor(MID).text(meta, { indent: 20, width: W });
      doc.moveDown(0.2);
    }
    for (const j of d.journal) {
      ensureRoom(doc, 22);
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(MID).text(`✎  ${j.text}`, { indent: 8, width: W });
      doc.moveDown(0.15);
    }
  }
  if (!data.days.length) {
    doc.moveDown(1).font('Helvetica').fontSize(11).fillColor(MID).text('No recorded activity in this period.');
  }

  // footer page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(MID)
      .text(`${data.project.name} — work changelog`, 64, doc.page.height - 48, { lineBreak: false })
      .text(`${i + 1} / ${range.count}`, doc.page.width - 128, doc.page.height - 48, { width: 64, align: 'right', lineBreak: false });
  }
  doc.end();
}

function rule(doc, W) {
  doc.moveDown(0.5);
  doc.moveTo(64, doc.y).lineTo(64 + W, doc.y).lineWidth(0.75).strokeColor(FAINT).stroke();
  doc.moveDown(0.5);
}

function heading(doc, text) {
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(text);
  doc.moveDown(0.2);
}

function ensureRoom(doc, needed) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - needed) doc.addPage();
}

function renderMarkdownish(doc, markdown, W) {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('###')) {
      ensureRoom(doc, 40);
      doc.moveDown(0.45);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ACCENT).text(prettyDay(line.replace(/^#+\s*/, '')));
      doc.moveDown(0.1);
    } else if (/^[-*•]\s+/.test(line)) {
      ensureRoom(doc, 24);
      doc.font('Helvetica').fontSize(10).fillColor(INK)
        .text(`•  ${line.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '')}`, { indent: 8, width: W });
      doc.moveDown(0.12);
    } else {
      ensureRoom(doc, 24);
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(line.replace(/\*\*/g, ''), { width: W });
      doc.moveDown(0.12);
    }
  }
}

function prettyDay(day) {
  if (!DAY_RE.test(day)) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
