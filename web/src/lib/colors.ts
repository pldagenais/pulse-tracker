// All chart color values are CSS variable references resolved at paint time,
// so every chart follows the dark/light theme toggle with zero re-renders.
// The concrete hex values live in index.css (:root dark, [data-theme=light]);
// both series sets are validated for their surface (dataviz reference set,
// fixed order). IMPORTANT: these strings only resolve in CSS *properties* —
// use style={{ fill: ... }} in SVG, never bare fill="..." attributes.

// Categorical series palette. Color follows the ENTITY: a project keeps its
// color regardless of rank or filtering, keyed by stable project id.
export const SERIES = [
  'var(--series-0)', // blue
  'var(--series-1)', // orange
  'var(--series-2)', // aqua
  'var(--series-3)', // yellow
  'var(--series-4)', // magenta
  'var(--series-5)', // green
  'var(--series-6)', // violet
  'var(--series-7)', // red
] as const;

export function projectColor(projectId: number | null | undefined): string {
  if (projectId == null) return 'var(--series-none)';
  return SERIES[Math.abs(projectId) % SERIES.length];
}

// Semantic colors — used identically across every view. NOT part of the series
// palette so a project never impersonates a semantic signal.
export const CLAUDE_COLOR = 'var(--color-claude)'; // Claude working
export const USER_COLOR = 'var(--color-user)'; // you active
export const SUBAGENT_COLOR = 'var(--chart-subagent)'; // subagent compute
export const BAR_MUTED = 'var(--chart-bar-muted)'; // desaturated claude for non-semantic bar charts

// ── Day-intensity scales ────────────────────────────────────────────────
// Single source of truth for the month view AND the 12-month heatmap so the
// same day can never render at two different intensities, and both legends
// draw from the same ramp.
export const CLAUDE_ALPHAS = [0, 0.16, 0.34, 0.56, 0.8] as const;
const LEGACY_ALPHAS = [0, 0.12, 0.22, 0.34, 0.48] as const;

export function claudeIntensity(claudeMs: number): number {
  if (claudeMs <= 0) return CLAUDE_ALPHAS[0];
  if (claudeMs < 30 * 60_000) return CLAUDE_ALPHAS[1];
  if (claudeMs < 2 * 3600_000) return CLAUDE_ALPHAS[2];
  if (claudeMs < 5 * 3600_000) return CLAUDE_ALPHAS[3];
  return CLAUDE_ALPHAS[4];
}

export function claudeCellColor(claudeMs: number): string {
  return `rgba(var(--claude-rgb),${claudeIntensity(claudeMs)})`;
}

export function legacyCellColor(messages: number): string {
  const a = messages <= 0 ? LEGACY_ALPHAS[0] : messages < 10 ? LEGACY_ALPHAS[1] : messages < 50 ? LEGACY_ALPHAS[2] : messages < 150 ? LEGACY_ALPHAS[3] : LEGACY_ALPHAS[4];
  return `rgba(var(--legacy-rgb),${a})`;
}

/** Hatch overlay marking pre-transcript "counts only" days — identical everywhere. */
export const LEGACY_HATCH =
  'repeating-linear-gradient(45deg, transparent 0 2.5px, rgba(var(--legacy-rgb),0.18) 2.5px 4px)';

const MODEL_COLORS: [RegExp, string][] = [
  [/fable|mythos/, 'var(--series-6)'], // violet
  [/opus/, 'var(--series-0)'], // blue
  [/sonnet/, 'var(--series-2)'], // aqua
  [/haiku/, 'var(--series-3)'], // yellow
];

export function modelColor(model: string | null | undefined): string {
  if (!model) return 'var(--series-none)';
  for (const [re, c] of MODEL_COLORS) if (re.test(model)) return c;
  return 'var(--series-4)'; // magenta
}
