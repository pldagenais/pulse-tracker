// One-shot setup: build UI, init DB, install hooks + CLAUDE.md journal block,
// register the autostart task, start the server, verify it answers.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, WEB_DIST } from '../server/config.js';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scripts, '..');
const step = (name) => console.log(`\n── ${name} ${'─'.repeat(Math.max(46 - name.length, 0))}`);
const runNode = (file) => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(scripts, file)], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${file} failed`);
};

step('1/6 web UI');
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.log('web/dist already built — skipping (run "npm run build:web" to rebuild)');
} else {
  const r = spawnSync('npm', ['--prefix', path.join(root, 'web'), 'run', 'build'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('web build failed');
}

step('2/6 database');
{
  const { openDb } = await import('../server/lib/db.js');
  openDb();
  console.log('db ready');
}

step('3/6 claude code hooks');
runNode('install-hooks.mjs');

step('4/6 global CLAUDE.md journal');
runNode('install-claude-md.mjs');

step('5/6 autostart (scheduled task)');
{
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, 'install-autostart.ps1')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('autostart registration failed');
}

step('6/6 start & verify');
spawnSync('schtasks', ['/run', '/tn', 'ClaudeTimeTracker'], { stdio: 'inherit' });
let up = false;
for (let i = 0; i < 15; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(1500) });
    const j = /** @type {any} */ (await r.json());
    if (j?.data?.app === 'claude-time-tracker') {
      up = true;
      break;
    }
  } catch { /* not up yet */ }
  await new Promise((res) => setTimeout(res, 1000));
}

console.log('\n════════════════════════════════════════════════');
if (up) {
  console.log(`  Tracker is running:  http://127.0.0.1:${PORT}`);
  console.log('  It starts automatically (hidden) at every logon.');
} else {
  console.log('  Setup finished, but the server did not answer yet.');
  console.log(`  Start it manually with: npm start   then open http://127.0.0.1:${PORT}`);
}
console.log('════════════════════════════════════════════════');
