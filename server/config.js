import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const CLAUDE_DIR = process.env.CLAUDE_TRACKER_CLAUDE_DIR || path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
export const DATA_DIR = process.env.CLAUDE_TRACKER_DATA_DIR || path.join(ROOT, 'data');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const DB_PATH = path.join(DATA_DIR, 'tracker.db');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.CLAUDE_TRACKER_PORT || 5599);
export const APP_NAME = 'claude-time-tracker';
export const APP_VERSION = '1.0.0';

// Cloud mirror (opt-in). Absent config disables sync entirely, so the local
// app behaves exactly as it always has.
export const CLOUD_URL = process.env.PULSE_CONVEX_URL || '';
export const CLOUD_KEY = process.env.PULSE_AGENT_KEY || '';
export const CLOUD_SYNC_DAYS = Number(process.env.PULSE_SYNC_DAYS || 90);
export const CLOUD_ENABLED = !!(CLOUD_URL && CLOUD_KEY);

// Timing-model defaults (minutes; overridable via settings table)
export const DEFAULT_IDLE_THRESHOLD_MIN = 10;
export const DEFAULT_STALL_CAP_MIN = 10;

// Live-status heuristics
export const LIVE_FILE_ACTIVITY_MS = 60_000; // file grew this recently => session working
export const STALE_SESSION_SWEEP_MS = 24 * 3600 * 1000; // idle this long => mark ended

// Maintenance cadence
export const RESCAN_INTERVAL_MS = 10 * 60 * 1000;
export const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
export const HOOK_EVENTS_RETENTION_MS = 14 * 24 * 3600 * 1000;

// Ingestion
export const INGEST_BATCH_BYTES = 5 * 1024 * 1024;
