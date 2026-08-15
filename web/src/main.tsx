import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { Authenticated, Unauthenticated } from 'convex/react';
import { LiveProvider } from './lib/live';
import { MODE } from './lib/source';
import { convex } from './lib/convexClient';
import { api } from './lib/api';
import { setDayKeyZone } from './lib/time';
import { SignIn } from './components/layout/SignIn';
import { initTheme } from './lib/theme';
import { router } from './routes';
import './index.css';

initTheme();

// PWA: installable window + offline shell (badge updates live in AppLayout)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* http://127.0.0.1 is a secure context, but never let SW failures break the app */
  });
}

// Self-heal after deploys: an open tab from an older build references hashed
// chunks that no longer exist — reload once instead of crashing on navigation.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  const KEY = 'pulse-chunk-reload';
  if (sessionStorage.getItem(KEY) !== '1') {
    sessionStorage.setItem(KEY, '1');
    window.location.reload();
  }
});
window.addEventListener('load', () => sessionStorage.removeItem('pulse-chunk-reload'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * Cloud only: learn the agent's timezone BEFORE the first query renders.
 * Day keys are minted in the agent's zone; a browser a zone ahead would ask
 * for `overview:<tomorrow-on-the-PC>` — a key that never exists — and every
 * day-keyed card would skeleton forever. todayKey() is called during render,
 * so the zone cannot be retrofitted after queries have fired.
 */
function TzGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<{ tz: string | null }>('/api/heartbeat')
      .then((hb) => setDayKeyZone(hb?.tz ?? null))
      // no heartbeat yet → browser-zone fallback beats a blank page
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  if (!ready) return null; // one network round-trip; the aurora backdrop shows
  return <>{children}</>;
}

const app = (
  <QueryClientProvider client={queryClient}>
    <LiveProvider>
      <RouterProvider router={router} />
    </LiveProvider>
  </QueryClientProvider>
);

// Cloud mode gates the whole app behind GitHub sign-in. Local mode is
// reachable only from this machine, so it stays exactly as it was.
const tree =
  MODE === 'cloud' && convex ? (
    <ConvexAuthProvider client={convex}>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <TzGate>{app}</TzGate>
      </Authenticated>
    </ConvexAuthProvider>
  ) : (
    app
  );

createRoot(document.getElementById('root')!).render(<StrictMode>{tree}</StrictMode>);
