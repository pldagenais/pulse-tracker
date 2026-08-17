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
    const payload = JSON.parse(body); // only forward valid JSON
    // Which subscription is this session on? Transcripts carry no account
    // identity, so our own env is the only signal — free to read, no I/O.
    // CLAUDE_USER_DATA_DIR = the desktop profile (one per account);
    // CLAUDE_TRACKER_ACCOUNT = optional explicit override from a launcher.
    payload._tracker = {
      userDataDir: process.env.CLAUDE_USER_DATA_DIR ?? null,
      account: process.env.CLAUDE_TRACKER_ACCOUNT ?? null,
    };
    await fetch(`http://127.0.0.1:${PORT}/api/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(250),
    });
  } catch {
    /* tracker down or slow — silently drop; never disturb the session */
  }
  clearTimeout(watchdog);
  process.exit(0);
});
