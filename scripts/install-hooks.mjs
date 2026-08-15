// Merge tracker hooks into ~/.claude/settings.json. Idempotent; never regex;
// backs up first; preserves every existing key and hook.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, ROOT } from '../server/config.js';

const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const NOTIFY = path.join(ROOT, 'hooks', 'notify.mjs');
const MARKER = 'notify.mjs';
const COMMAND = `node --disable-warning=ExperimentalWarning "${NOTIFY}"`;
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionEnd', 'Notification'];

let settings = {};
if (fs.existsSync(SETTINGS)) {
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  settings = JSON.parse(raw); // throws (and aborts) on corruption — never clobber
  const backup = `${SETTINGS}.bak-${Date.now()}`;
  fs.copyFileSync(SETTINGS, backup);
  console.log(`backed up settings to ${path.basename(backup)}`);
}

settings.hooks ??= {};
let added = 0;
for (const event of EVENTS) {
  const arr = (settings.hooks[event] ??= []);
  const present = JSON.stringify(arr).includes(MARKER);
  if (present) continue;
  arr.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] });
  added++;
}

fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
console.log(added ? `hooks installed for ${added} event(s): ${EVENTS.join(', ')}` : 'hooks already installed — nothing to do');
