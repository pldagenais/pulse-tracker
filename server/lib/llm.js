// Shared headless-LLM helper: one-shot `claude -p` calls (report summaries,
// session auto-tagging). Runs from data/llm so its own transcripts are
// excluded from ingestion (see scan.js + the hook-route cwd guard).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from '../config.js';

export const LLM_DIR = path.join(DATA_DIR, 'llm');

/**
 * @param {string} prompt
 * @param {{ model?: string, maxTurns?: number, timeoutMs?: number, configDir?: string }} [opts]
 * @returns {Promise<string>}
 */
export function runClaude(prompt, { model = 'claude-haiku-4-5', maxTurns = 1, timeoutMs = 180_000, configDir = '' } = {}) {
  fs.mkdirSync(LLM_DIR, { recursive: true });
  return new Promise((resolve, reject) => {
    // A separate config dir has its own .credentials.json, so reports can bill
    // to a different subscription than the interactive CLI.
    const env = configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : process.env;
    const child = spawn('claude', ['-p', '--model', model, '--max-turns', String(maxTurns)], {
      shell: true,
      cwd: LLM_DIR,
      env,
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    // claude may exit before the prompt is fully written (e.g. auth errors) —
    // an unhandled EPIPE on stdin would take down the whole server.
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`summarizer timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = out.trim();
      if (/not logged in/i.test(stdout)) {
        reject(new Error(
          configDir
            ? `the claude CLI in ${configDir} is not signed in — run \`CLAUDE_CONFIG_DIR=${configDir} claude\` then \`/login\` once.`
            : 'the claude CLI is not signed in — open a terminal, run `claude`, then `/login` once. Summaries use your Claude subscription through the CLI.'
        ));
      } else if (code === 0 && stdout) {
        resolve(stdout);
      } else {
        reject(new Error((err.trim() || stdout || `claude exited ${code}`).slice(0, 300)));
      }
    });
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch { /* close handler reports the failure */ }
  });
}
