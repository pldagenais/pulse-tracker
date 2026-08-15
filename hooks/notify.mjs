// Fire-and-forget forwarder for Claude Code hook events -> local tracker.
// HARD RULES: never print to stdout (UserPromptSubmit stdout is injected into
// the session context!), never print to stderr, always exit 0, finish fast.
const PORT = process.env.CLAUDE_TRACKER_PORT || 5599;
const MAX_BYTES = 1_048_576;

const watchdog = setTimeout(() => process.exit(0), 1500);

const chunks = [];
let size = 0;
process.stdin.on('data', (c) => {
  size += c.length;
  if (size <= MAX_BYTES) chunks.push(c);
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', async () => {
  try {
    const body = Buffer.concat(chunks).toString('utf8');
    JSON.parse(body); // only forward valid JSON
    await fetch(`http://127.0.0.1:${PORT}/api/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(250),
    });
  } catch {
    /* tracker down or slow — silently drop; never disturb the session */
  }
  clearTimeout(watchdog);
  process.exit(0);
});
