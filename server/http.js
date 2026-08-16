import express from 'express';
import { WEB_DIST } from './config.js';
import { mountData } from './routes/data.js';
import { mountJournal } from './routes/journal.js';
import { mountSystem } from './routes/system.js';
import { mountReport } from './routes/report.js';
import { mountActions } from './routes/actions.js';
import { mountJobs } from './routes/jobs.js';
import { mountManage } from './routes/manage.js';
import { mountRoutines } from './routes/routines.js';
import { mountMemory } from './routes/memory.js';
import { log } from './lib/logger.js';

/**
 * SPA fallback: any non-API GET serves the app shell.
 *
 * The dist dir goes through `root` rather than being joined into the filename.
 * Without a root, sendFile applies its `dotfiles: 'ignore'` policy to the WHOLE
 * absolute path, so every deep URL 404s from any checkout living under a
 * dot-directory — which is every git worktree here (`.claude/worktrees/<...>`).
 * express.static already does this, which is why `/index.html` worked while
 * `/manage` did not.
 * @param {string} [webDist]
 */
export function spaFallback(webDist = WEB_DIST) {
  return (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile('index.html', { root: webDist }, (/** @type {any} */ err) => {
      if (err) res.status(503).send('UI not built yet — run: npm run build:web');
    });
  };
}

export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  mountData(app, ctx);
  mountJournal(app, ctx);
  mountSystem(app, ctx);
  mountReport(app, ctx);
  mountActions(app, ctx);
  mountJobs(app, ctx);
  mountManage(app);
  mountRoutines(app, ctx);
  mountMemory(app, ctx);

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not found' }));

  app.use(express.static(WEB_DIST));
  app.use(spaFallback(WEB_DIST));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error('http error:', req.method, req.path, err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  });

  return app;
}
