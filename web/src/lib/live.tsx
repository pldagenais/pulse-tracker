/* Live layer: one EventSource to /api/live feeding (a) an in-memory "now"
 * state (never through react-query) and (b) debounced query invalidation on
 * data-change signals. Reconnects on watchdog timeout, tab focus, network.
 *
 * Cloud mode has no SSE endpoint — Vercel serves static files only — so it
 * polls the mirrored `live` snapshot instead, on the agent's own 15s cadence. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LIVE_KEYS } from './queries';
import { MODE } from './source';
import { api } from './api';
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
// The agent mirrors `live` every 15s but the heavier snapshots only every 60s,
// so refetching the page queries faster than that costs reads and buys nothing.
const CLOUD_POLL_MS = 15_000;
const CLOUD_INVALIDATE_MS = 60_000;

/** Cloud mode: poll the mirrored live snapshot; no SSE exists to connect to. */
function CloudLiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>({ connection: 'connecting', sessions: [], ingest: null });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastInvalidated = 0;

    const tick = async () => {
      if (timer) clearTimeout(timer); // a refocus must not start a second chain
      timer = null;
      try {
        const sessions = await api.get<LiveSession[] | null>('/api/live');
        if (disposed) return;
        setState({ connection: 'live', sessions: sessions ?? [], ingest: null });
        if (Date.now() - lastInvalidated >= CLOUD_INVALIDATE_MS) {
          lastInvalidated = Date.now();
          for (const key of LIVE_KEYS) {
            queryClient.invalidateQueries({ queryKey: key, refetchType: 'active' });
          }
        }
      } catch {
        if (!disposed) setState((s) => ({ ...s, connection: 'reconnecting' }));
      }
      if (!disposed) timer = setTimeout(tick, CLOUD_POLL_MS);
    };

    tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [queryClient]);

  return <LiveContext.Provider value={state}>{children}</LiveContext.Provider>;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  if (MODE === 'cloud') return <CloudLiveProvider>{children}</CloudLiveProvider>;
  return <LocalLiveProvider>{children}</LocalLiveProvider>;
}

function LocalLiveProvider({ children }: { children: ReactNode }) {
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
