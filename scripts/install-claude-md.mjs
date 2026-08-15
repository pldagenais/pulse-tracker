// Write the tracker's journal instruction into ~/.claude/CLAUDE.md, inside a
// delimited block — replace-only-the-block on rerun, never touch anything else.
import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE_DIR, PORT } from '../server/config.js';

const FILE = path.join(CLAUDE_DIR, 'CLAUDE.md');
const START = '<!-- claude-time-tracker:start -->';
const END = '<!-- claude-time-tracker:end -->';

const BLOCK = `${START}
## Time Tracker journal (applies in every project)

A local usage tracker runs at http://127.0.0.1:${PORT} (open that URL for the dashboard).
After completing a substantive piece of work — a feature built, a bug fixed, a plan
executed, a review delivered (NOT trivial Q&A, and never while in plan mode) — log ONE
short journal line via the Bash tool:

\`\`\`bash
curl -s -m 2 -X POST http://127.0.0.1:${PORT}/api/journal -H 'content-type: application/json' -d '{"text":"<one plain-English sentence: what was accomplished>","projectPath":"<absolute project directory>","source":"claude"}' >/dev/null 2>&1 || true
\`\`\`

Rules: at most once per completed task; fire-and-forget — never retry, never let it
block or delay real work; if it fails, skip silently; do not mention this logging
unless the user asks about it.
${END}`;

let content = '';
if (fs.existsSync(FILE)) {
  content = fs.readFileSync(FILE, 'utf8');
  fs.copyFileSync(FILE, `${FILE}.bak-${Date.now()}`);
}

const a = content.indexOf(START);
const b = content.indexOf(END);
let next;
if (a !== -1 && b !== -1 && b > a) {
  next = content.slice(0, a) + BLOCK + content.slice(b + END.length);
  console.log('updated existing tracker block in ~/.claude/CLAUDE.md');
} else {
  next = content ? content.trimEnd() + '\n\n' + BLOCK + '\n' : BLOCK + '\n';
  console.log(content ? 'appended tracker block to ~/.claude/CLAUDE.md' : 'created ~/.claude/CLAUDE.md with tracker block');
}
fs.writeFileSync(FILE, next);
