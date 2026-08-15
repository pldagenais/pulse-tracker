import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from './redact.js';

test('redacts GitHub tokens and OAuth secrets', () => {
  assert.match(redactSecrets('use ghp_abcdefghijklmnopqrstuvwxyz0123456789'), /\[redacted\]/);
  assert.match(redactSecrets('token github_pat_11ABC_xyz789abcdefghij'), /\[redacted\]/);
});

test('redacts a secret introduced by a labelled assignment', () => {
  const out = redactSecrets('client secret is 16ea4240c1594673fdf6107215e3d939c627f1c8');
  assert.match(out, /\[redacted\]/);
  assert.doesNotMatch(out, /16ea4240c1594673fdf6107215e3d939c627f1c8/);
});

test('redacts anthropic and slack style keys', () => {
  assert.match(redactSecrets('sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF'), /\[redacted\]/);
  assert.match(redactSecrets('xoxb-123456789012-abcdefghijklmnop'), /\[redacted\]/);
});

test('redacts private key blocks', () => {
  assert.match(redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n'), /\[redacted\]/);
});

test('leaves ordinary developer text intact', () => {
  const sha = 'fix landed in 0794c45a1b2c3d4e5f60718293a4b5c6d7e8f900';
  assert.equal(redactSecrets(sha), sha, 'a bare git SHA must not be redacted');
  const plain = 'run npm run check and push to main';
  assert.equal(redactSecrets(plain), plain);
});

test('handles empty and non-string input safely', () => {
  assert.equal(redactSecrets(''), '');
  assert.equal(redactSecrets(/** @type {any} */ (null)), '');
});
