import crypto from 'node:crypto';

/**
 * Stable hash of a payload. Object keys are sorted before serialisation so
 * that re-computing an identical payload never produces a different hash —
 * that is what lets the sync loop skip unchanged snapshots.
 * @param {unknown} value
 * @returns {string}
 */
export function hashPayload(value) {
  const stable = JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  );
  return crypto.createHash('sha1').update(stable ?? 'null').digest('hex');
}

/**
 * Mirrors that are not keyed by a single day. Each entry names the local REST
 * path whose response is stored verbatim under `key`.
 *
 * `/api/stats` is range-parameterised, but the cloud copy cannot hold every
 * range the user might pick. We mirror one canonical window (90 days back)
 * per grouping, and cloud mode normalises the range away when resolving —
 * so remotely the Insights range selector shows the 90-day view.
 * @param {string} todayKey
 * @param {(day: string, n: number) => string} addDays
 * @returns {{key: string, kind: string, path: string}[]}
 */
export function staticSnapshots(todayKey, addDays) {
  const to = todayKey;
  const from = addDays(todayKey, -89);
  const stats = (groupBy) => `/api/stats?groupBy=${groupBy}&from=${from}&to=${to}`;
  return [
    { key: 'projects', kind: 'projects', path: '/api/projects' },
    { key: 'heatmap', kind: 'heatmap', path: '/api/heatmap' },
    { key: 'insights:day', kind: 'insights', path: stats('day') },
    { key: 'insights:model', kind: 'insights', path: stats('model') },
    { key: 'insights:tool', kind: 'insights', path: stats('tool') },
    { key: 'insights:skill', kind: 'insights', path: stats('skill') },
    { key: 'insights:hour', kind: 'insights', path: stats('hour') },
    { key: 'prs', kind: 'insights', path: '/api/prs' },
    { key: 'tokenflow', kind: 'insights', path: '/api/token-flow?days=30' },
    { key: 'claudeai', kind: 'insights', path: '/api/claudeai' },
    { key: 'usagewindow', kind: 'status', path: '/api/usage-window' },
    { key: 'status', kind: 'status', path: '/api/status' },
  ];
}

/**
 * Day-keyed mirrors across a rolling window, newest first.
 * @param {number} days
 * @param {string} todayKey
 * @param {(day: string, n: number) => string} addDays
 * @returns {{key: string, kind: string, day: string, path: string}[]}
 */
export function daySnapshots(days, todayKey, addDays) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = i === 0 ? todayKey : addDays(todayKey, -i);
    out.push({ key: `overview:${day}`, kind: 'overview', day, path: `/api/overview?date=${day}` });
    out.push({ key: `timeline:${day}`, kind: 'timeline', day, path: `/api/timeline?date=${day}` });
  }
  return out;
}
