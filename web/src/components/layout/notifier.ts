import { useEffect, useRef } from 'react';
import { useLive } from '../../lib/live';
import { fmtDuration } from '../../lib/format';
// Non-reactive t/tf on purpose: notifications fire at event time, so the
// locale is read when the toast is built, not at render.
import { t, tf } from '../../lib/i18n';
import type { LiveSession } from '../../lib/types';

export const NOTIFY_KEY = 'pulse-notify';
const MIN_RUN_MS = 5 * 60_000;

/**
 * Desktop notification when a session that worked >= 5 minutes stops working.
 * Opt-in (Status page) and requires granted browser permission.
 */
export function useCompletionNotifier() {
  const { sessions } = useLive();
  const prev = useRef<Map<string, LiveSession>>(new Map());

  useEffect(() => {
    const cur = new Map(sessions.map((s) => [s.sessionId, s]));
    const enabled =
      localStorage.getItem(NOTIFY_KEY) === '1' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted';
    if (enabled) {
      const notify = (title: string, body: string, silent = true) => {
        try {
          new Notification(title, { body, silent });
        } catch {
          /* notification construction can throw in odd states — never break the app */
        }
      };
      for (const [sid, p] of prev.current) {
        const now = cur.get(sid);
        // long run finished
        if (p.status === 'working' && !(now && now.status === 'working') && now?.status !== 'needs-you') {
          const ranMs = Date.now() - p.since;
          if (ranMs >= MIN_RUN_MS) {
            notify(tf('notify.finished', { project: p.projectName ?? 'Claude' }), `${p.title ?? p.lastPrompt ?? t('notify.sessionComplete')} · ${fmtDuration(ranMs)}`);
          }
        }
        // session started waiting on the user (permission prompt etc.)
        if (now && now.status === 'needs-you' && p.status !== 'needs-you') {
          notify(tf('notify.needsYou', { project: now.projectName ?? 'Claude' }), now.notification ?? t('notify.waitingBody'), false);
        }
        // session looks stalled
        if (now && now.stalled && !p.stalled) {
          notify(tf('notify.mayBeStalled', { project: now.projectName ?? 'Claude' }), t('notify.stalledBody'));
        }
      }
      // brand-new sessions that appear already needing attention
      for (const [sid, s] of cur) {
        if (!prev.current.has(sid) && s.status === 'needs-you') {
          notify(tf('notify.needsYou', { project: s.projectName ?? 'Claude' }), s.notification ?? t('notify.waitingBody'), false);
        }
      }
    }
    prev.current = cur;
  }, [sessions]);
}
