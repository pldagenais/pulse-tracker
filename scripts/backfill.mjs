// Manual full/partial ingest runner. Usage:
//   node --disable-warning=ExperimentalWarning scripts/backfill.mjs [pathFilter]
// pathFilter (optional): only ingest transcript files whose path contains it.
import { openDb } from '../server/lib/db.js';
import { createIngester } from '../server/lib/ingest.js';
import { importLegacy } from '../server/lib/legacy.js';

const filter = process.argv[2] || null;
const db = openDb();
const t0 = Date.now();
let lastLog = 0;

const ing = createIngester(db, {
  onEvent: (type, data) => {
    if (type !== 'ingest-progress') return;
    const now = Date.now();
    if (now - lastLog < 2000 && data.filesDone < data.filesTotal) return;
    lastLog = now;
    const mb = (data.bytesDone / 1048576).toFixed(0);
    const mbT = (data.bytesTotal / 1048576).toFixed(0);
    console.log(`[${data.phase}] files ${data.filesDone}/${data.filesTotal}  ${mb}/${mbT} MB  ${data.lastFile ?? ''}`);
  },
});

await ing.scanAndIngest({ filter });
if (!filter) await importLegacy(db, ing.projectIdFor);

const secs = ((Date.now() - t0) / 1000).toFixed(1);
const q = (sql) => db.prepare(sql).get();
console.log(`\nDone in ${secs}s`);
console.log('sessions:   ', q('SELECT count(*) c FROM sessions').c);
console.log('projects:   ', q('SELECT count(*) c FROM projects').c);
console.log('events:     ', q('SELECT count(*) c FROM events').c);
console.log('prompts:    ', q('SELECT count(*) c FROM prompts').c);
console.log('  typed:    ', q("SELECT count(*) c FROM prompts WHERE kind='typed'").c);
console.log('  command:  ', q("SELECT count(*) c FROM prompts WHERE kind='command'").c);
console.log('  legacy:   ', q("SELECT count(*) c FROM prompts WHERE kind='legacy'").c);
console.log('turns:      ', q('SELECT count(*) c FROM turns').c);
console.log('agent_runs: ', q('SELECT count(*) c FROM agent_runs').c);
console.log('legacy_days:', q('SELECT count(*) c FROM legacy_daily').c);
console.log('dupe-credit check (must be 0):',
  db.prepare('SELECT count(*) c FROM (SELECT message_id FROM events WHERE usage_credited=1 GROUP BY message_id HAVING count(*)>1)').get().c);
console.log('tokens out (dedup):', q('SELECT sum(output_tokens) s FROM events WHERE usage_credited=1').s);
console.log('agent tokens out:  ', q('SELECT sum(output_tokens) s FROM agent_runs').s);
console.log('est cost usd:      ', q('SELECT round(sum(est_cost_usd),2) s FROM sessions').s);
console.log('parse errors:      ', q('SELECT sum(parse_errors) s FROM ingest_files').s);
