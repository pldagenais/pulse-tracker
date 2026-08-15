// Remove tracker hooks from ~/.claude/settings.json (backup first).
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR } from '../server/config.js';

const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const MARKER = 'notify.mjs';

if (!fs.existsSync(SETTINGS)) {
  console.log('no settings.json — nothing to do');
  process.exit(0);
}
const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-${Date.now()}`);

let removed = 0;
if (settings.hooks && typeof settings.hooks === 'object') {
  for (const [event, arr] of Object.entries(settings.hooks)) {
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((entry) => !JSON.stringify(entry).includes(MARKER));
    removed += arr.length - kept.length;
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(`removed ${removed} tracker hook entr${removed === 1 ? 'y' : 'ies'}`);
