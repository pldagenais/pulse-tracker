// Pulse MCP server (stdio): lets any Claude Code session query the tracker.
// Registered once via:  claude mcp add -s user pulse -- node <this file>
// Hand-rolled JSON-RPC 2.0 over stdio — no SDK dependency; tools are thin
// fetches against the local REST API, so the server stays the source of truth.
const PORT = process.env.CLAUDE_TRACKER_PORT || 5599;
const BASE = `http://127.0.0.1:${PORT}`;

const TOOLS = [
  {
    name: 'get_usage_stats',
    description:
      "PL's Claude Code usage from the local Pulse tracker: today's totals, the trailing 5-hour/7-day consumption windows, and per-project split for today. Use when asked about Claude usage, time spent, or estimated cost.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_prompts',
    description: 'Full-text search across every prompt PL has ever typed into Claude Code (FTS). Returns matching prompts with project, session id, and timestamp — useful to find how a past task was phrased or what was already tried.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'search terms' }, limit: { type: 'number' } },
      required: ['query'],
    },
  },
  {
    name: 'list_recent_sessions',
    description: 'Most recent Claude Code sessions across all projects: title, project, working time, prompts, est. cost, session id.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'default 10, max 30' } } },
  },
  {
    name: 'get_project_summary',
    description: 'Work summary for one project by name (fuzzy match): totals plus the recent day-by-day changelog of sessions and journal notes.',
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] },
  },
  {
    name: 'append_journal',
    description: "Add a one-line accomplishment note to Pulse's work journal for a project. Prefer this over the curl instruction in CLAUDE.md when available.",
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, projectPath: { type: 'string', description: 'absolute project directory' } },
      required: ['text'],
    },
  },
];

async function api(path) {
  const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) });
  const j = /** @type {any} */ (await r.json());
  if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.data;
}

const fmtH = (ms) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(1)}h` : `${Math.round(ms / 60_000)}m`);
const usd = (v) => `$${(v ?? 0).toFixed(2)}`;

const HANDLERS = {
  async get_usage_stats() {
    const [o, w] = await Promise.all([api('/api/overview'), api('/api/usage-window')]);
    const proj = o.byProject.slice(0, 8).map((p) => `- ${p.name}: ${fmtH(p.claudeMs)}, ${p.prompts} prompts, ${usd(p.estCostUsd)}`).join('\n');
    return [
      `Today (${o.date}): Claude worked ${fmtH(o.claudeMs)}, you were active ${fmtH(o.userActiveMs)}, ${o.prompts} prompts, ${o.sessions} sessions, est. cost ${usd(o.estCostUsd)} (API-equivalent; PL is on Max so this is notional).`,
      `Trailing 5h window: ${usd(w.window5h.estCostUsd)} est., ${w.window5h.prompts} prompts. Trailing 7 days: ${usd(w.window7d.estCostUsd)} est., ${w.window7d.prompts} prompts.`,
      `Current streak: ${o.records.currentStreak} days (longest ${o.records.longestStreak}).`,
      proj ? `Today by project:\n${proj}` : '',
    ].filter(Boolean).join('\n\n');
  },
  async search_prompts({ query, limit }) {
    const n = Math.min(Number(limit) || 10, 25);
    const d = await api(`/api/prompts?q=${encodeURIComponent(query)}&page=1&pageSize=${n}`);
    if (!d.rows.length) return `No prompts match "${query}".`;
    return d.rows.map((r) => `[${new Date(r.ts).toISOString().slice(0, 16)}] (${r.projectName ?? '?'}) session ${r.sessionId}\n${(r.snippet ?? r.text).slice(0, 300)}`).join('\n---\n') + `\n\n(${d.total} total matches)`;
  },
  async list_recent_sessions({ limit }) {
    const n = Math.min(Number(limit) || 10, 30);
    const d = await api(`/api/sessions?page=1&pageSize=${n}`);
    return d.rows.map((s) =>
      `- ${s.title ?? s.firstPrompt ?? 'untitled'} (${s.projectName}${s.worktreeBranch ? ` · ${s.worktreeBranch}` : ''}) — ${fmtH(s.claudeMs)}, ${s.promptCount} prompts, ${usd(s.estCostUsd)} · id ${s.id}`
    ).join('\n');
  },
  async get_project_summary({ project }) {
    const projects = await api('/api/projects');
    const q = String(project).toLowerCase();
    const p = projects.find((x) => x.name.toLowerCase() === q) ?? projects.find((x) => x.name.toLowerCase().includes(q) && !x.parentProjectId);
    if (!p) return `No project matching "${project}". Known: ${projects.filter((x) => !x.parentProjectId).map((x) => x.name).join(', ')}`;
    const r = await api(`/api/report/${p.id}`);
    const days = r.days.slice(-10).map((d) =>
      `${d.date}: ${d.sessions.map((s) => s.title).join(' · ') || '(journal only)'}${d.journal.length ? `\n  notes: ${d.journal.map((j) => j.text).join(' | ')}` : ''}`
    ).join('\n');
    return `${r.project.name} (${r.project.path})\nTotals ${r.from}→${r.to}: ${r.totals.sessions} sessions, Claude ${fmtH(r.totals.claudeMs)}, ${r.totals.prompts} prompts, est. ${usd(r.totals.estCostUsd)}${r.totals.linesAdded ? `, +${r.totals.linesAdded}/-${r.totals.linesRemoved} lines` : ''}${r.totals.prCount ? `, ${r.totals.prCount} PRs` : ''}.\n\nRecent days:\n${days}`;
  },
  async append_journal({ text, projectPath }) {
    const r = await fetch(`${BASE}/api/journal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 500), projectPath: projectPath ?? null, source: 'claude' }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? 'Journal entry recorded.' : `Failed: HTTP ${r.status}`;
  },
};

/* ── stdio JSON-RPC plumbing ─────────────────────────────────────────── */
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handle(line);
  }
});
let pending = 0;
let ended = false;
const shutdown = () => {
  // flush stdout before exiting — a hard exit mid-flush trips libuv on Windows
  process.stdout.write('', () => setImmediate(() => process.exit(0)));
};
process.stdin.on('end', () => {
  ended = true;
  if (pending === 0) shutdown();
});
const maybeExit = () => {
  if (ended && pending === 0) shutdown();
};

async function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;
  if (id === undefined) return; // notification — nothing to answer
  pending++;
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'pulse', version: '1.0.0' },
        },
      });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const fn = HANDLERS[params?.name];
      if (!fn) throw new Error(`unknown tool ${params?.name}`);
      let text;
      try {
        text = await fn(params?.arguments ?? {});
      } catch (e) {
        text = `Pulse tracker unavailable: ${e instanceof Error ? e.message : e}. Is the ClaudeTimeTracker service running on port ${PORT}?`;
      }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  } finally {
    pending--;
    maybeExit();
  }
}
