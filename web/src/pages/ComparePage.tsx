// Session diff: two sessions side by side with deltas — "I tried this task
// twice, which approach was cheaper/faster?" Also the landing view for A/B
// model runs launched from the Run page.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { sessionQuery, sessionsQuery } from '../lib/queries';
import type { SessionDetail } from '../lib/types';
import { fmtCost, fmtCount, fmtDuration, fmtModel, fmtRelative, fmtTokens } from '../lib/format';
import { Card, EmptyState, Skeleton } from '../components/ui';
import { cn } from '../lib/cn';

export default function ComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get('a');
  const b = params.get('b');
  const recent = useQuery(sessionsQuery({ pageSize: 50 }));
  const qa = useQuery(sessionQuery(a));
  const qb = useQuery(sessionQuery(b));

  const setSide = (side: 'a' | 'b', id: string) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set(side, id);
      else n.delete(side);
      return n;
    }, { replace: true });
  };

  const options = useMemo(() => recent.data?.rows ?? [], [recent.data]);
  const picker = (side: 'a' | 'b', value: string | null) => (
    <select
      value={value ?? ''}
      onChange={(e) => setSide(side, e.target.value)}
      aria-label={`Session ${side.toUpperCase()}`}
      className="min-w-0 max-w-full flex-1 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none"
    >
      <option value="">— pick session {side.toUpperCase()} —</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {(s.title ?? s.firstPrompt ?? s.id).slice(0, 70)} · {s.projectName} · {fmtRelative(s.startedAt ?? 0)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        {picker('a', a)}
        <ArrowLeftRight size={14} className="shrink-0 text-dim" />
        {picker('b', b)}
      </div>

      {(!a || !b) && <EmptyState title="Pick two sessions to compare" hint="Tip: A/B runs from the Run page land here automatically." />}

      {a && b && (qa.isLoading || qb.isLoading) && <Skeleton className="h-64" />}

      {qa.data && qb.data && <CompareGrid A={qa.data} B={qb.data} />}
    </div>
  );
}

function CompareGrid({ A, B }: { A: SessionDetail; B: SessionDetail }) {
  // A session with unpriced tokens reads artificially cheap — painting it
  // green as the "winner" would present missing data as a victory.
  const costComparable = !A.session.hasUnpricedTokens && !B.session.hasUnpricedTokens;
  const rows: { label: string; fmt: (d: SessionDetail) => string; num: (d: SessionDetail) => number; lowerBetter?: boolean; noWinner?: boolean }[] = [
    { label: 'claude working', fmt: (d) => fmtDuration(d.session.claudeMs), num: (d) => d.session.claudeMs, lowerBetter: true },
    {
      label: 'est. cost',
      fmt: (d) => `${fmtCost(d.session.estCostUsd ?? 0)}${d.session.hasUnpricedTokens ? '*' : ''}`,
      num: (d) => d.session.estCostUsd ?? 0,
      lowerBetter: true,
      noWinner: !costComparable,
    },
    { label: 'prompts', fmt: (d) => fmtCount(d.session.promptCount), num: (d) => d.session.promptCount },
    { label: 'turns', fmt: (d) => fmtCount(d.session.turnCount), num: (d) => d.session.turnCount },
    { label: 'tool calls', fmt: (d) => fmtCount(d.session.toolUseCount), num: (d) => d.session.toolUseCount },
    { label: 'output tokens', fmt: (d) => fmtTokens(d.session.outputTokens), num: (d) => d.session.outputTokens },
    { label: 'subagents', fmt: (d) => fmtCount(d.session.subagentCount), num: (d) => d.session.subagentCount },
    { label: 'commits', fmt: (d) => fmtCount(d.commits.length), num: (d) => d.commits.length },
  ];

  const head = (d: SessionDetail) => (
    <div className="min-w-0">
      <Link to={`/sessions/${d.session.id}`} className="block truncate text-[14px] text-ink hover:text-claude">
        {d.session.title ?? d.session.lastPrompt ?? d.session.id}
      </Link>
      <div className="mt-0.5 truncate font-mono text-[11px] text-dim">
        {d.session.projectName} · {d.session.models.map(fmtModel).join(', ') || 'no model recorded'}
      </div>
    </div>
  );

  return (
    <Card title="comparison" bodyClassName="p-0">
      <div className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-4 py-3">
        {head(A)}
        <span className="text-center font-mono text-[10px] uppercase tracking-wider text-dim">vs</span>
        {head(B)}
      </div>
      {rows.map((r) => {
        const va = r.num(A);
        const vb = r.num(B);
        const winner = r.noWinner || va === vb ? null : (r.lowerBetter ? va < vb : va > vb) ? 'a' : 'b';
        return (
          <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)] items-center gap-x-3 border-b border-line/60 px-4 py-2 last:border-0">
            <span className={cn('text-right font-mono text-[14px]', winner === 'a' ? 'text-ok' : 'text-ink')}>{r.fmt(A)}</span>
            <span className="text-center font-mono text-[10px] uppercase tracking-wider text-dim">{r.label}</span>
            <span className={cn('font-mono text-[14px]', winner === 'b' ? 'text-ok' : 'text-ink')}>{r.fmt(B)}</span>
          </div>
        );
      })}
      <div className="px-4 py-2 font-mono text-[11px] text-dim">
        green = better (faster/cheaper for time & cost, more for output). Judge quality yourself — open each session for the full detail.
      </div>
    </Card>
  );
}
