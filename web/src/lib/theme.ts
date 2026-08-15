// Theme state lives on <html data-theme> so pure-CSS variables drive every
// color (including SVG charts) — React only tracks it for the toggle button.
import { useState } from 'react';

const KEY = 'pulse-theme';

export type Theme = 'dark' | 'light';

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Call once before first render to avoid a theme flash. */
export function initTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode */
    }
    // brief global crossfade (see html.theme-anim in index.css)
    const el = document.documentElement;
    el.classList.add('theme-anim');
    window.setTimeout(() => el.classList.remove('theme-anim'), 300);
    el.dataset.theme = next;
    setTheme(next);
  };
  return { theme, toggle };
}
