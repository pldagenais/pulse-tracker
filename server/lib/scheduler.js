// In-process scheduler for recurring headless jobs ("every morning: update
// deps and summarize"). The server already runs 24/7 as a Scheduled Task, so
// no extra Windows plumbing is needed. Safety rails: read-only permission
// default, hard turn caps come from jobs.js, and 3 consecutive failures
// auto-disable a schedule.
import fs from 'node:fs';
import { log } from './logger.js';

const TICK_MS = 60_000;
const MAX_FAILURES = 3;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ launch: Function }} jobs
 */
export function createScheduler(db, jobs) {
  const S = {
    due: db.prepare('SELECT * FROM scheduled_jobs WHERE enabled=1'),
    markRun: db.prepare('UPDATE scheduled_jobs SET last_run_at=?, last_job_id=?, last_status=? WHERE id=?'),
    jobResult: db.prepare('SELECT status FROM pulse_jobs WHERE id=?'),
    settle: db.prepare('UPDATE scheduled_jobs SET last_status=?, consecutive_failures=?, enabled=? WHERE id=?'),
    projectByPath: db.prepare('SELECT id FROM projects WHERE path=?'),
  };

  /** The scheduled fire-time (epoch ms) for this cadence most recently in the past. */
  function lastFireTime(row, now) {
    const d = new Date(now);
    d.setHours(row.hour, row.minute, 0, 0);
    if (row.cadence === 'weekly') {
      const targetDow = row.dow ?? 1; // Monday default
      while (d.getDay() !== targetDow || d.getTime() > now) d.setTime(d.getTime() - 24 * 3600_000);
      // setHours again — DST shifts across the walk-back can drift the time
      d.setHours(row.hour, row.minute, 0, 0);
      return d.getTime();
    }
    if (d.getTime() > now) d.setTime(d.getTime() - 24 * 3600_000);
    return d.getTime();
  }

  function tick() {
    const now = Date.now();
    for (const row of /** @type {any[]} */ (S.due.all())) {
      try {
        // settle the outcome of the previous launch before considering a new one
        if (row.last_job_id && row.last_status === 'launched') {
          const j = /** @type {any} */ (S.jobResult.get(row.last_job_id));
          if (j && j.status !== 'running') {
            const failed = j.status !== 'done';
            const fails = failed ? row.consecutive_failures + 1 : 0;
            const disable = fails >= MAX_FAILURES;
            S.settle.run(j.status, fails, disable ? 0 : 1, row.id);
            if (disable) log.warn(`scheduler: "${row.name}" disabled after ${fails} consecutive failures`);
            row.last_status = j.status;
            row.consecutive_failures = fails;
            if (disable) continue;
          }
        }
        const fireAt = lastFireTime(row, now);
        if ((row.last_run_at ?? 0) >= fireAt) continue; // already ran this cycle
        if (now - fireAt > 3600_000 * 6) {
          // missed by more than 6h (machine asleep) — skip this cycle silently
          S.markRun.run(fireAt, row.last_job_id, row.last_status ?? 'skipped', row.id);
          continue;
        }
        if (!fs.existsSync(row.project_path)) {
          S.markRun.run(now, null, 'error: project folder missing', row.id);
          continue;
        }
        const projectId = /** @type {any} */ (S.projectByPath.get(row.project_path))?.id ?? null;
        const { jobId } = jobs.launch({
          projectId,
          projectPath: row.project_path,
          prompt: row.prompt,
          model: row.model,
          maxTurns: row.max_turns ?? 15,
          permissionMode: row.permission_mode ?? 'default',
        });
        S.markRun.run(now, jobId, 'launched', row.id);
        log.info(`scheduler: "${row.name}" launched (job ${jobId})`);
      } catch (e) {
        S.markRun.run(now, null, `error: ${e instanceof Error ? e.message : e}`.slice(0, 200), row.id);
        log.warn(`scheduler: "${row.name}" failed to launch:`, e instanceof Error ? e.message : String(e));
      }
    }
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref();

  return { tick };
}
