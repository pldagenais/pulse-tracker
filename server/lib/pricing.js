// Estimated API-equivalent pricing in USD per million tokens.
// Rates from the Claude API pricing reference (claude-api skill), cached 2026-08.
// Cache multipliers per Anthropic docs: reads ≈ 0.1x input, writes 1.25x (5m TTL) / 2x (1h TTL).
// Not modeled (acceptable for estimates): fast-mode premium, Sonnet 5 intro pricing,
// server-tool request fees. All figures are labeled "estimated" in the UI.

const MTOK = 1_000_000;

const PRICES = [
  { prefix: 'claude-fable-5', input: 10, output: 50 },
  { prefix: 'claude-mythos', input: 10, output: 50 },
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4-8', input: 5, output: 25 },
  { prefix: 'claude-opus-4-7', input: 5, output: 25 },
  { prefix: 'claude-opus-4-6', input: 5, output: 25 },
  { prefix: 'claude-opus-4-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4-1', input: 15, output: 75 },
  { prefix: 'claude-opus-4-2', input: 15, output: 75 }, // dated id claude-opus-4-20250514
  { prefix: 'claude-opus-4-0', input: 15, output: 75 },
  { prefix: 'claude-sonnet-5', input: 3, output: 15 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15 },
  { prefix: 'claude-3-7-sonnet', input: 3, output: 15 },
  { prefix: 'claude-3-5-sonnet', input: 3, output: 15 },
  { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
  { prefix: 'claude-3-5-haiku', input: 0.8, output: 4 },
  { prefix: 'claude-3-haiku', input: 0.25, output: 1.25 },
];

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2;

/** @type {Map<string, {input:number, output:number}|null>} */
const matchCache = new Map();

/** Longest-prefix match of a model id against the price table. */
export function ratesFor(model) {
  if (!model || typeof model !== 'string') return null;
  if (matchCache.has(model)) return matchCache.get(model) ?? null;
  let best = null;
  for (const p of PRICES) {
    if (model.startsWith(p.prefix) && (!best || p.prefix.length > best.prefix.length)) best = p;
  }
  matchCache.set(model, best);
  return best;
}

/**
 * Estimate USD cost for one usage record.
 * @param {string|null} model
 * @param {{input:number, output:number, cacheRead:number, cache5m:number, cache1h:number}} u
 * @returns {{cost: number|null, priced: boolean}} cost null when the model is unknown
 */
export function estimateCost(model, u) {
  const r = ratesFor(model);
  if (!r) return { cost: null, priced: false };
  const cost =
    (u.input * r.input +
      u.output * r.output +
      u.cacheRead * r.input * CACHE_READ_MULT +
      u.cache5m * r.input * CACHE_WRITE_5M_MULT +
      u.cache1h * r.input * CACHE_WRITE_1H_MULT) /
    MTOK;
  return { cost, priced: true };
}
