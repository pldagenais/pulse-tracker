/* Localization core. One entry per string with both languages side by side,
 * split across per-domain files in web/src/i18n/ (so parallel work on
 * different pages never touches the same file) and merged here.
 *
 * The locale lives in a ref-backed store (same pattern as the live store):
 * components subscribe through useLocale/useT and re-render on toggle.
 * User DATA (project names, prompts, session titles, journal text) is never
 * translated — only the app's own chrome.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { MESSAGES, type MsgKey } from '../i18n';

export type Locale = 'en' | 'fr';

const STORAGE_KEY = 'pulse-locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch { /* private mode */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let locale: Locale = initialLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

document.documentElement.lang = locale;

export function useLocale(): [Locale, (l: Locale) => void] {
  const cur = useSyncExternalStore(subscribe, getLocale, getLocale);
  return [cur, setLocale];
}

/** Translate a key in the current locale. Missing French falls back to English. */
export function t(key: MsgKey): string {
  const entry = MESSAGES[key];
  return entry ? (entry[locale] ?? entry.en) : key;
}

/** t + {var} interpolation: tf('x.y', { n: 3 }) on "…{n}…". */
export function tf(key: MsgKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`));
}

/**
 * Reactive translation: re-renders the component when the locale flips.
 * Components render t()/tf() results, so they must subscribe through this
 * (or useLocale) rather than importing t directly.
 */
export function useT() {
  const [cur] = useLocale();
  return {
    locale: cur,
    t: useCallback((key: MsgKey) => t(key), [cur]), // eslint-disable-line react-hooks/exhaustive-deps
    tf: useCallback((key: MsgKey, vars: Record<string, string | number>) => tf(key, vars), [cur]), // eslint-disable-line react-hooks/exhaustive-deps
  };
}
