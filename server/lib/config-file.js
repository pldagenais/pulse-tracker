import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

/**
 * Read `data/<name>.json`, falling back when absent or malformed. Used for
 * account-scoped values that must stay out of the git repository.
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @returns {T}
 */
export function readConfigFile(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}
