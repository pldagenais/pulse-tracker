// Mirrors the local database into Convex so the dashboard is reachable
// remotely. Payloads are fetched from this server's own HTTP API rather than
// rebuilt, which makes shape parity with the REST responses true by
// construction. Sync is fire-and-forget: a cloud outage never affects local
// operation.
import { ConvexHttpClient } from 'convex/browser';
// anyApi rather than the generated api: importing the generated module would
// drag Convex's TypeScript sources into this package's nodenext typecheck.
import { anyApi as api } from 'convex/server';
import { CLOUD_URL, CLOUD_KEY, CLOUD_SYNC_DAYS } from '../../config.js';
import { getMeta, setMeta } from '../db.js';
import { todayKey, addDays, safeJsonParse } from '../util.js';
import {
  hashPayload,
  staticSnapshots,
  daySnapshots,
  projectSnapshots,
  calendarSnapshots,
  reportSnapshots,
} from './keys.js';
import { redactSecrets } from './redact.js';
import { createQueuePoller } from './jobs.js';
import { log } from '../logger.js';

const SYNC_MS = 60_000;
const LIVE_MS = 15_000;
const SNAPSHOT_BATCH = 10;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ port: number, appVersion: string, jobs: any }} opts
 */
export function createCloudSync(db, { port, appVersion, jobs }) {
  const client = new ConvexHttpClient(CLOUD_URL);

  /** Fetch a payload from our own REST API (guarantees identical shapes). */
  const local = async (path) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const json = /** @type {any} */ (await res.json());
    if (!json.ok) throw new Error(`local ${path} -> ${json.error}`);
    return json.data;
  };

  const putSnapshots = (items) =>
    client.mutation(api.sync.putSnapshots, { agentKey: CLOUD_KEY, items });

  const readHashes = () => safeJsonParse(getMeta(db, 'cloud_hashes') ?? '{}') ?? {};
  const writeHashes = (h) => setMeta(db, 'cloud_hashes', JSON.stringify(h));

  async function pushSnapshots() {
    const hashes = readHashes();
    const projects = await local('/api/projects').catch(() => []);
    const specs = /** @type {{key: string, kind: string, day?: string, path: string}[]} */ ([
      ...staticSnapshots(todayKey(), addDays),
      ...projectSnapshots(projects),
      ...calendarSnapshots(projects, todayKey().slice(0, 7)),
      ...reportSnapshots(projects),
      ...daySnapshots(CLOUD_SYNC_DAYS, todayKey(), addDays),
    ]);
    let batch = [];
    let written = 0;
    for (const spec of specs) {
      let payload;
      try {
        payload = await local(spec.path);
      } catch {
        continue; // a single bad endpoint must not stall the whole cycle
      }
      const hash = hashPayload(payload);
      if (hashes[spec.key] === hash) continue; // unchanged — skip the write
      hashes[spec.key] = hash;
      batch.push({ key: spec.key, kind: spec.kind, day: spec.day, payload, updatedAt: Date.now() });
      if (batch.length >= SNAPSHOT_BATCH) {
        await putSnapshots(batch);
        written += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await putSnapshots(batch);
      written += batch.length;
    }
    writeHashes(hashes);
    return written;
  }

  async function pushSessions() {
    const since = Number(getMeta(db, 'cloud_cursor_sessions') ?? 0);
    const rows = /** @type {any[]} */ (db.prepare(
      `SELECT id, COALESCE(last_event_at, started_at, 0) cursor_ts
         FROM sessions
        WHERE COALESCE(last_event_at, started_at, 0) > ?
        ORDER BY cursor_ts LIMIT 40`
    ).all(since));
    if (!rows.length) return 0;

    const items = [];
    const details = [];
    for (const r of rows) {
      let detail;
      try {
        detail = await local(`/api/sessions/${r.id}`);
      } catch {
        continue;
      }
      const s = detail?.session;
      if (!s) continue;
      items.push({
        sessionId: s.id,
        projectId: s.projectId,
        projectName: s.projectName ?? '',
        title: s.title ?? null,
        startedAt: s.startedAt ?? null,
        claudeMs: s.claudeMs ?? 0,
        estCostUsd: s.estCostUsd ?? null,
        promptCount: s.promptCount ?? 0,
        payload: s,
        updatedAt: Date.now(),
      });
      details.push({ key: `session:${s.id}`, kind: 'session', payload: detail, updatedAt: Date.now() });
    }
    if (items.length) await client.mutation(api.sync.putSessions, { agentKey: CLOUD_KEY, items });
    for (let i = 0; i < details.length; i += SNAPSHOT_BATCH) {
      await putSnapshots(details.slice(i, i + SNAPSHOT_BATCH));
    }
    setMeta(db, 'cloud_cursor_sessions', String(Math.max(...rows.map((r) => r.cursor_ts), since)));
    return items.length;
  }

  async function pushPrompts() {
    const since = Number(getMeta(db, 'cloud_cursor_prompts') ?? 0);
    const rows = /** @type {any[]} */ (db.prepare(
      `SELECT p.uuid, p.session_id, p.project_id, p.ts, p.kind, p.text, p.char_count,
              pr.name project_name, s.title session_title
         FROM prompts p
         LEFT JOIN projects pr ON pr.id = p.project_id
         LEFT JOIN sessions s ON s.id = p.session_id
        WHERE p.ts > ? ORDER BY p.ts LIMIT 300`
    ).all(since));
    if (!rows.length) return 0;
    await client.mutation(api.sync.putPrompts, {
      agentKey: CLOUD_KEY,
      items: rows.map((r) => ({
        uuid: r.uuid,
        sessionId: r.session_id,
        projectId: r.project_id ?? 0,
        projectName: r.project_name ?? null,
        sessionTitle: r.session_title ?? null,
        ts: r.ts,
        kind: r.kind,
        // credentials sometimes get pasted into prompts — never mirror them
        text: redactSecrets(r.text ?? ''),
        charCount: r.char_count ?? 0,
      })),
    });
    setMeta(db, 'cloud_cursor_prompts', String(rows[rows.length - 1].ts));
    return rows.length;
  }

  async function pushJournal() {
    const since = Number(getMeta(db, 'cloud_cursor_journal') ?? 0);
    const rows = /** @type {any[]} */ (db.prepare(
      `SELECT j.id, j.ts, j.project_path, j.session_id, j.text, j.source, p.name project_name
         FROM journal j LEFT JOIN projects p ON p.path = j.project_path
        WHERE j.id > ? ORDER BY j.id LIMIT 200`
    ).all(since));
    if (!rows.length) return 0;
    await client.mutation(api.sync.putJournal, {
      agentKey: CLOUD_KEY,
      items: rows.map((r) => ({
        localId: r.id,
        ts: r.ts,
        projectPath: r.project_path ?? null,
        projectName: r.project_name ?? null,
        sessionId: r.session_id ?? null,
        text: r.text,
        source: r.source,
      })),
    });
    setMeta(db, 'cloud_cursor_journal', String(rows[rows.length - 1].id));
    return rows.length;
  }

  async function pushLive() {
    const overview = await local('/api/overview');
    const live = overview?.liveSessions ?? [];
    await putSnapshots([{ key: 'live', kind: 'live', payload: live, updatedAt: Date.now() }]);
    await client.mutation(api.sync.heartbeat, {
      agentKey: CLOUD_KEY,
      version: appVersion,
      // the zone all mirrored day keys were minted in — remote browsers
      // format their day keys against this, not their own zone
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ingestPhase: 'watching',
      liveCount: live.length,
      dbSessions: /** @type {any} */ (db.prepare('SELECT count(*) c FROM sessions').get()).c,
      syncedThrough: Date.now(),
    });
  }

  let timers = [];
  let running = false;

  async function cycle() {
    if (running) return;
    running = true;
    try {
      const snaps = await pushSnapshots();
      const sessions = await pushSessions();
      const prompts = await pushPrompts();
      const journal = await pushJournal();
      if (snaps || sessions || prompts || journal) {
        log.info(`cloud sync: ${snaps} snapshots, ${sessions} sessions, ${prompts} prompts, ${journal} journal`);
      }
    } catch (e) {
      log.warn('cloud sync failed:', e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  }

  const poller = createQueuePoller(client, { jobs, db });

  return {
    start() {
      timers.push(setInterval(cycle, SYNC_MS));
      timers.push(setInterval(() => pushLive().catch(() => {}), LIVE_MS));
      timers.forEach((t) => t.unref());
      setTimeout(() => cycle(), 8_000).unref();
      poller.start();
      log.info(`cloud sync started (${CLOUD_SYNC_DAYS}-day window) -> ${CLOUD_URL}`);
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
      poller.stop();
    },
    syncNow: cycle,
  };
}
