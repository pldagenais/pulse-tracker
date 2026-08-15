import type { ReactNode } from 'react';

/**
 * Markdown-lite for journal entries: `code` and **bold** only, rendered as
 * React nodes (never innerHTML). Anything else stays literal text.
 */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code key={i++} className="rounded bg-raise px-1 py-px font-mono text-[0.92em] text-claude">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<strong key={i++} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
