import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Bot, PenLine, Pencil } from 'lucide-react';
import { journalInfiniteQuery, projectsQuery } from '../lib/queries';
import { api } from '../lib/api';
import { renderInline } from '../lib/md';
import type { JournalEntry } from '../lib/types';
import { dayKeyOf } from '../lib/time';
import { fmtClock, fmtDayFull } from '../lib/format';
import { EmptyState, SkeletonRows } from '../components/ui';

export default function JournalPage() {
  const [project, setProject] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const projects = useQuery(projectsQuery());
  const q = useInfiniteQuery(journalInfiniteQuery(project));
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: (text: string) => api.post('/api/journal', { text, source: 'ui' }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['journal'] });
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/journal/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journal'] }),
  });
  const edit = useMutation({
    mutationFn: async ({ id, text }: { id: number; text: string }) => {
      const res = await fetch(`/api/journal/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`PATCH /api/journal/${id} failed: ${res.status}`);
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['journal'] });
    },
  });

  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const grouped = useMemo(() => {
    const m = new Map<string, JournalEntry[]>();
    for (const r of rows) {
      const day = dayKeyOf(r.ts);
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(r);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim() && !add.isPending) add.mutate(draft.trim());
          }}
          placeholder="Add a note… (Claude also logs completed work here automatically)"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-dim focus:border-claude/50"
        />
        <select
          value={project ?? ''}
          onChange={(e) => setProject(e.target.value ? Number(e.target.value) : null)}
          className="rounded-md border border-line bg-surface px-2 py-2 text-xs text-mid outline-none"
        >
          <option value="">all projects</option>
          {(projects.data ?? [])
            .filter((p) => p.parentProjectId == null)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
      </div>

      {q.isLoading && <SkeletonRows n={6} />}
      {!q.isLoading && rows.length === 0 && (
        <EmptyState
          title="No journal entries yet"
          hint="After Claude finishes a substantive task in any project, it posts a one-line summary here. You can also add notes yourself above."
        />
      )}

      {grouped.map(([day, entries]) => (
        <section key={day}>
          <h3 className="microlabel sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-2 backdrop-blur">{fmtDayFull(day)}</h3>
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="group flex items-start gap-3 rounded-md border border-line bg-surface px-3.5 py-2.5">
                {e.source === 'claude' ? (
                  <Bot size={14} className="mt-0.5 shrink-0 text-claude" />
                ) : (
                  <PenLine size={14} className="mt-0.5 shrink-0 text-user" />
                )}
                <div className="min-w-0 flex-1">
                  {editingId === e.id ? (
                    <div>
                      <textarea
                        rows={2}
                        value={editText}
                        onChange={(ev) => setEditText(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                        className="w-full rounded border border-line bg-surface2 p-2 font-sans text-[14px] text-ink outline-none focus:border-claude/50"
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => edit.mutate({ id: e.id, text: editText.trim() })}
                          disabled={!editText.trim() || edit.isPending}
                          className="rounded border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {edit.isPending ? 'saving…' : 'save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[14px] leading-5 text-ink/95">{renderInline(e.text)}</div>
                  )}
                  <div className="mt-0.5 font-mono text-[11px] text-dim">
                    {e.projectName ?? e.projectPath?.split(/[\\/]/).pop() ?? '—'} · {fmtClock(e.ts)}
                  </div>
                </div>
                {editingId !== e.id && (
                  <button
                    onClick={() => {
                      setEditingId(e.id);
                      setEditText(e.text);
                    }}
                    className="rounded p-1 text-dim opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                    title="Edit entry"
                    aria-label="Edit entry"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                <button
                  onClick={() => del.mutate(e.id)}
                  disabled={del.isPending}
                  className="rounded p-1 text-dim opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  title="Delete entry"
                  aria-label="Delete journal entry"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {q.hasNextPage && (
        <button
          onClick={() => q.fetchNextPage()}
          className="w-full rounded-md border border-line py-2 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2"
        >
          load more
        </button>
      )}
    </div>
  );
}
