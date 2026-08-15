import { getLocale } from './i18n';

/* Locale-dependent formatters, rebuilt lazily when the locale flips. The
 * components using them re-render on toggle (they subscribe via useT), so a
 * lazy module-level cache is enough — no reactivity needed here. */
let fmtsFor: 'en' | 'fr' | null = null;
let nf = new Intl.NumberFormat('en-US');
let dayFmt: Intl.DateTimeFormat;
let dayFullFmt: Intl.DateTimeFormat;
function ensureFmts() {
  const loc = getLocale();
  if (loc === fmtsFor) return;
  fmtsFor = loc;
  const tag = loc === 'fr' ? 'fr-CA' : 'en-US';
  nf = new Intl.NumberFormat(tag);
  dayFmt = new Intl.DateTimeFormat(tag, { weekday: 'short', month: 'short', day: 'numeric' });
  dayFullFmt = new Intl.DateTimeFormat(tag, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** 2h 14m · 14m · 42s · — */
export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 1000) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 100) return rm ? `${h}h ${rm}m` : `${h}h`;
  return `${h}h`;
}

/** Live elapsed with seconds: 4m 12s */
export function fmtElapsed(ms: number): string {
  const s = Math.max(Math.floor(ms / 1000), 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${String(rs).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 1.2K · 3.4M · 812 */
export function fmtTokens(n: number | null | undefined): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return trim1(n / 1000) + 'K';
  if (n < 1_000_000_000) return trim1(n / 1_000_000) + 'M';
  return trim1(n / 1_000_000_000) + 'B';
}

function trim1(v: number): string {
  const s = v.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** $4.83 · $1,204 · <$0.01 */
export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd >= 1000) return '$' + nf.format(Math.round(usd));
  return '$' + usd.toFixed(2);
}

export function fmtCount(n: number | null | undefined): string {
  ensureFmts();
  return nf.format(n ?? 0);
}

/**
 * "1 prompt" / "3 prompts" — the app never writes "(s)". Words are passed in
 * English; the FR table covers the app's countable nouns (French pluralizes
 * with a plain s for all of them, so unknown words degrade gracefully).
 */
const FR_WORDS: Record<string, string> = {
  prompt: 'prompt', turn: 'tour', session: 'session', 'tool call': 'appel d’outil',
  subagent: 'sous-agent', file: 'fichier', client: 'client', commit: 'commit',
  'bad line': 'ligne invalide', run: 'exécution', day: 'jour', compaction: 'compaction',
  project: 'projet', switch: 'changement', entry: 'entrée', model: 'modèle',
};
export function plural(n: number, word: string): string {
  ensureFmts();
  if (getLocale() === 'fr') {
    const w = FR_WORDS[word] ?? word;
    // French: no plural s on counts of 1 and 0 ("0 tour"); "appel d'outil" -> "appels d'outil"
    const pluralized = n >= 2 ? w.replace(/^(\S+)/, '$1s').replace('appels d’outils', 'appels d’outil') : w;
    return `${nf.format(n)} ${pluralized}`;
  }
  return `${nf.format(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** 14:32 (24h local) */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Thu, Aug 14 / jeu. 14 août (from a YYYY-MM-DD key or epoch ms) */
export function fmtDay(day: string | number): string {
  ensureFmts();
  return dayFmt.format(toDate(day));
}

export function fmtDayFull(day: string | number): string {
  ensureFmts();
  return dayFullFmt.format(toDate(day));
}

function toDate(day: string | number): Date {
  if (typeof day === 'number') return new Date(day);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 23m ago · 3h ago · Thu, Aug 14 (fr: il y a 23 min · jeu. 14 août) */
export function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const fr = getLocale() === 'fr';
  if (diff < 60_000) return fr ? 'à l’instant' : 'just now';
  if (diff < 3600_000) {
    const m = Math.floor(diff / 60_000);
    return fr ? `il y a ${m} min` : `${m}m ago`;
  }
  if (diff < 24 * 3600_000) {
    const h = Math.floor(diff / 3600_000);
    return fr ? `il y a ${h} h` : `${h}h ago`;
  }
  return fmtDay(ts);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Short model label: claude-opus-4-8 -> Opus 4.8, claude-fable-5 -> Fable 5 */
export function fmtModel(model: string | null | undefined): string {
  if (!model) return '?';
  const m = model.match(/claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return model;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}
