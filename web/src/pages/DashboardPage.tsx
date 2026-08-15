import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { MessageSquare, Check, Play, Square, Bot } from 'lucide-react';
import {
  overviewQuery, sessionsQuery, journalInfiniteQuery, activityQuery, settingsQuery, dailyStatsQuery,
} from '../lib/queries';
import { useLive, useNow } from '../lib/live';
import { useT } from '../lib/i18n';
import { todayKey } from '../lib/time';
import { fmtCost, fmtCount, fmtDay, fmtDuration, fmtElapsed, fmtRelative, plural } from '../lib/format';
import { Card, StatCard, EmptyState, Skeleton, SkeletonRows, Badge, ProgressBar, Sparkline } from '../components/ui';
import { SessionListItem } from '../components/SessionListItem';
import { CostExplainModal } from '../components/CostExplain';
import { projectColor, CLAUDE_COLOR, USER_COLOR } from '../lib/colors';
import { cn } from '../lib/cn';

export default function DashboardPage() {
  const date = todayKey();
  const ov = useQuery(overviewQuery(date));
  const recent = useQuery(sessionsQuery({ pageSize: 8 }));
  const journal = useInfiniteQuery(journalInfiniteQuery());
  const settings = useQuery(settingsQuery());
  const { t, tf } = useT();
  const d = ov.data;
  // cloud: the query SUCCEEDED but the snapshot is null — this day was never
  // mirrored. Without this the difference from "loading" is invisible and the
  // cards skeleton forever.
  const notMirrored = ov.isSuccess && !d;
  const yesterday = d?.trend[12];
  const [explainCost, setExplainCost] = useState(false);

  return (
    <div className="fade-up w-full space-y-4 p-5">
      {explainCost && <CostExplainModal date={date} onClose={() => setExplainCost(false)} />}
      {/* hero stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {notMirrored ? (
          <div className="col-span-2 lg:col-span-5">
            <EmptyState
              title={t('dashboard.notMirroredTitle')}
              hint={t('dashboard.notMirroredHint')}
            />
          </div>
        ) : ov.isLoading || !d ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[86px]" />)
        ) : (
          <>
            <StatCard
              label={t('dashboard.claudeWorkingToday')}
              value={fmtDuration(d.claudeMs)}
              sub={
                <span className="flex flex-col gap-1">
                  <Sparkline values={d.trend.map((t) => t.claudeMs)} color={CLAUDE_COLOR} />
                  <span className="flex items-center gap-2">
                    <DeltaLine now={d.claudeMs} prev={yesterday?.claudeMs ?? 0} fmt={fmtDuration} minDiff={60_000} />
                    {d.subagentMs > 0 && <span className="text-dim">{tf('dashboard.subagents', { duration: fmtDuration(d.subagentMs) })}</span>}
                  </span>
                </span>
              }
              accent="claude"
              title={t('dashboard.claudeWorkingTitle')}
            />
            <StatCard
              label={t('dashboard.youActiveToday')}
              value={fmtDuration(d.userActiveMs)}
              sub={t('dashboard.youActiveSub')}
              accent="user"
              title={t('dashboard.youActiveTitle')}
            />
            <StatCard
              label={t('dashboard.prompts')}
              value={fmtCount(d.prompts)}
              sub={
                <span className="flex flex-col gap-1">
                  <Sparkline values={d.trend.map((t) => t.prompts)} color={USER_COLOR} />
                  <span className="flex items-center gap-2">
                    <DeltaLine now={d.prompts} prev={yesterday?.prompts ?? 0} fmt={fmtCount} />
                    <span className="text-dim">{tf('dashboard.sessionsToday', { n: fmtCount(d.sessions) })}</span>
                  </span>
                </span>
              }
            />
            <button onClick={() => setExplainCost(true)} className="h-full w-full text-left" title={t('dashboard.costWhy')}>
              <StatCard
                label={t('dashboard.estCost')}
                value={fmtCost(d.estCostUsd)}
                sub={
                  d.trend[13]?.unpriced ? (
                    <span className="text-danger" title={t('dashboard.costPartialTitle')}>
                      {t('dashboard.costPartial')}
                    </span>
                  ) : (
                    t('dashboard.costApiEquiv')
                  )
                }
              />
            </button>
            <StatCard
              label={t('dashboard.streak')}
              value={tf('dashboard.streakDays', { n: d.records.currentStreak })}
              sub={tf('dashboard.streakLongest', { n: d.records.longestStreak })}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <NowCard />
          <Card
            title={t('dashboard.recentSessions')}
            action={<Link to="/timeline/day" className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude">{t('dashboard.timelineLink')}</Link>}
            bodyClassName="p-1.5"
          >
            {recent.isLoading && <SkeletonRows n={6} />}
            {recent.data?.rows.length === 0 && <EmptyState title={t('dashboard.noSessionsYet')} />}
            {recent.data?.rows.map((s) => <SessionListItem key={s.id} s={s} />)}
          </Card>
          <ActivityCard />
        </div>

        <div className="space-y-4 xl:col-span-5">
          <Card title={t('dashboard.last7Days')} bodyClassName="p-4">
            {d ? (
              <WeekTrend week={d.trend.slice(-7)} />
            ) : notMirrored ? (
              <EmptyState title={t('dashboard.notMirroredShort')} />
            ) : (
              <Skeleton className="h-28" />
            )}
          </Card>
          <Card title={t('dashboard.todayByProject')} bodyClassName="p-4">
            {notMirrored ? (
              <EmptyState title={t('dashboard.notMirroredShort')} />
            ) : !d ? (
              <Skeleton className="h-24" />
            ) : d.byProject.length === 0 ? (
              <EmptyState title={t('dashboard.nothingTrackedTitle')} hint={t('dashboard.nothingTrackedHint')} />
            ) : (
              <TodaySplit rows={d.byProject} />
            )}
          </Card>
          {settings.data?.monthlyBudgetUsd != null && settings.data.monthlyBudgetUsd > 0 && (
            <BudgetCard budget={settings.data.monthlyBudgetUsd} date={date} />
          )}
          <Card
            title={t('dashboard.journal')}
            action={<Link to="/journal" className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude">{t('dashboard.allLink')}</Link>}
            bodyClassName="p-2"
          >
            {journal.data?.pages[0]?.rows.length === 0 && (
              <div className="px-2 py-3 text-xs text-dim">
                {t('dashboard.journalEmpty')}
              </div>
            )}
            {journal.data?.pages[0]?.rows.slice(0, 5).map((j) => (
              <div key={j.id} className="border-b border-line/60 px-2 py-2 last:border-0">
                <div className="text-xs leading-5 text-ink/90">{j.text}</div>
                <div className="mt-0.5 font-mono text-[11px] text-dim">
                  {j.projectName ?? j.projectPath?.split(/[\\/]/).pop() ?? '—'} · {fmtRelative(j.ts)}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** "▲ 42m vs yesterday" / "▼ 3 vs yesterday" / "— same as yesterday". */
function DeltaLine({
  now, prev, fmt, minDiff = 0,
}: {
  now: number;
  prev: number;
  fmt: (n: number) => string;
  minDiff?: number;
}) {
  const { t } = useT();
  const diff = now - prev;
  if (Math.abs(diff) < Math.max(minDiff, 1)) {
    return <span className="font-mono text-[11px] text-dim">{t('dashboard.sameAsYesterday')}</span>;
  }
  const up = diff > 0;
  return (
    <span className={cn('font-mono text-[11px]', up ? 'text-ok' : 'text-danger')}>
      {up ? '▲' : '▼'} {fmt(Math.abs(diff))} {t('dashboard.vsYesterday')}
    </span>
  );
}

function BudgetCard({ budget, date }: { budget: number; date: string }) {
  const monthStart = date.slice(0, 8) + '01';
  const stats = useQuery(dailyStatsQuery(monthStart, date));
  const { t } = useT();
  return (
    <Card title={t('dashboard.monthlyBudget')} bodyClassName="p-4">
      {!stats.data ? (
        <Skeleton className="h-12" />
      ) : (
        <BudgetBody budget={budget} date={date} rows={stats.data.rows} />
      )}
    </Card>
  );
}

function BudgetBody({ budget, date, rows }: { budget: number; date: string; rows: { estCostUsd: number; unpriced?: boolean }[] }) {
  const { t, tf } = useT();
  const spent = rows.reduce((s, r) => s + r.estCostUsd, 0);
  const partial = rows.some((r) => r.unpriced);
  const [y, m, dom] = date.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const pace = dom > 0 ? (spent / dom) * daysInMonth : spent;
  const over = pace > budget;
  return (
    <div>
      <ProgressBar value={spent} max={budget} />
      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-mid">
          {t('dashboard.budgetSpent')} <span className="font-mono text-ink">{fmtCost(spent)}</span>
          {partial && (
            <span className="text-danger" title={t('dashboard.budgetPartialTitle')}>
              *
            </span>
          )}{' '}
          {t('dashboard.budgetOf')} <span className="font-mono">{fmtCost(budget)}</span>
        </span>
        <span className={cn('font-mono text-[12px]', over ? 'text-danger' : 'text-ok')}>
          {tf('dashboard.onPaceFor', { amount: fmtCost(pace) })}
        </span>
      </div>
    </div>
  );
}

function ActivityCard() {
  const activity = useQuery(activityQuery());
  const { t } = useT();
  return (
    <Card title={t('dashboard.activity')} bodyClassName="p-1.5">
      {activity.isLoading && <SkeletonRows n={4} />}
      {activity.data?.length === 0 && <EmptyState title={t('dashboard.noHookEvents')} />}
      {activity.data?.slice(0, 10).map((a) => {
        const Icon =
          a.event === 'UserPromptSubmit' ? MessageSquare
          : a.event === 'Stop' ? Check
          : a.event === 'SessionStart' ? Play
          : a.event === 'SubagentStop' ? Bot
          : Square;
        return (
          <div key={a.id} className="flex items-center gap-2.5 rounded px-2 py-1.5">
            <Icon size={13} aria-hidden className="shrink-0 text-dim" />
            <span className="min-w-0 flex-1 truncate text-xs">
              <span className="text-mid">{a.projectName ?? '—'}</span>
              {a.event === 'UserPromptSubmit' && a.prompt && (
                <span className="text-dim"> — “{truncate(a.prompt, 80)}”</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-dim">{fmtRelative(a.ts)}</span>
          </div>
        );
      })}
    </Card>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

function NowCard() {
  const { sessions } = useLive();
  const now = useNow(1000);
  const { t, tf } = useT();
  const working = sessions.filter((s) => s.status === 'working');

  return (
    <Card title={t('dashboard.now')} bodyClassName="p-2">
      {sessions.length === 0 && (
        <div className="flex items-center gap-3 px-2 py-4">
          <span className="h-2 w-2 rounded-full bg-dim" />
          <span className="text-sm text-mid">{t('dashboard.allQuiet')}</span>
        </div>
      )}
      {sessions.map((s) => (
        <Link
          key={s.sessionId}
          to={`/sessions/${s.sessionId}`}
          className="flex items-center gap-3 rounded px-2 py-2.5 hover:bg-surface2"
        >
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              s.status === 'working' ? 'bg-claude pulse-dot' : s.status === 'idle' ? 'bg-ok' : 'bg-dim'
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] text-ink">
              <span className="text-mid">{s.projectName ?? '?'}</span>
              {s.title ? ` — ${s.title}` : ''}
            </span>
            {s.lastPrompt && (
              <span className="block truncate font-mono text-[11px] text-dim">“{s.lastPrompt}”</span>
            )}
          </span>
          {s.status === 'working' ? (
            <span className="shrink-0 font-mono text-xs text-claude">{tf('dashboard.workingElapsed', { elapsed: fmtElapsed(now - s.since) })}</span>
          ) : (
            <Badge tone={s.status === 'idle' ? 'ok' : 'default'}>{s.status === 'idle' ? t('dashboard.waitingForYou') : t('dashboard.open')}</Badge>
          )}
        </Link>
      ))}
      {working.length > 1 && (
        <div className="px-2 pb-1 pt-1.5 font-mono text-[11px] text-dim">
          {tf('dashboard.parallelSessions', { n: working.length })}
        </div>
      )}
    </Card>
  );
}

function WeekTrend({ week }: { week: { date: string; claudeMs: number; prompts: number }[] }) {
  const max = Math.max(...week.map((w) => w.claudeMs), 1);
  const W = 420;
  const H = 96;
  const gap = 8;
  const bw = (W - gap * (week.length - 1)) / week.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full">
        {week.map((w, i) => {
          const h = Math.max((w.claudeMs / max) * H, w.claudeMs > 0 ? 3 : 1.5);
          const x = i * (bw + gap);
          const isToday = i === week.length - 1;
          return (
            <g key={w.date}>
              <rect
                x={x} y={H - h} width={bw} height={h} rx={3}
                style={{ fill: CLAUDE_COLOR }}
                opacity={isToday ? 1 : 0.55}
              >
                <title>{`${fmtDay(w.date)} — ${fmtDuration(w.claudeMs)} · ${plural(w.prompts, 'prompt')}`}</title>
              </rect>
              <text
                x={x + bw / 2} y={H + 13} textAnchor="middle"
                className="fill-dim font-mono" fontSize={9}
              >
                {fmtDay(w.date).split(', ')[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TodaySplit({ rows }: { rows: { id: number; name: string; claudeMs: number; prompts: number; estCostUsd: number }[] }) {
  const total = rows.reduce((s, r) => s + r.claudeMs, 0) || 1;
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {rows.map((r) => (
          <div
            key={r.id}
            style={{ width: `${Math.max((r.claudeMs / total) * 100, 1)}%`, background: projectColor(r.id) }}
            title={`${r.name} — ${fmtDuration(r.claudeMs)}`}
          />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.slice(0, 6).map((r) => (
          <Link key={r.id} to={`/projects/${r.id}`} className="flex items-center gap-2.5 rounded px-1 py-0.5 hover:bg-surface2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: projectColor(r.id) }} />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{r.name}</span>
            <span className="font-mono text-[12px] text-claude">{fmtDuration(r.claudeMs)}</span>
            <span className="w-12 text-right font-mono text-[12px] text-dim">{fmtCost(r.estCostUsd)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
