import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Search, Download } from 'lucide-react';
import { promptsInfiniteQuery, projectsQuery, type PromptFilters } from '../lib/queries';
import { qs } from '../lib/api';
import type { PromptRow } from '../lib/types';
import { fmtClock, fmtCount, fmtDay } from '../lib/format';
import { projectColor } from '../lib/colors';
import { Badge, EmptyState, SkeletonRows } from '../components/ui';

/** FTS snippets delimit matches with control chars \u0001..\u0002 (set
 * server-side via char(1)/char(2)) — build <mark> nodes from those offsets. */
const MARK_OPEN = '';
const MARK_CLOSE = '';

function renderSnippet(snippet: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = snippet;
  let i = 0;
  while (rest.length) {
    const a = rest.indexOf(MARK_OPEN);
    if (a === -1) {
      out.push(rest);
      break;
    }
    const b = rest.indexOf(MARK_CLOSE, a);
    if (b === -1) {
      out.push(rest.replaceAll(MARK_OPEN, ''));
      break;
    }
    if (a > 0) out.push(rest.slice(0, a));
    out.push(<mark key={i++}>{rest.slice(a + 1, b)}</mark>);
    rest = rest.slice(b + 1);
  }
  return out;
}

export default function PromptsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const project = params.get('project');
  const kind = params.get('kind');
  const from = params.get('from');
  const to = params.get('to');
  const [input, setInput] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const projects = useQuery(projectsQuery());

  // URL is the source of truth; debounce typing into it.
  useEffect(() => {
    const t = setTimeout(() => {
      if (input === q) return;
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (input.trim()) next.set('q', input.trim());
          else next.delete('q');
          return next;
        },
        { replace: true }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [input, q, setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filters: PromptFilters = useMemo(
    () => ({
      q: q || undefined,
      project: project ? Number(project) : undefined,
      kind: kind || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [q, project, kind, from, to]
  );
  const result = useInfiniteQuery(promptsInfiniteQuery(filters));
  const rows = result.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = result.data?.pages[0]?.total ?? 0;

  const setFilter = (key: string, value: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-72 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search every prompt you've ever sent…  ( / )"
            className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-dim focus:border-claude/50"
          />
        </div>
        <select
          value={project ?? ''}
          onChange={(e) => setFilter('project', e.target.value || null)}
          className="rounded-md border border-line bg-surface px-2 py-2 text-xs text-mid outline-none"
        >
          <option value="">all projects</option>
          {(projects.data ?? [])
            .filter((p) => p.parentProjectId == null)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
        <select
          value={kind ?? ''}
          onChange={(e) => setFilter('kind', e.target.value || null)}
          className="rounded-md border border-line bg-surface px-2 py-2 text-xs text-mid outline-none"
        >
          <option value="">all kinds</option>
          <option value="typed">typed</option>
          <option value="command">slash command</option>
          <option value="legacy">legacy</option>
        </select>
        <input
          type="date"
          value={from ?? ''}
          onChange={(e) => setFilter('from', e.target.value || null)}
          aria-label="From date"
          className="rounded-md border border-line bg-surface px-2 py-2 text-xs text-mid outline-none [color-scheme:dark]"
        />
        <input
          type="date"
          value={to ?? ''}
          onChange={(e) => setFilter('to', e.target.value || null)}
          aria-label="To date"
          className="rounded-md border border-line bg-surface px-2 py-2 text-xs text-mid outline-none [color-scheme:dark]"
        />
        {(from || to) && (
          <button
            onClick={() => {
              setParams((p) => {
                const next = new URLSearchParams(p);
                next.delete('from');
                next.delete('to');
                return next;
              });
            }}
            aria-label="Clear date range"
            title="Clear date range"
            className="rounded-md border border-line px-2 py-2 text-xs text-dim hover:text-ink"
          >
            ✕
          </button>
        )}
        <a
          href={`/api/export${qs({ what: 'prompts', format: 'csv' })}`}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-2 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
          title="Export all prompts as CSV"
        >
          <Download size={12} /> csv
        </a>
      </div>

      <div className="font-mono text-[12px] text-dim">
        {result.isLoading ? 'searching…' : `${fmtCount(total)} prompts${q ? ` matching “${q}”` : ''}`}
      </div>

      {result.isLoading && <SkeletonRows n={8} />}
      {!result.isLoading && rows.length === 0 && (
        <EmptyState title={q ? `No matches for “${q}”` : 'No prompts yet'} />
      )}

      <div className="space-y-1.5">
        {rows.map((r) => (
          <PromptResult key={r.uuid} r={r} />
        ))}
      </div>

      {result.hasNextPage && (
        <button
          onClick={() => result.fetchNextPage()}
          disabled={result.isFetchingNextPage}
          className="w-full rounded-md border border-line py-2 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
        >
          {result.isFetchingNextPage ? 'loading…' : `load more (${fmtCount(total - rows.length)} left)`}
        </button>
      )}
    </div>
  );
}

function PromptResult({ r }: { r: PromptRow }) {
  const [params, setParams] = useSearchParams();
  const open = () => {
    if (r.kind === 'legacy') return; // no session detail exists for legacy prompts
    const next = new URLSearchParams(params);
    next.set('session', r.sessionId);
    next.set('prompt', r.uuid);
    setParams(next);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className="block w-full cursor-pointer rounded-md border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-line2 hover:bg-surface2"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] text-dim">
        <button
          onClick={(e) => {
            e.stopPropagation();
            const next = new URLSearchParams(params);
            next.set('project', String(r.projectId));
            setParams(next);
          }}
          title="Filter by project"
          className="-mx-1 flex items-center gap-2 rounded px-1 hover:text-ink"
        >
          <span className="h-1.5 w-1.5 rounded-sm" style={{ background: projectColor(r.projectId) }} />
          <span>{r.projectName ?? '—'}</span>
        </button>
        {r.sessionTitle && <span className="truncate text-dim/80">· {r.sessionTitle}</span>}
        <span className="ml-auto shrink-0">{fmtDay(r.ts)} {fmtClock(r.ts)}</span>
        {r.kind !== 'typed' && <Badge tone={r.kind === 'command' ? 'user' : 'default'}>{r.kind === 'command' ? 'cmd' : 'legacy'}</Badge>}
      </div>
      <div className="mt-1 line-clamp-3 font-mono text-xs leading-5 text-ink/90">
        {r.snippet ? renderSnippet(r.snippet) : r.text}
      </div>
    </div>
  );
}
