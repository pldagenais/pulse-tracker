// Parser smoke test against real transcripts. Read-only. Usage:
//   npm run smoke              (default known files + first subagent file)
//   npm run smoke -- <file>…
import path from 'node:path';
import { readLines } from '../server/lib/lineReader.js';
import { classifyLine, extractUsage, assistantMeta, extractPrompt } from '../server/lib/parse.js';
import { scanTranscripts } from '../server/lib/scan.js';
import { PROJECTS_DIR } from '../server/config.js';

const DEFAULTS = [
  // big recent session (v2.1.222)
  path.join(PROJECTS_DIR, 'C--Claude-Code-Projects-FEP', 'c31d67e0-2b43-48e8-9cd0-424a8d4a432b.jsonl'),
  // fork/resume file (first ~935 lines belong to another sessionId)
  path.join(PROJECTS_DIR, 'C--Claude-Code-Projects-FEP', '38e8f047-a5ed-4a55-b4fe-81367312ec2e.jsonl'),
  // small older session (v2.1.197) — expected 7 typed human prompts
  path.join(
    PROJECTS_DIR,
    'C--Users-pl-OneDrive-Documents-GitHub-ChargeOps2--claude-worktrees-funny-sanderson-bb97b9',
    '25b2fa49-99df-47d9-ae02-14034acc69e5.jsonl'
  ),
];

async function analyze(file) {
  const kinds = {};
  const sessions = new Set();
  const msgIds = new Set();
  const uuids = new Set();
  let dupUuids = 0;
  let rawOut = 0;
  let dedupOut = 0;
  let rawIn = 0;
  let dedupIn = 0;
  let parseErrors = 0;
  const promptTexts = [];
  let lines = 0;

  for await (const { text } of readLines(file, 0)) {
    lines++;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      parseErrors++;
      continue;
    }
    const { kind } = classifyLine(obj);
    kinds[kind] = (kinds[kind] || 0) + 1;
    if (typeof obj.sessionId === 'string') sessions.add(obj.sessionId);
    if (typeof obj.uuid === 'string') {
      if (uuids.has(obj.uuid)) dupUuids++;
      uuids.add(obj.uuid);
    }
    if (kind === 'assistant') {
      const u = extractUsage(obj.message);
      if (u) {
        rawOut += u.output;
        rawIn += u.input;
        const meta = assistantMeta(obj);
        const key = meta.messageId || obj.uuid;
        if (!msgIds.has(key)) {
          msgIds.add(key);
          dedupOut += u.output;
          dedupIn += u.input;
        }
      }
    }
    if (kind === 'prompt' || kind === 'command') {
      promptTexts.push(`[${kind}] ` + extractPrompt(obj, kind).text.slice(0, 70).replace(/\s+/g, ' '));
    }
  }

  console.log(`\n=== ${path.basename(file)} (${lines} lines) ===`);
  console.log('kinds:', JSON.stringify(kinds));
  console.log(`sessions in file: ${sessions.size} [${[...sessions].join(', ')}]`);
  console.log(`parseErrors: ${parseErrors}  dupUuidsWithinFile: ${dupUuids}`);
  console.log(`unique messageIds: ${msgIds.size}`);
  console.log(
    `output tokens raw=${rawOut} dedup=${dedupOut} (inflation x${dedupOut ? (rawOut / dedupOut).toFixed(2) : '?'})`
  );
  console.log(`input tokens  raw=${rawIn} dedup=${dedupIn}`);
  console.log(`human prompts: ${promptTexts.length}`);
  for (const p of promptTexts.slice(0, 12)) console.log('  ' + p);
  if (promptTexts.length > 12) console.log(`  … +${promptTexts.length - 12} more`);
}

const args = process.argv.slice(2);
let files = args.length ? args : [...DEFAULTS];
if (!args.length) {
  const sub = scanTranscripts().find((f) => f.fileKind === 'subagent');
  if (sub) files.push(sub.path);
}

console.log(`smoke-parse over ${files.length} file(s)`);
for (const f of files) {
  try {
    await analyze(f);
  } catch (e) {
    console.error(`FAILED on ${f}:`, e.message);
    process.exitCode = 1;
  }
}
