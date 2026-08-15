import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { projectsQuery } from '../lib/queries';
import type { Project } from '../lib/types';
import { fmtCost, fmtCount, fmtDuration, fmtRelative, plural } from '../lib/format';
import { projectColor } from '../lib/colors';
import { Badge, EmptyState, SkeletonRows } from '../components/ui';
import { OpenInButtons } from '../components/actions';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';

interface Group {
  root: Project;
  children: Project[];
  claudeMs: number;
  promptCount: number;
  sessionCount: number;
  estCostUsd: number;
  lastActive: number;
}

// One shared column template = every row aligns with the header and each other.
const GRID = 'grid grid-cols-[minmax(0,1fr)_92px_72px_72px_92px_96px_118px] items-center gap-x-3';

export default function ProjectsPage() {
  const { t } = useT();
  const q = useQuery(projectsQuery());
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const groups = useMemo(() => {
    const rows = q.data ?? [];
    const byId = new Map(rows.map((p) => [p.id, p]));
    const map = new Map<number, Group>();
    const groupFor = (p: Project): Group => {
      let g = map.get(p.id);
      if (!g) {
        g = { root: p, children: [], claudeMs: 0, promptCount: 0, sessionCount: 0, estCostUsd: 0, lastActive: 0 };
        map.set(p.id, g);
      }
      return g;
    };
    for (const p of rows) {
      const parent = p.parentProjectId != null ? byId.get(p.parentProjectId) : null;
      const g = parent ? groupFor(parent) : groupFor(p);
      if (parent) g.children.push(p);
      g.claudeMs += p.claudeMs;
      g.promptCount += p.promptCount;
      g.sessionCount += p.sessionCount;
      g.estCostUsd += p.estCostUsd;
      g.lastActive = Math.max(g.lastActive, p.lastActive ?? 0);
    }
    let out = [...map.values()];
    if (filter.trim()) {
      const f = filter.trim().toLowerCase();
      out = out.filter(
        (g) => g.root.name.toLowerCase().includes(f) || g.children.some((c) => c.name.toLowerCase().includes(f))
      );
    }
    return out.sort((a, b) => b.lastActive - a.lastActive);
  }, [q.data, filter]);

  const toggle = (id: number) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('projects.filterPlaceholder')}
        className="w-64 rounded-md border border-line bg-surface px-3 py-1.5 text-[14px] text-ink outline-none placeholder:text-dim"
      />
      {q.isLoading && <SkeletonRows n={8} />}
      {!q.isLoading && groups.length === 0 && <EmptyState title={t('projects.emptyTitle')} />}

      {!q.isLoading && groups.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <div className="min-w-[860px]">
            {/* single header row instead of labels repeated on every card */}
            <div className={cn(GRID, 'border-b border-line px-4 py-2')}>
              <span className="microlabel">{t('projects.project')}</span>
              <span className="microlabel text-right">{t('projects.claude')}</span>
              <span className="microlabel text-right">{t('projects.sessions')}</span>
              <span className="microlabel text-right">{t('projects.prompts')}</span>
              <span className="microlabel text-right">{t('projects.estCost')}</span>
              <span className="microlabel text-right">{t('projects.active')}</span>
              <span aria-hidden />
            </div>

            {groups.map((g) => {
              const isOpen = expanded.has(g.root.id);
              return (
                <Fragment key={g.root.id}>
                  <div className={cn(GRID, 'group border-b border-line/60 px-4 py-2.5 transition-colors last:border-0 hover:bg-surface2/60')}>
                    <Link to={`/projects/${g.root.id}`} className="flex min-w-0 items-center gap-2.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: projectColor(g.root.id) }} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-ink">{g.root.name}</span>
                        <span className="block truncate font-mono text-[11px] text-dim">{g.root.path}</span>
                      </span>
                      {/* focus-within, not just hover: these buttons take tab
                          focus, and a focused-but-invisible control is a trap */}
                      <OpenInButtons projectId={g.root.id} size={12} className="ml-auto opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" />
                    </Link>
                    <Cell className="text-claude">{fmtDuration(g.claudeMs)}</Cell>
                    <Cell>{fmtCount(g.sessionCount)}</Cell>
                    <Cell>{fmtCount(g.promptCount)}</Cell>
                    <Cell className="text-user">{fmtCost(g.estCostUsd)}</Cell>
                    <Cell className="text-dim">{fmtRelative(g.lastActive || null)}</Cell>
                    {g.children.length > 0 ? (
                      <button
                        onClick={() => toggle(g.root.id)}
                        aria-expanded={isOpen}
                        className="flex items-center justify-end gap-1 rounded px-1 py-1 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
                      >
                        <ChevronRight size={11} className={cn('transition-transform', isOpen && 'rotate-90')} />
                        {plural(g.children.length, 'worktree')}
                      </button>
                    ) : (
                      <span aria-hidden />
                    )}
                  </div>

                  {isOpen &&
                    g.children
                      .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
                      .map((c) => (
                        <Link
                          key={c.id}
                          to={`/projects/${c.id}`}
                          className={cn(GRID, 'border-b border-line/40 bg-surface2/30 px-4 py-1.5 last:border-0 hover:bg-surface2')}
                        >
                          <span className="flex min-w-0 items-center gap-2 pl-6">
                            <Badge className="max-w-[220px] shrink-0 truncate">{c.worktreeBranch ?? t('projects.worktreeFallback')}</Badge>
                          </span>
                          <Cell className="text-claude/80">{fmtDuration(c.claudeMs)}</Cell>
                          <Cell className="text-mid">{fmtCount(c.sessionCount)}</Cell>
                          <Cell className="text-mid">{fmtCount(c.promptCount)}</Cell>
                          <Cell className="text-user/80">{fmtCost(c.estCostUsd)}</Cell>
                          <Cell className="text-dim">{fmtRelative(c.lastActive)}</Cell>
                          <span aria-hidden />
                        </Link>
                      ))}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('text-right font-mono text-[12px] text-ink', className)}>{children}</span>;
}
