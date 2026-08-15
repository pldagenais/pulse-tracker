import fs from 'node:fs';
import path from 'node:path';
import { PROJECTS_DIR } from '../config.js';

/**
 * Classify a transcript path.
 *  - <projects>/<folder>/<uuid>.jsonl                         -> main
 *  - <projects>/<folder>/<sessionDir>/subagents/.../agent-*.jsonl -> subagent
 *  - anything else                                            -> skip
 */
export function classifyPath(full) {
  const rel = path.relative(PROJECTS_DIR, full);
  const segs = rel.split(/[\\/]/);
  const name = segs[segs.length - 1];
  // The tracker's own report-summarization runs (claude -p from data/llm)
  // would otherwise pollute the stats with meta-sessions.
  if (segs[0] && segs[0].includes('Time-Tracker-data-llm')) {
    return { path: full, fileKind: 'skip', agentId: null };
  }
  if (segs.length === 2) return { path: full, fileKind: 'main', agentId: null };
  const m = name.match(/^agent-([0-9a-f]+)\.jsonl$/i);
  if (m) return { path: full, fileKind: 'subagent', agentId: m[1] };
  return { path: full, fileKind: 'skip', agentId: null };
}

/**
 * Enumerate all transcript files under ~/.claude/projects.
 * Tolerates empty shell folders and unreadable directories.
 * @returns {{path:string, fileKind:'main'|'subagent', agentId:string|null}[]}
 */
export function scanTranscripts() {
  /** @type {any[]} */
  const out = [];
  walk(PROJECTS_DIR, out, 0);
  return out;
}

function walk(dir, out, depth) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 8) walk(full, out, depth + 1); // transcripts sit well within this depth
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      const c = classifyPath(full);
      if (c.fileKind !== 'skip') out.push(c);
    }
  }
}
