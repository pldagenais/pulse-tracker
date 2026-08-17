// Which subscription does a session belong to?
//
// Running two Claude accounts on one machine shares everything the tracker
// reads: same ~/.claude/projects, same settings.json, same hooks. Transcripts
// carry NO account identity (no accountUuid, no email), and neither do hook
// payloads — so attribution has to come from the environment of the process
// that fired the hook, captured by hooks/notify.mjs as `_tracker`.
//
// What each signal is worth:
//   CLAUDE_USER_DATA_DIR   the desktop profile dir — one per account. Exact.
//   CLAUDE_TRACKER_ACCOUNT explicit override for a launcher script. Exact.
//   ~/.claude/.credentials.json  has NO identity — only subscriptionType and
//                          rateLimitTier, identical across Max accounts. Useless.
//   ~/.claude.json oauthAccount  carries identity but reflects whichever
//                          instance wrote last, so it cannot say who is running
//                          NOW. We use it one way only: uuid -> email/tier,
//                          which is sound regardless of who wrote it.
//
// A terminal CLI has a single shared credential store, so it is on one account
// at a time — a fact only the user knows. Hence the `cli_account_uuid` setting.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSetting, getMeta, setMeta } from './db.js';
import { log } from './logger.js';

const BACKFILL_FLAG = 'accounts_backfill_v1';
/**
 * A profile only samples while its desktop app is running, and the cadence
 * slackens when it sits idle — ~12min gaps observed with the app up. Keep this
 * loose enough not to cry stale on a live app; `sampledAt` is always returned
 * so the real age stays visible either way.
 */
export const PLAN_USAGE_STALE_MS = 20 * 60 * 1000;

/** @type {Map<string, {mtimeMs: number, value: any}>} */
const jsonCache = new Map();

/**
 * Read + parse JSON, re-reading only when mtime moves. Hooks fire constantly,
 * so this must not stat-and-parse the world on every event.
 * @returns {any} parsed JSON, or null if missing/unreadable/invalid
 */
function readJsonCached(file) {
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    jsonCache.delete(file);
    return null;
  }
  const hit = jsonCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value;
  let value = null;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    value = null;
  }
  jsonCache.set(file, { mtimeMs, value });
  return value;
}

/** The desktop app's default profile — the account you get from the Start Menu. */
function defaultProfileDir() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Claude');
}

/**
 * Candidate desktop profile dirs. Additional accounts get their own userData
 * dir (see CLAUDE_USER_DATA_DIR); we look where they conventionally live and
 * remember any dir a hook has actually reported.
 * @returns {string[]}
 */
function candidateProfileDirs(db) {
  const dirs = new Set([defaultProfileDir()]);
  for (const raw of String(process.env.CLAUDE_TRACKER_PROFILE_DIRS || '').split(';')) {
    if (raw.trim()) dirs.add(path.resolve(raw.trim()));
  }
  const roots = [path.join(os.homedir(), 'ClaudeProfiles'), path.dirname(defaultProfileDir())];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const isProfileRoot = /claudeprofiles$/i.test(root);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // %APPDATA%\Claude-b style siblings, plus anything under ClaudeProfiles\
      if (isProfileRoot || /^claude/i.test(e.name)) dirs.add(path.join(root, e.name));
    }
  }
  try {
    for (const r of db.prepare('SELECT profile_dir FROM accounts WHERE profile_dir IS NOT NULL').all()) {
      if (r.profile_dir) dirs.add(String(r.profile_dir));
    }
  } catch {
    /* table may not exist yet during a very early call */
  }
  return [...dirs];
}

/**
 * @returns {{dir: string, accountUuid: string, orgUuid: string|null, firstLaunchAt: number|null} | null}
 */
function readProfile(dir) {
  const cfg = readJsonCached(path.join(dir, 'config.json'));
  const uuid = cfg && typeof cfg.lastKnownAccountUuid === 'string' ? cfg.lastKnownAccountUuid : null;
  if (!uuid) return null;
  const usage = latestUsageSample(dir);
  return {
    dir,
    accountUuid: uuid,
    orgUuid: typeof usage?.org === 'string' ? usage.org : null,
    firstLaunchAt: typeof cfg.first_launch_at === 'number' ? cfg.first_launch_at : null,
  };
}

/** Newest {t, org, u:{fh, sd}} sample, or null. Samples are appended, but don't assume order. */
function latestUsageSample(dir) {
  const usage = readJsonCached(path.join(dir, 'plan-usage-history.json'));
  const samples = Array.isArray(usage?.samples) ? usage.samples : [];
  let best = null;
  for (const s of samples) {
    if (!s || typeof s.t !== 'number') continue;
    if (!best || s.t > best.t) best = s;
  }
  return best;
}

