import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config.js';
import { MIGRATIONS } from './migrations.js';
import { log } from './logger.js';

/** @type {DatabaseSync | null} */
let _db = null;

export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  migrate(db);
  _db = db;
  return db;
}

export function getDb() {
  if (!_db) throw new Error('DB not opened yet');
  return _db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
  let version = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    log.info(`db: applying migration v${m.version}`);
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(String(m.version));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    version = m.version;
  }
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return row ? row.value : undefined;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
