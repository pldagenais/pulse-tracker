// Minimal Server-Sent Events hub.
import { log } from './lib/logger.js';

export function createSseHub() {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try { res.write(': ping\n\n'); } catch { clients.delete(res); }
    }
  }, 25_000);
  heartbeat.unref();

  function handler(req, res, helloPayload) {
    req.socket.setTimeout(0);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify(helloPayload ?? {})}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  function broadcast(event, data) {
    if (!clients.size) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(frame); } catch (e) {
        clients.delete(res);
        log.warn('sse write failed:', e.message);
      }
    }
  }

  return { handler, broadcast, get clientCount() { return clients.size; } };
}
