// Import claude.ai chat usage from an account data export (Settings →
// Privacy → Export data). Usage:  node scripts/import-claudeai.mjs <export-dir>
// Upserts by conversation uuid — safe to re-run with newer exports. Note:
// Claude Code cloud coding sessions are NOT part of claude.ai exports; this
// imports regular chats only, shown in Pulse as a separate "claude.ai" layer.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../server/lib/db.js';

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'conversations.json'))) {
  console.error('usage: node scripts/import-claudeai.mjs <export-dir containing conversations.json>');
  process.exit(1);
}

const db = openDb();
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'conversations.json'), 'utf8'));
const ins = db.prepare(
  `INSERT INTO claudeai_chats(uuid, name, first_ts, last_ts, messages, human_messages)
   VALUES(?,?,?,?,?,?)
   ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, first_ts=excluded.first_ts,
     last_ts=excluded.last_ts, messages=excluded.messages, human_messages=excluded.human_messages`
);

const ts = (s) => {
  const t = Date.parse(s ?? '');
  return Number.isFinite(t) ? t : null;
};

let imported = 0;
for (const c of raw) {
  if (!c?.uuid) continue;
  const msgs = Array.isArray(c.chat_messages) ? c.chat_messages : [];
  const times = msgs.map((m) => ts(m.created_at)).filter((t) => t != null).sort((a, b) => a - b);
  ins.run(
    c.uuid,
    (c.name ?? '').slice(0, 120) || null,
    times[0] ?? ts(c.created_at),
    times[times.length - 1] ?? ts(c.updated_at) ?? ts(c.created_at),
    msgs.length,
    msgs.filter((m) => m.sender === 'human').length
  );
  imported++;
}

// keep a copy inside data/ so the import can be repeated after a disk move
const keep = path.join(process.cwd(), 'data', 'imports');
fs.mkdirSync(keep, { recursive: true });
fs.copyFileSync(path.join(dir, 'conversations.json'), path.join(keep, 'claudeai-conversations.json'));

console.log(`imported/updated ${imported} claude.ai conversations`);
console.log('total in table:', db.prepare('SELECT count(*) c FROM claudeai_chats').get().c);
db.close();
