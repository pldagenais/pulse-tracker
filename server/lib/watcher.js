import chokidar from 'chokidar';
import { PROJECTS_DIR } from '../config.js';
import { log } from './logger.js';

/**
 * Watch ~/.claude/projects for transcript changes. chokidar v4 (no globs):
 * watch the root, filter in the handler.
 */
export function startWatcher({ onTranscript }) {
  const state = { watching: false, lastEventAt: null };
  const watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignored: (p, stats) => !!stats?.isFile() && !p.endsWith('.jsonl'),
  });
  const handle = (p) => {
    if (!p.endsWith('.jsonl')) return;
    state.lastEventAt = Date.now();
    onTranscript(p);
  };
  watcher.on('add', handle);
  watcher.on('change', handle);
  watcher.on('ready', () => {
    state.watching = true;
    log.info('watcher: ready on', PROJECTS_DIR);
  });
  watcher.on('error', (e) => log.warn('watcher error:', e instanceof Error ? e.message : String(e)));
  return { watcher, state };
}
