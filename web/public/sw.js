// Minimal service worker: makes Pulse installable as a windowed app and shows
// a friendly page if the tracker service is down. Network-first for everything
// (all data is live); nothing is cached.
//
// The offline page MUST be no-store and MUST retry itself. Without that a tab
// which caught one failed navigation — the ~10s window while the scheduled task
// restarts the server — keeps rendering "offline" afterwards even though the
// server is answering 200, which reads as "the app is broken".
const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Pulse — offline</title>
<style>
  :root { color-scheme: light dark }
  body{background:#07090d;color:#94a1b2;font-family:ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0;text-align:center}
  @media (prefers-color-scheme: light){ body{background:#eef1f7;color:#44516b} }
  button{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:6px;padding:.4em 1em;cursor:pointer}
</style>
</head><body><div><div style="font-size:40px">▌</div><p>The Pulse tracker service isn't responding.<br>
It normally restarts itself within a minute or two.<br><br>
If it stays down: <code>schtasks /run /tn ClaudeTimeTracker</code></p>
<p><button onclick="location.reload()">retry now</button></p>
<script>
  // poll until the server answers, then reload — a stuck tab heals itself
  setInterval(function () {
    fetch('/api/heartbeat', { cache: 'no-store' })
      .then(function (r) { if (r.ok) location.reload(); })
      .catch(function () {});
  }, 3000);
</script>
</div></body></html>`;

const offlineResponse = () =>
  new Response(OFFLINE_HTML, {
    headers: {
      'content-type': 'text/html',
      // never let this synthesized page be reused for a later navigation
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // API/assets: straight to network
  e.respondWith(fetch(e.request).catch(offlineResponse));
});
