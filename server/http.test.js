import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { spaFallback } from './http.js';

/** Serve one request against a bare app carrying only the fallback. */
async function get(webDist, url) {
  const app = express();
  app.use(spaFallback(webDist));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((r) => server.once('listening', r));
    const { port } = /** @type {any} */ (server.address());
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    return { status: res.status, body: await res.text() };
  } finally {
    server.close();
  }
}

test('deep URLs serve the shell from a dist dir inside a dot-directory', async () => {
  // Every git worktree in this repo lives under `.claude/worktrees/<branch>`,
  // and sendFile without a `root` refuses any path with a dot-segment.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'http-'));
  try {
    const dist = path.join(root, '.claude', 'worktrees', 'wt-abc123', 'web', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');

    for (const url of ['/manage', '/projects/9', '/']) {
      const res = await get(dist, url);
      assert.equal(res.status, 200, `${url} should serve the shell`);
      assert.match(res.body, /shell/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unbuilt UI still reports 503 rather than the shell', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'http-'));
  try {
    const res = await get(path.join(root, 'missing-dist'), '/manage');
    assert.equal(res.status, 503);
    assert.match(res.body, /npm run build:web/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('API paths fall through instead of being handed the shell', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'http-'));
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'shell');
    const res = await get(root, '/api/memory');
    assert.equal(res.status, 404); // express default, i.e. next() was called
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