/** uuid -> {email, orgUuid, tier} from ~/.claude.json. Sound even though "who is current" is not. */
function identityHint() {
  const j = readJsonCached(path.join(os.homedir(), '.claude.json'));
  const o = j?.oauthAccount;
  if (!o || typeof o.accountUuid !== 'string') return null;
  return {
    uuid: o.accountUuid,
    email: typeof o.emailAddress === 'string' ? o.emailAddress : null,
    orgUuid: typeof o.organizationUuid === 'string' ? o.organizationUuid : null,
    tier: typeof o.organizationRateLimitTier === 'string' ? o.organizationRateLimitTier : null,
  };
}

/**
 * Discover desktop profiles and upsert one accounts row per account.
 * Never overwrites a user-set label.
 */
export function syncAccounts(db) {
  const now = Date.now();
  const defDir = defaultProfileDir();
  const found = [];
  for (const dir of candidateProfileDirs(db)) {
    const p = readProfile(dir);
    if (p) found.push(p);
  }
  const hint = identityHint();
  for (const p of found) {
    const isDefault = path.resolve(p.dir) === path.resolve(defDir) ? 1 : 0;
    const matched = hint && hint.uuid === p.accountUuid ? hint : null;
    const org = p.orgUuid ?? matched?.orgUuid ?? null;
    db.prepare(
      `INSERT INTO accounts(uuid, email, org_uuid, label, profile_dir, rate_limit_tier, is_default, first_seen_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(uuid) DO UPDATE SET
         email=coalesce(excluded.email, accounts.email),
         org_uuid=coalesce(excluded.org_uuid, accounts.org_uuid),
         profile_dir=CASE WHEN excluded.is_default=1 THEN excluded.profile_dir
                          WHEN accounts.is_default=1 THEN accounts.profile_dir
                          ELSE coalesce(accounts.profile_dir, excluded.profile_dir) END,
         rate_limit_tier=coalesce(excluded.rate_limit_tier, accounts.rate_limit_tier),
         is_default=max(accounts.is_default, excluded.is_default),
         first_seen_at=min(coalesce(accounts.first_seen_at, excluded.first_seen_at), excluded.first_seen_at),
         last_seen_at=excluded.last_seen_at`
    ).run(p.accountUuid, matched?.email ?? null, org, null, p.dir, matched?.tier ?? null, isDefault, p.firstLaunchAt ?? now, now);
  }
  return found.length;
}

/** All known accounts, with a display name that degrades gracefully. */
export function listAccounts(db) {
  return db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, first_seen_at').all().map((r) => ({
    uuid: String(r.uuid),
    email: r.email ?? null,
    orgUuid: r.org_uuid ?? null,
    label: r.label ?? null,
    profileDir: r.profile_dir ?? null,
    rateLimitTier: r.rate_limit_tier ?? null,
    isDefault: !!r.is_default,
    name: r.label || r.email || `${String(r.uuid).slice(0, 8)}…`,
    firstSeenAt: r.first_seen_at ?? null,
    lastSeenAt: r.last_seen_at ?? null,
  }));
}

/** Accept a uuid, an email, or a user-set label from CLAUDE_TRACKER_ACCOUNT. */
function matchAccount(db, needle) {
  const n = needle.toLowerCase();
  const row = db.prepare(
    'SELECT uuid FROM accounts WHERE lower(uuid)=? OR lower(email)=? OR lower(label)=? LIMIT 1'
  ).get(n, n, n);
  return row ? String(row.uuid) : null;
}

/**
 * Resolve the account for a hook, most-trustworthy signal first.
 * @param {any} tracker the `_tracker` envelope from hooks/notify.mjs
 * @returns {{uuid: string, source: string} | null} null = unattributable
 */
export function resolveAccount(db, tracker) {
  const t = tracker && typeof tracker === 'object' ? tracker : {};

  // 1. explicit override from a launcher — trust it, but only if it names a
  //    known account (a typo must not invent one).
  if (typeof t.account === 'string' && t.account.trim()) {
    const uuid = matchAccount(db, t.account.trim());
    if (uuid) return { uuid, source: 'env-explicit' };
    log.warn(`accounts: CLAUDE_TRACKER_ACCOUNT="${t.account}" matches no known account`);
  }

  // 2. desktop profile dir -> exactly one account
  if (typeof t.userDataDir === 'string' && t.userDataDir.trim()) {
    const p = readProfile(t.userDataDir.trim());
    if (p) return { uuid: p.accountUuid, source: 'env-profile' };
  }

  // No marker at all. Only the extra account's launcher sets a userData dir —
  // the Start-Menu app and a terminal CLI both arrive bare, and nothing on disk
  // tells them apart (the CLI credential store carries no identity). So:

  // 3. the user's own assertion for unmarked sessions, when they've made one
  const declared = String(getSetting(db, 'cli_account_uuid', '') || '');
  if (declared) return { uuid: declared, source: 'cli-setting' };

  // 4. otherwise assume the default desktop profile — right for the common
  //    case, flagged as inferred in the UI, and outranked the moment any real
  //    marker shows up.
  const def = /** @type {any} */ (db.prepare('SELECT uuid FROM accounts WHERE is_default=1 LIMIT 1').get());
  if (def) return { uuid: String(def.uuid), source: 'default-profile' };

  return null;
}

