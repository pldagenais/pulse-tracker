// Desktop actions: open a project in VS Code / Terminal / Explorer, resume a
// session in a real terminal, kill a runaway session. Every path comes from
// the DB (projects.path / sessions cwd) — never from the request body — so
// these endpoints can only ever act on known Claude Code checkouts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { log } from '../lib/logger.js';

const ok = (res, data) => res.json({ ok: true, data });
const bad = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

/** Fire-and-forget a GUI launch. The server runs as a hidden scheduled task
 * whose environment lacks the USER PATH additions, and app-execution aliases
 * (wt.exe) can't be CreateProcess'd directly — `cmd /c start` handles both.
 * The empty "" is start's window-title slot (else a quoted path becomes it). */
function launch(args) {
  const child = spawn('cmd.exe', ['/c', 'start', '', ...args], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => log.warn('launch failed:', e.message));
  child.unref();
}

/** Resolve a tool the user PATH would normally provide: try well-known
 * install locations first, then the (possibly trimmed) process PATH.
 * lstat, not stat/existsSync: Store app-execution aliases (wt.exe) are
 * reparse points that plain stat refuses to follow. */
const present = (p) => {
  try { fs.lstatSync(p); return true; } catch { return false; }
};
function resolveTool(wellKnown, exeName) {
  for (const p of wellKnown) {
    if (p && present(p)) return p;
  }
  for (const d of (process.env.PATH ?? '').split(';')) {
    if (d && present(path.join(d, exeName))) return path.join(d, exeName);
  }
  return null;
}

// The scheduled-task environment can lack LOCALAPPDATA — os.homedir() resolves
// via USERPROFILE or the OS and always works.
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const wtPath = () => resolveTool([path.join(LOCAL, 'Microsoft', 'WindowsApps', 'wt.exe')], 'wt.exe');
const codePath = () => resolveTool([path.join(LOCAL, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')], 'code.cmd') ?? 'code';

/** Resolve the command line of a PID (kill-switch safety check). */
function pidCommandLine(pid) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout).trim() || null)
    );
  });
}

export function mountActions(app, ctx) {
  const { db, live } = ctx;

  const projectPath = (id) => {
    const row = /** @type {any} */ (db.prepare('SELECT path FROM projects WHERE id=?').get(Number(id)));
    return row?.path && fs.existsSync(row.path) ? row.path : null;
  };

  // Open a project folder in an app. target: code | terminal | explorer
  app.post('/api/projects/:id/open', (req, res) => {
    const target = String(req.body?.target ?? '');
    const dir = projectPath(req.params.id);
    if (!dir) return bad(res, 'unknown project or folder no longer exists', 404);
    if (target === 'code') launch([codePath(), dir]);
    else if (target === 'explorer') launch(['explorer.exe', dir]);
    else if (target === 'terminal') {
      const wt = wtPath();
      if (!wt) return bad(res, 'Windows Terminal (wt.exe) not found — is it installed from the Store?');
      launch([wt, '-d', dir]);
    } else return bad(res, 'target must be code | terminal | explorer');
    log.info(`open: ${target} → ${dir}`);
    ok(res, { launched: target });
  });

  // Resume a past session in a new Windows Terminal tab, in its original cwd.
  app.post('/api/sessions/:id/resume', (req, res) => {
    const sid = String(req.params.id);
    const row = /** @type {any} */ (db
      .prepare('SELECT p.path FROM sessions s JOIN projects p ON p.id=s.project_id WHERE s.id=?')
      .get(sid));
    if (!row) return bad(res, 'unknown session', 404);
    if (!fs.existsSync(row.path)) return bad(res, 'project folder no longer exists');
    if (live.registryFor(sid)) return bad(res, 'session is already running — switch to its terminal instead');
    const wt = wtPath();
    if (!wt) return bad(res, 'Windows Terminal (wt.exe) not found — is it installed from the Store?');
    launch([wt, '-d', row.path, 'cmd', '/k', 'claude', '--resume', sid]);
    log.info(`resume: ${sid} in ${row.path}`);
    ok(res, { resumed: sid });
  });

  // Kill a runaway live session. Confirms the PID still belongs to a claude
  // process at kill time (Windows recycles PIDs aggressively).
  app.post('/api/sessions/:id/kill', async (req, res) => {
    const sid = String(req.params.id);
    const reg = live.registryFor(sid);
    if (!reg?.pid) return bad(res, 'no live local process found for this session (cloud sessions cannot be killed here)', 404);
    const cmdline = await pidCommandLine(reg.pid);
    if (!cmdline || !/claude/i.test(cmdline)) {
      return bad(res, 'refusing to kill: process no longer looks like a claude session (PID may have been recycled)', 409);
    }
    try {
      process.kill(reg.pid);
      log.info(`kill: terminated session ${sid} (pid ${reg.pid})`);
      ok(res, { killed: sid, pid: reg.pid });
    } catch (e) {
      bad(res, `kill failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  });
}
