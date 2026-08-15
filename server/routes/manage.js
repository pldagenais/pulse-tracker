// Claude Code environment management: MCP servers (list/health/add/remove via
// the claude CLI — the CLI owns the config, we never edit ~/.claude.json
// directly), plus read-only inventories of skills, plugins, and custom agents.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { CLAUDE_DIR } from '../config.js';
import { log } from '../lib/logger.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

const NAME_RE = /^[\w][\w.-]{0,63}$/;
// conservative allow-list for the add-server command line
const CMD_BAD_CHARS = /[&|<>^;"'`$%]/;

function runClaude(args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    execFile('claude', args, { timeout: timeoutMs, windowsHide: true, shell: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Parse `claude mcp list` output: "name: command - ✔/✘ status". */
function parseMcpList(stdout) {
  const servers = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^([\w.-]+):\s+(.*?)\s+-\s+(.*)$/);
    if (!m) continue;
    servers.push({
      name: m[1],
      command: m[2].slice(0, 200),
      healthy: /✔|✓|connected/i.test(m[3]),
      status: m[3].replace(/[✔✓✘✗]/g, '').trim().slice(0, 60),
    });
  }
  return servers;
}

/** Frontmatter-lite: pull name/description from a SKILL.md or agent .md head. */
function mdMeta(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
    const name = head.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const description = head.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? null;
    return { name, description };
  } catch {
    return { name: null, description: null };
  }
}

export function mountManage(app) {
  // cache the (slow — health-checks every server) mcp list for a minute
  let mcpCache = { at: 0, data: /** @type {any} */ (null) };

  app.get('/api/manage/mcp', async (req, res) => {
    if (mcpCache.data && Date.now() - mcpCache.at < 60_000 && !req.query.refresh) return ok(res, mcpCache.data);
    const r = await runClaude(['mcp', 'list'], 120_000);
    if (r.code !== 0 && !r.stdout.trim()) return bad(res, (r.stderr || 'claude mcp list failed').slice(0, 200), 500);
    const data = { servers: parseMcpList(r.stdout), checkedAt: Date.now() };
    mcpCache = { at: Date.now(), data };
    ok(res, data);
  });

  app.post('/api/manage/mcp', async (req, res) => {
    const name = String(req.body?.name ?? '');
    const command = String(req.body?.command ?? '').trim();
    if (!NAME_RE.test(name)) return bad(res, 'server name: letters/digits/dot/dash only');
    if (!command || CMD_BAD_CHARS.test(command)) return bad(res, 'command contains characters that are not allowed here');
    const parts = command.split(/\s+/);
    const r = await runClaude(['mcp', 'add', '--scope', 'user', name, '--', ...parts]);
    if (r.code !== 0) return bad(res, (r.stderr || r.stdout || 'add failed').slice(0, 200), 500);
    mcpCache = { at: 0, data: null };
    log.info(`manage: added MCP server "${name}"`);
    ok(res, { added: name });
  });

  app.delete('/api/manage/mcp/:name', async (req, res) => {
    const name = String(req.params.name);
    if (!NAME_RE.test(name)) return bad(res, 'invalid server name');
    const r = await runClaude(['mcp', 'remove', '--scope', 'user', name]);
    if (r.code !== 0) return bad(res, (r.stderr || r.stdout || 'remove failed').slice(0, 200), 500);
    mcpCache = { at: 0, data: null };
    log.info(`manage: removed MCP server "${name}"`);
    ok(res, { removed: name });
  });

  // read-only inventories
  app.get('/api/manage/inventory', (req, res) => {
    const skills = [];
    const skillsDir = path.join(CLAUDE_DIR, 'skills');
    try {
      for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const f = path.join(skillsDir, d.name, 'SKILL.md');
        if (fs.existsSync(f)) skills.push({ dir: d.name, ...mdMeta(f) });
      }
    } catch { /* no skills dir */ }

    const agents = [];
    const agentsDir = path.join(CLAUDE_DIR, 'agents');
    try {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.endsWith('.md')) agents.push({ file: f, ...mdMeta(path.join(agentsDir, f)) });
      }
    } catch { /* no agents dir */ }

    const plugins = [];
    try {
      const cacheDir = path.join(CLAUDE_DIR, 'plugins', 'cache');
      for (const marketplace of fs.readdirSync(cacheDir, { withFileTypes: true })) {
        if (!marketplace.isDirectory()) continue;
        for (const p of fs.readdirSync(path.join(cacheDir, marketplace.name), { withFileTypes: true })) {
          if (p.isDirectory()) plugins.push({ marketplace: marketplace.name, name: p.name });
        }
      }
    } catch { /* no plugins */ }

    ok(res, { skills, agents, plugins });
  });
}
