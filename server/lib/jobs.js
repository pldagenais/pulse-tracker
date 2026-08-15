// Headless Claude job runner: spawns `claude -p` in a real project cwd so the
// transcript lands in ~/.claude/projects and ingests like any other session.
// The prompt travels via stdin (no arg-quoting pitfalls). Output tail is kept
// in the DB so the UI can poll it; full output lives in the transcript itself.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { log } from './logger.js';

const MAX_CONCURRENT = 3;
const TAIL_MAX = 8_000; // chars of stdout+stderr kept per job
const JOB_TIMEOUT_MS = 30 * 60_000; // hard ceiling — headless runs must end

/** Values accepted from the UI; anything else runs with CC's defaults. */
const PERMISSION_MODES = new Set(['default', 'plan', 'acceptEdits', 'bypassPermissions']);

/**
 * Kill a spawned job and everything under it.
 *
 * Jobs are spawned with `shell: true`, so the direct child is `cmd.exe` and the
 * real `claude` runs as its grandchild. `child.kill()` only reaps the shell —
 * the model keeps running, burning quota and ignoring both the timeout and the
 * user's Interrupt. `taskkill /t` walks the tree; `/f` is required because
 * `claude` will not exit on a polite signal mid-generation.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} jobId  for logging only
 */
function killTree(child, jobId) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    return;
  }
  execFile('taskkill', ['/pid', String(pid), '/t', '/f'], (err) => {
    if (!err) return;
    // code 128 = process already gone, which is the outcome we wanted anyway
    if (/not found|128/i.test(String(err.message))) return;
    log.warn(`job ${jobId}: taskkill failed (${err.message}) — falling back to child.kill()`);
    try { child.kill(); } catch { /* already gone */ }
  });
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ onEvent?: (type: string, data: any) => void }} [opts]
 */
export function createJobRunner(db, { onEvent = () => {} } = {}) {
  /** @type {Map<number, import('node:child_process').ChildProcess>} */
  const children = new Map();
  /** @type {Set<number>} jobs the user explicitly interrupted */
  const killedJobs = new Set();

  const S = {
    ins: db.prepare(
      `INSERT INTO pulse_jobs(created_at, session_id, resume_of, project_id, project_path, prompt, model, max_turns, permission_mode, status, started_at)
       VALUES(?,?,?,?,?,?,?,?,?, 'running', ?)`
    ),
    upTail: db.prepare('UPDATE pulse_jobs SET output_tail=? WHERE id=?'),
    finish: db.prepare('UPDATE pulse_jobs SET status=?, exit_code=?, ended_at=?, output_tail=? WHERE id=?'),
    get: db.prepare('SELECT * FROM pulse_jobs WHERE id=?'),
  };

  // Anything still marked running from a previous server process is dead.
  try {
    db.prepare("UPDATE pulse_jobs SET status='error', ended_at=COALESCE(ended_at, created_at) WHERE status='running'").run();
  } catch { /* table may be brand new */ }

  function runningCount() {
    return children.size;
  }

  /**
   * @param {{ projectId?: number|null, projectPath: string, prompt: string, model?: string|null,
   *           maxTurns?: number|null, permissionMode?: string|null, resumeOf?: string|null }} opts
   */
  function launch(opts) {
    if (children.size >= MAX_CONCURRENT) {
      throw new Error(`already ${MAX_CONCURRENT} jobs running — wait for one to finish`);
    }
    if (!opts.prompt?.trim()) throw new Error('prompt is empty');
    if (!fs.existsSync(opts.projectPath)) throw new Error('project folder does not exist');

    const args = ['-p'];
    // resume forks a fresh transcript; a brand-new run gets a pre-generated id
    // so the UI can link the job to its ingested session immediately.
    const sessionId = opts.resumeOf ? null : randomUUID();
    if (opts.resumeOf) args.push('--resume', opts.resumeOf);
    else args.push('--session-id', /** @type {string} */ (sessionId));
    if (opts.model) args.push('--model', opts.model);
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    const mode = opts.permissionMode && PERMISSION_MODES.has(opts.permissionMode) ? opts.permissionMode : 'default';
    if (mode !== 'default') args.push('--permission-mode', mode);

    const jobId = Number(
      S.ins.run(
        Date.now(), sessionId, opts.resumeOf ?? null, opts.projectId ?? null, opts.projectPath,
        opts.prompt.slice(0, 10_000), opts.model ?? null, opts.maxTurns ?? null, mode, Date.now()
      ).lastInsertRowid
    );

    const child = spawn('claude', args, { shell: true, cwd: opts.projectPath, windowsHide: true });
    children.set(jobId, child);
    let tail = '';
    let lastFlush = 0;
    const append = (d) => {
      tail = (tail + String(d)).slice(-TAIL_MAX);
      const now = Date.now();
      if (now - lastFlush > 1000) {
        lastFlush = now;
        try { S.upTail.run(tail, jobId); } catch { /* ignore */ }
        onEvent('job-output', { jobId });
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.stdin.on('error', () => {});

    const timer = setTimeout(() => {
      log.warn(`job ${jobId}: timed out after ${JOB_TIMEOUT_MS / 60000}m — killing`);
      killTree(child, jobId);
    }, JOB_TIMEOUT_MS);

    const settle = (status, code) => {
      clearTimeout(timer);
      children.delete(jobId);
      killedJobs.delete(jobId);
      try { S.finish.run(status, code, Date.now(), tail, jobId); } catch { /* ignore */ }
      onEvent('job-done', { jobId, status });
      log.info(`job ${jobId}: ${status}${code != null ? ` (exit ${code})` : ''}`);
    };
    child.on('error', (e) => { tail += `\n[spawn error] ${e.message}`; settle('error', null); });
    child.on('close', (code) => settle(killedJobs.has(jobId) ? 'killed' : code === 0 ? 'done' : 'error', code));

    try {
      child.stdin.write(opts.prompt);
      child.stdin.end();
    } catch { /* close handler reports */ }

    log.info(`job ${jobId}: launched claude ${args.join(' ')} in ${opts.projectPath}`);
    return { jobId, sessionId };
  }

  function kill(jobId) {
    const child = children.get(jobId);
    if (!child) return false;
    killedJobs.add(jobId);
    killTree(child, jobId);
    return true;
  }

  return { launch, kill, runningCount, isRunning: (id) => children.has(id) };
}
