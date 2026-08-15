// Minimal service worker: makes Pulse installable as a windowed app and shows
// a friendly page if the tracker service is down. Network-first for everything
// (all data is live); only the tiny offline shell is cached.
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pulse — offline</title>
<style>body{background:#07090d;color:#94a1b2;font-family:ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0;text-align:center}</style>
</head><body><div><div style="font-size:40px">▌</div><p>The Pulse tracker service isn't responding.<br>
It normally restarts itself within a minute or two.<br><br>
If it stays down: <code>schtasks /run /tn ClaudeTimeTracker</code></p></div></body></html>`;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API/assets: straight to network
  e.respondWith(
    fetch(e.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html' } })
    )
  );
});
