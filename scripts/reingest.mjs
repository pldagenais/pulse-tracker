// Rebuild the derived cache from transcripts. PRESERVES user data:
// journal, settings, hook_events, accounts, session_accounts and
// meta(schema_version) survive; everything else is derived from ~/.claude and
// safe to drop. Account attribution in particular CANNOT be re-derived —
// transcripts carry no account identity, so dropping it would permanently lose
// which subscription each session ran on.
// Stop the server first (or let its watcher re-sync afterwards).
import { openDb, setMeta } from '../server/lib/db.js';
import { createIngester } from '../server/lib/ingest.js';
import { importLegacy } from '../server/lib/legacy.js';

const db = openDb();
console.log('dropping derived tables (journal/settings/hook_events/accounts preserved)...');
db.exec('BEGIN');
try {
  for (const t of ['events', 'prompts', 'turns', 'sessions', 'projects', 'agent_runs', 'legacy_daily', 'ingest_files', 'parse_failures', 'commits', 'error_events']) {
    db.exec(`DELETE FROM ${t}`);
  }
  setMeta(db, 'legacy_imported', '0');
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
db.exec('VACUUM');

let lastLog = 0;
const ing = createIngester(db, {
  onEvent: (type, data) => {
    if (type !== 'ingest-progress') return;
    const now = Date.now();
    if (now - lastLog < 2000 && data.filesDone < data.filesTotal) return;
    lastLog = now;
    console.log(`[${data.phase}] ${data.filesDone}/${data.filesTotal} files`);
  },
});

const t0 = Date.now();
await ing.scanAndIngest({ phase: 'backfill' });
await importLegacy(db, ing.projectIdFor);
console.log(`reingest done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('sessions:', db.prepare('SELECT count(*) c FROM sessions').get().c);
console.log('prompts: ', db.prepare('SELECT count(*) c FROM prompts').get().c);
console.log('journal: ', db.prepare('SELECT count(*) c FROM journal').get().c, '(must be preserved)');
