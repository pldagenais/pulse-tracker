import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfigFile } from './config-file.js';

test('returns fallback when the file is absent', () => {
  assert.deepEqual(readConfigFile('definitely-missing', { a: 1 }), { a: 1 });
});

test('returns fallback when the file is malformed', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { DATA_DIR } = await import('../config.js');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'broken.json'), '{ not json');
  assert.deepEqual(readConfigFile('broken', []), []);
  fs.unlinkSync(path.join(DATA_DIR, 'broken.json'));
});

test('reads and parses a valid config file', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { DATA_DIR } = await import('../config.js');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'valid-test.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'env_1', name: 'Test' }]));
  assert.deepEqual(readConfigFile('valid-test', []), [{ id: 'env_1', name: 'Test' }]);
  fs.unlinkSync(file);
});
