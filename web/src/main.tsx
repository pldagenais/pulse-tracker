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
import { t } from './lib/i18n';
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

// Tell open tabs about new builds. Assets are content-hashed but a tab keeps
// its loaded modules and cached index.html forever, and vite:preloadError only
// fires if the user navigates to a route whose chunk 404s. Poll build.json and
// offer a reload — never force one; the user may be mid-prompt on Run.
const UPDATE_POLL_MS = 5 * 60_000;
function watchForNewBuild() {
  if (import.meta.env.DEV) return;
  let offered = false;
  const check = async () => {
    if (offered) return;
    try {
      const r = await fetch('/build.json', { cache: 'no-store' });
      if (!r.ok) return;
      const { buildId } = (await r.json()) as { buildId?: string };
      if (buildId && buildId !== __BUILD_ID__) {
        offered = true;
        showUpdateToast();
      }
    } catch {
      /* offline or mid-deploy — try again next tick */
    }
  };
  setInterval(check, UPDATE_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
function showUpdateToast() {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.className =
    'fixed bottom-4 right-4 z-[100] flex items-center gap-3 rounded-xl border border-line2 bg-raise px-4 py-3 font-mono text-[12px] text-ink shadow-2xl';
  // raw DOM, not a component: read the locale at show time
  const msg = document.createElement('span');
  msg.textContent = t('update.available');
  const btn = document.createElement('button');
  btn.className = 'rounded border border-claude/50 bg-claude/10 px-2.5 py-1 uppercase tracking-wider text-claude hover:bg-claude/20';
  btn.textContent = t('update.reload');
  btn.addEventListener('click', () => window.location.reload());
  el.append(msg, btn);
  document.body.appendChild(el);
}
watchForNewBuild();

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
