// Prompt text is mirrored to the cloud verbatim, and prompts occasionally
// contain credentials someone pasted into a session. These patterns strip the
// obvious ones on the way out.
//
// Deliberately conservative: it matches known credential shapes and
// labelled assignments only. A bare 40-char hex string is left alone because
// that is also a git SHA, and this is a developer tool full of them.

const PATTERNS = [
  // provider-prefixed tokens
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9-]{16,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // PEM blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

// "client secret is <value>", "api_key=<value>", "password: <value>"
const LABELLED =
  /\b(?:client[\s_-]?secret|secret|api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|password|passwd)\b\s*(?:is|=|:)\s*["']?([A-Za-z0-9_\-./+]{16,})["']?/gi;

/**
 * Strip credential-shaped substrings from text bound for the cloud mirror.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  out = out.replace(LABELLED, (match, value) => match.replace(value, '[redacted]'));
  return out;
}
