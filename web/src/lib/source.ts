// Pulse runs in two modes from one codebase:
//   local — served by the Node server on 127.0.0.1, talks to its REST API
//   cloud — served by Vercel, reads the Convex mirror
// This module is the pure part of that decision so it can be unit tested.

export type Mode = 'local' | 'cloud';

export function detectMode(hostname: string): Mode {
  return hostname === '127.0.0.1' || hostname === 'localhost' ? 'local' : 'cloud';
}

export const MODE: Mode =
  typeof window === 'undefined' ? 'local' : detectMode(window.location.hostname);

export interface RemoteCall {
  fn: string;
  args: Record<string, unknown>;
}

/**
 * Map a local REST path to the Convex call that serves it in cloud mode.
 * `null` means the capability physically needs the local machine, so cloud
 * mode surfaces it as unavailable rather than silently failing.
 */
export function resolveRemote(path: string): RemoteCall | null {
  const [raw, qs = ''] = path.split('?');
  const q = new URLSearchParams(qs);
  const snapshot = (key: string): RemoteCall => ({ fn: 'snapshots:get', args: { key } });
  const day = q.get('date') ?? '';

  // local-only capabilities: process control, file editing, CLI management
  if (
    raw.startsWith('/api/manage/') ||
    raw.startsWith('/api/memory') ||
    raw.startsWith('/api/routines') ||
    /\/(open|resume|kill|continue)$/.test(raw)
  ) {
    return null;
  }

  if (raw === '/api/overview') return snapshot(`overview:${day}`);
  if (raw === '/api/timeline') return snapshot(`timeline:${day}`);
  if (raw === '/api/projects') return snapshot('projects');
  if (raw === '/api/heatmap') return snapshot('heatmap');
  if (raw === '/api/prs') return snapshot('prs');
  if (raw === '/api/claudeai') return snapshot('claudeai');
  if (raw === '/api/usage-window') return snapshot('usagewindow');
  if (raw === '/api/token-flow') return snapshot('tokenflow');

  // the cloud mirrors one canonical range per grouping; the range is dropped
  if (raw === '/api/stats') return snapshot(`insights:${q.get('groupBy') ?? 'day'}`);

  const project = raw.match(/^\/api\/projects\/(\d+)$/);
  if (project) return snapshot(`project:${project[1]}`);

  // Only the current month is mirrored; earlier months resolve to a key that
  // does not exist, which the calendar renders as an empty month.
  const calendar = raw.match(/^\/api\/projects\/(\d+)\/calendar$/);
  if (calendar) return snapshot(`calendar:${calendar[1]}:${q.get('month') ?? ''}`);

  const session = raw.match(/^\/api\/sessions\/([\w-]+)$/);
  if (session) return snapshot(`session:${session[1]}`);

  // As with /api/stats, one canonical range (all-time) is mirrored, so the
  // range selector is normalised away remotely.
  const report = raw.match(/^\/api\/report\/(\d+)$/);
  if (report) return snapshot(`report:${report[1]}`);

  if (raw === '/api/sessions') {
    return { fn: 'sessions:list', args: { limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/prompts') {
    return { fn: 'prompts:search', args: { q: q.get('q') ?? '', limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/journal') {
    return { fn: 'journal:list', args: { limit: Number(q.get('pageSize')) || 50 } };
  }
  if (raw === '/api/jobs') return { fn: 'jobs:list', args: { limit: 20 } };
  if (raw === '/api/status') return { fn: 'agentStatus:get', args: {} };
  // deliberately not served by snapshots:get — the banner must still work when
  // the status snapshot is missing, which is when the PC is most likely down
  if (raw === '/api/heartbeat') return { fn: 'agentStatus:heartbeat', args: {} };
  // There is no SSE in cloud mode; the agent mirrors the live list to a
  // snapshot instead and the client polls it (see LiveProvider).
  if (raw === '/api/live') return snapshot('live');

  return null;
}
