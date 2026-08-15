/* Live layer: one EventSource to /api/live feeding (a) an in-memory "now"
 * state (never through react-query) and (b) debounced query invalidation on
 * data-change signals. Reconnects on watchdog timeout, tab focus, network. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LIVE_KEYS } from './queries';
import type { LiveSession, IngestProgress } from './types';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface LiveState {
  connection: ConnectionState;
  sessions: LiveSession[];
  ingest: IngestProgress | null;
}

const LiveContext = createContext<LiveState>({ connection: 'connecting', sessions: [], ingest: null });

export function useLive(): LiveState {
  return useContext(LiveContext);
}

const WATCHDOG_MS = 90_000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>({ connection: 'connecting', sessions: [], ingest: null });
  const esRef = useRef<EventSource | null>(null);
  const lastEventRef = useRef(Date.now());
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backfillingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let retryDelay = 1000;

    const invalidate = () => {
      if (invalidateTimer.current) return;
      const delay = backfillingRef.current ? 5000 : 2000;
      invalidateTimer.current = setTimeout(() => {
        invalidateTimer.current = null;
        for (const key of LIVE_KEYS) {
          queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
        }
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      esRef.current?.close();
      const es = new EventSource('/api/live');
      esRef.current = es;
      const touch = () => {
        lastEventRef.current = Date.now();
      };

      es.onopen = () => {
        touch();
        retryDelay = 1000;
        setState((s) => ({ ...s, connection: 'live' }));
        invalidate(); // we may have been blind — refresh
      };
      es.onerror = () => {
        setState((s) => ({ ...s, connection: 'reconnecting' }));
        es.close();
        if (!disposed) setTimeout(connect, (retryDelay = Math.min(retryDelay * 2, 30_000)));
      };
      es.addEventListener('hello', (e) => {
        touch();
        try {
          const d = JSON.parse((e as MessageEvent).data);
          backfillingRef.current = d.ingest?.phase === 'backfill';
          setState({ connection: 'live', sessions: d.live ?? [], ingest: d.ingest ?? null });
        } catch { /* ignore */ }
      });
      es.addEventListener('session-activity', (e) => {
        touch();
        try {
          setState((s) => ({ ...s, sessions: JSON.parse((e as MessageEvent).data) }));
        } catch { /* ignore */ }
      });
      es.addEventListener('ingest-progress', (e) => {
        touch();
        try {
          const d = JSON.parse((e as MessageEvent).data) as IngestProgress;
          backfillingRef.current = d.phase === 'backfill';
          setState((s) => ({ ...s, ingest: d }));
        } catch { /* ignore */ }
        invalidate();
      });
      es.addEventListener('data-changed', () => {
        touch();
        invalidate();
      });
      es.addEventListener('hook', touch);
    };

    connect();

    const watchdog = setInterval(() => {
      if (Date.now() - lastEventRef.current > WATCHDOG_MS) {
        setState((s) => ({ ...s, connection: 'reconnecting' }));
        connect();
      }
    }, 15_000);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastEventRef.current > 30_000) connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', connect);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', connect);
      esRef.current?.close();
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    };
  }, [queryClient]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

/** Ticking clock for elapsed timers; pauses while the tab is hidden. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      stop();
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        start();
      } else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);
  return now;
}
