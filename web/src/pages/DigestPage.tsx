import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { dailyStatsQuery, projectStatsQuery, sessionsQuery, journalInfiniteQuery } from '../lib/queries';
import type { DayStat, ProjectSplitRow } from '../lib/types';
import { todayKey, addDays, weekOf, dayKeyOf } from '../lib/time';
import { fmtCost, fmtCount, fmtDay, fmtDuration, fmtRelative, plural } from '../lib/format';
import { Card, StatCard, EmptyState, Skeleton, SkeletonRows } from '../components/ui';
import { SessionListItem } from '../components/SessionListItem';
import { projectColor, CLAUDE_COLOR } from '../lib/colors';
import { renderInline } from '../lib/md';

export default function DigestPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayKey();
  const days = weekOf(date);

  const daily = useQuery(dailyStatsQuery(days[0], days[6]));
  const projects = useQuery(projectStatsQuery(days[0], days[6]));
  const top = useQuery(
    sessionsQuery({ from: days[0], to: days[6], sort: 'duration', pageSize: 8 } as Parameters<typeof sessionsQuery>[0])
  );
  const journal = useInfiniteQuery(journalInfiniteQuery());

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    next.set('date', d);
    setParams(next, { replace: true });
  };
  const nextDisabled = addDays(days[0], 7) > todayKey();

  const rows = daily.data?.rows ?? [];
  const sum = (f: (r: DayStat) => number) => rows.reduce((s, r) => s + f(r), 0);

  const journalEntries = (journal.data?.pages[0]?.rows ?? []).filter((j) => {
    const k = dayKeyOf(j.ts);
    return k >= days[0] && k <= days[6];
  });

  return (
    <div className="fade-up mx-auto w-full max-w-6xl space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/timeline/week?date=${date}`}
            className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude"
          >
            ← week view
          </Link>
          <h1 className="font-display text-xl text-ink">
            Week of {fmtDay(days[0])} – {fmtDay(days[6])}
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDate(addDays(date, -7))}
            aria-label="Previous week"
            className="rounded border border-line p-1.5 text-mid hover:bg-surface2 hover:text-ink"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setDate(addDays(date, 7))}
            disabled={nextDisabled}
            aria-label="Next week"
            className="rounded border border-line p-1.5 text-mid enabled:hover:bg-surface2 enabled:hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => window.print()}
            className="ml-1 flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
          >
            <Printer size={12} />
            print
          </button>
        </div>
      </div>

      {/* hero stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {daily.isLoading ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[86px]" />)
        ) : (
          <>
            <StatCard label="claude working" value={fmtDuration(sum((r) => r.claudeMs))} accent="claude" />
            <StatCard label="you active" value={fmtDuration(sum((r) => r.userActiveMs))} accent="user" />
            <StatCard label="prompts" value={fmtCount(sum((r) => r.prompts))} />
            <StatCard label="sessions" value={fmtCount(sum((r) => r.sessions))} />
            <StatCard label="est. cost" value={fmtCost(sum((r) => r.estCostUsd))} />
          </>
        )}
      </div>

      <Card title="claude time by day" bodyClassName="p-4">
        {daily.isLoading ? <Skeleton className="h-28" /> : <DayBars days={days} rows={rows} />}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="by project" bodyClassName="p-3">
          {projects.isLoading && <SkeletonRows n={5} />}
          {projects.data && projects.data.rows.length === 0 && <EmptyState title="No project activity this week" />}
          {projects.data && projects.data.rows.length > 0 && <ProjectList rows={projects.data.rows} />}
        </Card>

        <Card title="top sessions" bodyClassName="p-1.5">
          {top.isLoading && <SkeletonRows n={6} />}
          {top.data?.rows.length === 0 && <EmptyState title="No sessions this week" />}
          {top.data?.rows.map((s) => <SessionListItem key={s.id} s={s} />)}
        </Card>
      </div>

      <Card title="journal" bodyClassName="p-2">
        {journal.isLoading && <SkeletonRows n={4} />}
        {journal.data && journalEntries.length === 0 && (
          <EmptyState title="No journal entries this week" hint="Claude logs a one-liner here after finishing substantive work." />
        )}
        {journalEntries.map((j) => (
          <div key={j.id} className="border-b border-line/60 px-2 py-2 last:border-0">
            <div className="text-xs leading-5 text-ink/90">{renderInline(j.text)}</div>
            <div className="mt-0.5 font-mono text-[11px] text-dim">
              {j.projectName ?? j.projectPath?.split(/[\\/]/).pop() ?? '—'} · {fmtRelative(j.ts)}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function DayBars({ days, rows }: { days: string[]; rows: DayStat[] }) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const values = days.map((d) => byDate.get(d)?.claudeMs ?? 0);
  const max = Math.max(...values, 1);
  const W = 420;
  const H = 96;
  const gap = 8;
  const bw = (W - gap * (days.length - 1)) / days.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full">
      {days.map((d, i) => {
        const ms = values[i];
        const prompts = byDate.get(d)?.prompts ?? 0;
        const h = Math.max((ms / max) * H, ms > 0 ? 3 : 1.5);
        const x = i * (bw + gap);
        return (
          <g key={d}>
            <rect x={x} y={H - h} width={bw} height={h} rx={3} style={{ fill: CLAUDE_COLOR }} opacity={d === todayKey() ? 1 : 0.55}>
              <title>{`${fmtDay(d)} — ${fmtDuration(ms)} · ${plural(prompts, 'prompt')}`}</title>
            </rect>
            <text x={x + bw / 2} y={H + 13} textAnchor="middle" className="fill-dim font-mono" fontSize={9}>
              {fmtDay(d).split(', ')[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ProjectList({ rows }: { rows: ProjectSplitRow[] }) {
  const sorted = [...rows].sort((a, b) => b.claudeMs - a.claudeMs).slice(0, 8);
  return (
    <div className="space-y-1.5">
      {sorted.map((r) => (
        <Link key={r.id} to={`/projects/${r.id}`} className="flex items-center gap-2.5 rounded px-1 py-0.5 hover:bg-surface2">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: projectColor(r.id) }} />
          <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.name}</span>
          <span className="font-mono text-[12px] text-claude">{fmtDuration(r.claudeMs)}</span>
          <span className="w-12 text-right font-mono text-[12px] text-dim">{fmtCost(r.estCostUsd)}</span>
        </Link>
      ))}
    </div>
  );
}
