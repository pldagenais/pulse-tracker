import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { LiveProvider } from './lib/live';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveProvider>
        <RouterProvider router={router} />
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
