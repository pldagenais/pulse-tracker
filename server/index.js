// Claude Time Tracker — boot orchestration.
import fs from 'node:fs';
import { openDb, getMeta, setMeta } from './lib/db.js';
import { log } from './lib/logger.js';
import {
  APP_NAME, HOST, PORT, DATA_DIR, RESCAN_INTERVAL_MS, MAINTENANCE_INTERVAL_MS,
  HOOK_EVENTS_RETENTION_MS, STALE_SESSION_SWEEP_MS,
} from './config.js';
import { createSseHub } from './sse.js';
import { createLiveMap } from './lib/live.js';
import { createIngester } from './lib/ingest.js';
import { createJobRunner } from './lib/jobs.js';
import { createGitScanner } from './lib/git.js';
import { createPrTracker } from './lib/prs.js';
import { createScheduler } from './lib/scheduler.js';
import { createAlertEngine } from './lib/alerts.js';
import { createRoutinesBridge } from './lib/routines.js';
import { importLegacy } from './lib/legacy.js';
import { startWatcher } from './lib/watcher.js';
import { createApp } from './http.js';
import { classifyPath } from './lib/scan.js';
import path from 'node:path';

process.on('uncaughtException', (err) => {
  log.fatal('uncaughtException', err);
  process.exit(1); // the scheduled task restarts us
});
process.on('unhandledRejection', (err) => {
  log.fatal('unhandledRejection', /** @type {any} */ (err));
  process.exit(1);
});

const db = openDb();
const sse = createSseHub();
const live = createLiveMap(db, {
  onChange: (rows) => sse.broadcast('session-activity', rows),
});
const ingester = createIngester(db, {
  onEvent: (type, data) => {
    if (type === 'ingest-progress') sse.broadcast('ingest-progress', data);
    else if (type === 'sessions-updated') sse.broadcast('data-changed', data);
  },
});
const watcherState = { watching: false, lastEventAt: null };

const jobs = createJobRunner(db, { onEvent: (type, data) => sse.broadcast(type, data) });
const scheduler = createScheduler(db, jobs);
const alertEngine = createAlertEngine(db, { onAlert: (alert) => sse.broadcast('alert', alert) });
const routines = createRoutinesBridge();
const app = createApp({ db, sse, live, ingester, watcherState, jobs, scheduler, alertEngine, routines });
const server = app.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT}`);
  startBackground();
});

server.on('error', async (err) => {
  if (/** @type {any} */ (err).code === 'EADDRINUSE') {
    try {
      const r = await fetch(`http://${HOST}:${PORT}/api/status`, { signal: AbortSignal.timeout(2000) });
      const j = /** @type {any} */ (await r.json());
      if (j?.data?.app === APP_NAME) {
        log.info('another instance is already running — exiting cleanly');
        process.exit(0);
      }
    } catch { /* not us */ }
    log.error(`port ${PORT} is in use by another process`);
    process.exit(1);
  }
  throw err;
});

async function startBackground() {
  try {
    await ingester.scanAndIngest({ phase: 'backfill' });
    await importLegacy(db, ingester.projectIdFor);
  } catch (e) {
    log.error('backfill failed:', e);
  }

  const w = startWatcher({
    onTranscript: (p) => {
      const info = classifyPath(p);
      if (info.fileKind === 'skip') return; // sidecar jsonl (workflow journals etc.)
      ingester.enqueue(info);
      // Only a MAIN transcript stem is a session id — sidecar files must not
      // spawn phantom live sessions.
      if (info.fileKind === 'main') live.onFileActivity([path.basename(p, '.jsonl')]);
    },
  });
  watcherState.watching = true;
  Object.defineProperty(watcherState, 'lastEventAt', { get: () => w.state.lastEventAt });

  const rescan = setInterval(() => {
    ingester.scanAndIngest({ phase: 'rescan' }).catch((e) => log.warn('rescan failed:', e.message));
  }, RESCAN_INTERVAL_MS);
  rescan.unref();

  // git/PR correlation: first pass shortly after boot, then hourly with maintenance
  const gitScanner = createGitScanner(db);
  const prTracker = createPrTracker(db);
  const firstScan = setTimeout(() => {
    gitScanner.scanAll();
    prTracker.tick();
  }, 45_000);
  firstScan.unref();

  const maintenance = setInterval(() => {
    try {
      db.prepare('DELETE FROM hook_events WHERE ts < ?').run(Date.now() - HOOK_EVENTS_RETENTION_MS);
      runDailyBackup();
      gitScanner.scanAll();
      prTracker.tick();
      // stale sweep: sessions idle for >24h with no live signal are considered ended
      const liveIds = new Set(live.snapshot().map((r) => r.sessionId));
      const stale = db
        .prepare('SELECT id, last_event_at FROM sessions WHERE ended_at IS NULL AND last_event_at < ?')
        .all(Date.now() - STALE_SESSION_SWEEP_MS);
      const upd = db.prepare('UPDATE sessions SET ended_at=? WHERE id=?');
      for (const s of stale) {
        if (!liveIds.has(s.id)) upd.run(s.last_event_at, s.id);
      }
    } catch (e) {
      log.warn('maintenance failed:', e.message);
    }
  }, MAINTENANCE_INTERVAL_MS);
  maintenance.unref();
  runDailyBackup();
}

// Nightly consistent snapshot (VACUUM INTO) protecting user data (journal,
// stars, settings) against DB corruption; keeps the last 7.
function runDailyBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (getMeta(db, 'last_backup_day') === today) return;
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `tracker-${today}.db`);
    if (!fs.existsSync(target)) {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    }
    setMeta(db, 'last_backup_day', today);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('tracker-') && f.endsWith('.db')).sort();
    for (const f of files.slice(0, Math.max(files.length - 7, 0))) {
      fs.unlinkSync(path.join(dir, f));
    }
    log.info(`backup: ${path.basename(target)} written (${files.length > 7 ? files.length - 7 : 0} pruned)`);
  } catch (e) {
    log.warn('backup failed:', e instanceof Error ? e.message : String(e));
  }
}