/**
 * How much each signal is worth. Precedence is by CONFIDENCE, not arrival
 * order: a session backfilled by the cutover heuristic, or guessed from the
 * unmarked-session setting, must yield to hard evidence when its app finally
 * fires a hook — a long-running session resumed under the other account is
 * exactly this case. Equal confidence never overwrites, so among two exact
 * signals the first still wins and a later login flip cannot relabel work.
 */
const SOURCE_RANK = /** @type {Record<string, number>} */ ({
  backfill: 0,
  'default-profile': 1,
  'cli-setting': 2,
  'env-profile': 3,
  'env-explicit': 4,
  manual: 5,
});

export function recordSessionAccount(db, sessionId, resolved) {
  if (!sessionId || !resolved?.uuid) return false;
  const cur = /** @type {any} */ (db.prepare('SELECT account_uuid, source FROM session_accounts WHERE session_id=?').get(String(sessionId)));
  if (cur && (SOURCE_RANK[resolved.source] ?? 0) <= (SOURCE_RANK[cur.source] ?? 0)) return false;
  db.prepare(
    `INSERT INTO session_accounts(session_id, account_uuid, source, ts) VALUES(?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       account_uuid=excluded.account_uuid, source=excluded.source, ts=excluded.ts`
  ).run(String(sessionId), resolved.uuid, resolved.source, Date.now());
  return true;
}

/** Manual correction from the UI — the one path allowed to overwrite. */
export function setSessionAccount(db, sessionId, accountUuid) {
  db.prepare(
    `INSERT INTO session_accounts(session_id, account_uuid, source, ts) VALUES(?,?,'manual',?)
     ON CONFLICT(session_id) DO UPDATE SET account_uuid=excluded.account_uuid, source='manual', ts=excluded.ts`
  ).run(String(sessionId), String(accountUuid), Date.now());
}

/**
 * One-time backfill. Every session that predates the first non-default profile
 * belongs to the default account by construction — there was no other account
 * to run them. Sessions after that are left alone for live attribution.
 */
export function backfillAccounts(db) {
  if (getMeta(db, BACKFILL_FLAG)) return 0;
  const accounts = listAccounts(db);
  const def = accounts.find((a) => a.isDefault);
  if (!def) return 0; // nothing to attribute to yet

  const configured = Number(getSetting(db, 'account_cutover_ms', '')) || 0;
  const others = accounts.filter((a) => !a.isDefault && a.firstSeenAt);
  const discovered = others.length ? Math.min(...others.map((a) => Number(a.firstSeenAt))) : 0;
  const cutover = configured || discovered;
  if (!cutover) return 0; // single account so far — nothing to disambiguate

  const r = db.prepare(
    `INSERT OR IGNORE INTO session_accounts(session_id, account_uuid, source, ts)
     SELECT id, ?, 'backfill', ? FROM sessions WHERE started_at < ?`
  ).run(def.uuid, Date.now(), cutover);
  setMeta(db, BACKFILL_FLAG, String(cutover));
  log.info(`accounts: backfilled ${r.changes} session(s) before ${new Date(cutover).toISOString()} to ${def.name}`);
  return Number(r.changes);
}

/**
 * Real rate-limit consumption straight from each desktop profile — far better
 * than our cost estimate, but only fresh while that app is running, so
 * staleness is reported rather than hidden.
 */
export function readPlanUsage(db) {
  const now = Date.now();
  return listAccounts(db)
    .filter((a) => a.profileDir)
    .map((a) => {
      const s = latestUsageSample(/** @type {string} */ (a.profileDir));
      const sampledAt = typeof s?.t === 'number' ? s.t : null;
      return {
        accountUuid: a.uuid,
        name: a.name,
        email: a.email,
        isDefault: a.isDefault,
        fivehourPct: typeof s?.u?.fh === 'number' ? s.u.fh : null,
        sevendayPct: typeof s?.u?.sd === 'number' ? s.u.sd : null,
        sampledAt,
        stale: sampledAt == null || now - sampledAt > PLAN_USAGE_STALE_MS,
      };
    });
}
