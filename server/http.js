import path from 'node:path';
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
  // SPA fallback: any non-API GET serves the app shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
      if (err) res.status(503).send('UI not built yet — run: npm run build:web');
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error('http error:', req.method, req.path, err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  });

  return app;
}
