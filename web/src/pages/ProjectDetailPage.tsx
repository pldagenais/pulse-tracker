import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, Cloud, RefreshCw, Sparkles } from 'lucide-react';
import { projectQuery, projectCalendarQuery } from '../lib/queries';
import { todayKey, addMonths } from '../lib/time';
import { claudeCellColor, claudeIntensity } from '../lib/colors';
import { fmtCost, fmtCount, fmtDay, fmtDuration, fmtRelative, plural } from '../lib/format';
import { getLocale, useT } from '../lib/i18n';
import { Card, EmptyState, SkeletonRows, Badge, StatCard, useChartTip, WriteError, useWriteAction } from '../components/ui';
import { SessionListItem } from '../components/SessionListItem';
import { OpenInButtons, QuickActions } from '../components/actions';
import { projectColor, CLAUDE_COLOR } from '../lib/colors';
import { renderInline } from '../lib/md';
import { api } from '../lib/api';
import { MODE } from '../lib/source';
import { cn } from '../lib/cn';

export default function ProjectDetailPage() {
  const { t, tf } = useT();
  const { id } = useParams<{ id: string }>();
  const q = useQuery(projectQuery(Number(id)));

  if (q.isLoading) return <div className="p-5"><SkeletonRows n={8} /></div>;
  if (!q.data) return <div className="p-5"><EmptyState title={t('projects.notFound')} /></div>;
  const { project, changesSummary, worktreeCount, totals, daily, sessions } = q.data;
  const max = Math.max(...daily.map((d) => d.claudeMs), 1);

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <Link to="/projects" className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-dim hover:text-claude">
        <ArrowLeft size={12} /> {t('projects.backLink')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-3 w-3 rounded-sm" style={{ background: projectColor(project.id) }} />
        <h2 className="font-display text-xl font-medium text-ink">{project.name}</h2>
        {project.worktreeBranch && <Badge>{project.worktreeBranch}</Badge>}
        {worktreeCount > 0 && (
          <Badge tone="claude">{tf('projects.inclWorktrees', { count: plural(worktreeCount, 'worktree') })}</Badge>
        )}
        <Link
          to={`/report?project=${project.id}&mode=review&range=30d`}
          className="ml-auto rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
        >
          {t('report.reviewLink')}
        </Link>
        <OpenInButtons projectId={project.id} />
      </div>
      <div className="font-mono text-[12px] text-dim">{project.path}</div>
      <QuickActions projectId={project.id} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('projects.claudeWorking')} value={fmtDuration(totals.claudeMs)} accent="claude" />
        <StatCard label={t('projects.youActive')} value={fmtDuration(totals.userActiveMs)} accent="user" />
        <StatCard label={t('projects.sessions')} value={fmtCount(totals.sessions)} />
        <StatCard label={t('projects.prompts')} value={fmtCount(totals.prompts)} />
        <StatCard label={t('projects.estCost')} value={fmtCost(totals.estCostUsd)} sub={t('projects.apiEquivalent')} />
      </div>

      <ChangesSummaryCard projectId={project.id} summary={changesSummary} />

      <Card title={t('projects.last30Days')} bodyClassName="p-4">
        <DailyBars daily={daily} max={max} />
      </Card>

      <MonthCalendar projectId={project.id} />

      <BranchBreakdown sessions={sessions} />

      <Card title={`${tf('projects.sessionsTitle', { n: fmtCount(totals.sessions) })}${sessions.length < totals.sessions ? tf('projects.sessionsShowing', { n: sessions.length }) : ''}`} bodyClassName="p-1.5">
        {sessions.length === 0 && <EmptyState title={t('projects.noSessions')} />}
        {sessions.map((s) => (
          <SessionListItem key={s.id} s={s} showProject={false} />
        ))}
      </Card>
    </div>
  );
}

/**
 * 2-3 paragraphs of prose describing the latest work in this project,
 * generated on demand by the local summarizer and cached server-side. In
 * cloud mode the cached text arrives with the mirrored project snapshot;
 * generating a fresh one needs the PC.
 */
function ChangesSummaryCard({
  projectId,
  summary,
}: {
  projectId: number;
  summary: { markdown: string; createdAt: number; stale: boolean } | null;
}) {
  const { t, tf } = useT();
  const queryClient = useQueryClient();
  const gen = useWriteAction(async () => {
    // the summary is written in the UI language
    await api.post(`/api/projects/${projectId}/changes-summary`, { lang: getLocale() });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  });
  const local = MODE === 'local';

  const action = (
    <span className="flex items-center gap-2">
      <WriteError error={gen.error} />
      {summary && (
        <span className="font-mono text-[11px] text-dim" title={summary.stale ? t('projects.summaryStaleTitle') : undefined}>
          {summary.stale ? t('projects.summaryOutdated') : ''}{tf('projects.summaryWritten', { when: fmtRelative(summary.createdAt) })}
        </span>
      )}
      <button
        onClick={() => gen.run()}
        disabled={gen.pending || !local}
        title={local ? undefined : t('projects.genNeedsPc')}
        className="flex items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude disabled:opacity-40"
      >
        {gen.pending ? (
          <>
            <RefreshCw size={11} className="animate-spin" /> {t('projects.writing')}
          </>
        ) : summary ? (
          <>
            <RefreshCw size={11} /> {t('projects.refresh')}
          </>
        ) : (
          <>
            <Sparkles size={11} /> {t('projects.summarize')}
          </>
        )}
      </button>
    </span>
  );

  return (
    <Card title={t('projects.latestChanges')} action={action} bodyClassName="p-4">
      {summary ? (
        <div className="max-w-[70ch] space-y-3 text-[13.5px] leading-6 text-ink/90">
          {summary.markdown
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .map((p, i) => (
              <p key={i}>{renderInline(p.replace(/\n/g, ' '))}</p>
            ))}
        </div>
      ) : (
        <div className="text-xs leading-5 text-dim">
          {local ? t('projects.noSummaryLocal') : t('projects.noSummaryRemote')}
        </div>
      )}
    </Card>
  );
}

function DailyBars({ daily, max }: { daily: { date: string; claudeMs: number }[]; max: number }) {
  const { tf } = useT();
  const { hostRef, show, hide, tipEl } = useChartTip();
  return (
    <div ref={hostRef} className="relative">
      <svg viewBox="0 0 900 110" className="w-full">
        {daily.map((d, i) => {
          const bw = 900 / daily.length - 3;
          const h = Math.max((d.claudeMs / max) * 90, d.claudeMs > 0 ? 2.5 : 1);
          return (
            <rect
              key={d.date}
              x={i * (bw + 3)} y={95 - h} width={bw} height={h} rx={2}
              style={{ fill: CLAUDE_COLOR }} opacity={d.claudeMs > 0 ? 0.85 : 0.15}
              onPointerEnter={(e) =>
                show(
                  e,
                  <>
                    <div className="text-ink">{fmtDay(d.date)}</div>
                    <div className="text-mid">{tf('projects.tooltipClaude', { dur: fmtDuration(d.claudeMs) })}</div>
                  </>,
                )
              }
              onPointerLeave={hide}
            />
          );
        })}
      </svg>
      {tipEl}
    </div>
  );
}

/* Per-branch rollup: end-to-end cost of each feature branch (worktree branch
 * when present, else the session's git branch, else the main checkout). */
function BranchBreakdown({ sessions }: { sessions: import('../lib/types').SessionSummary[] }) {
  const { t, tf } = useT();
  const groups = new Map<string, { claudeMs: number; cost: number; sessions: number; prompts: number }>();
  for (const s of sessions) {
    const key = s.worktreeBranch ?? (s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : t('projects.mainCheckout'));
    const g = groups.get(key) ?? { claudeMs: 0, cost: 0, sessions: 0, prompts: 0 };
    g.claudeMs += s.claudeMs;
    g.cost += s.estCostUsd ?? 0;
    g.sessions += 1;
    g.prompts += s.promptCount;
    groups.set(key, g);
  }
  if (groups.size < 2) return null;
  const rows = [...groups.entries()].sort((a, b) => b[1].claudeMs - a[1].claudeMs);
  const max = Math.max(...rows.map(([, g]) => g.claudeMs), 1);
  return (
    <Card title={tf('projects.byBranch', { n: rows.length })} bodyClassName="p-0">
      <div className="max-h-56 overflow-y-auto">
        {rows.map(([branch, g]) => (
          <div key={branch} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
            <span className="w-44 shrink-0 truncate font-mono text-[12px] text-ink" title={branch}>{branch}</span>
            <div className="h-3 min-w-0 flex-1 rounded-[3px] bg-raise">
              <div className="h-full rounded-[3px] bg-claude/70" style={{ width: `${Math.max((g.claudeMs / max) * 100, 1.5)}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-claude">{fmtDuration(g.claudeMs)}</span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] text-dim">{tf('projects.sessAbbrev', { n: g.sessions })}</span>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-user">{fmtCost(g.cost)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* Full-month activity calendar for this project family. Cells carry the
 * shared day-intensity ramp plus the day's Claude hours; click → day timeline. */
function MonthCalendar({ projectId }: { projectId: number }) {
  const { t, tf, locale } = useT();
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const q = useQuery(projectCalendarQuery(projectId, month));
  const navigate = useNavigate();
  const today = todayKey();
  const thisMonth = today.slice(0, 7);

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first
  const byDate = new Map((q.data?.days ?? []).map((d) => [d.date, d]));
  const totalMs = (q.data?.days ?? []).reduce((t, d) => t + d.claudeMs, 0);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-US', { month: 'long', year: 'numeric' });

  const compact = (ms: number) =>
    ms >= 3600_000 ? `${(ms / 3600_000).toFixed(ms >= 36_000_000 ? 0 : 1)}h` : ms > 0 ? `${Math.max(Math.round(ms / 60_000), 1)}m` : '';

  return (
    <Card
      title={t('projects.activityCalendar')}
      action={
        <span className="flex items-center gap-1.5">
          {totalMs > 0 && <span className="mr-1.5 font-mono text-[11px] text-claude">{tf('projects.thisMonth', { dur: fmtDuration(totalMs) })}</span>}
          <button
            onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}
            aria-label={t('projects.prevMonth')}
            className="rounded border border-line p-1 text-dim hover:text-ink"
          >
            <ChevronLeft size={12} />
          </button>
          <span className="w-32 text-center font-mono text-[12px] text-mid">{monthLabel}</span>
          <button
            onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}
            disabled={month >= thisMonth}
            aria-label={t('projects.nextMonth')}
            className="rounded border border-line p-1 text-dim hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={12} />
          </button>
        </span>
      }
      bodyClassName="p-4"
    >
      {/* cloud mirrors only the current month; say so instead of a silently empty grid */}
      {q.isSuccess && !q.data && (
        <div className="mb-2 font-mono text-[11px] text-dim">
          {t('projects.monthNotMirrored')}
        </div>
      )}
      <div className="grid grid-cols-7 gap-1.5">
        {(['projects.dowMon', 'projects.dowTue', 'projects.dowWed', 'projects.dowThu', 'projects.dowFri', 'projects.dowSat', 'projects.dowSun'] as const).map((d) => (
          <div key={d} className="pb-1 text-center font-mono text-[10px] uppercase tracking-wider text-dim">{t(d)}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const d = byDate.get(date);
          const isToday = date === today;
          const future = date > today;
          return (
            <button
              key={date}
              onClick={() => !future && navigate(`/timeline/day?date=${date}`)}
              disabled={future}
              title={d
                ? tf('projects.dayTitle', { day: fmtDay(date), dur: fmtDuration(d.claudeMs), sessions: plural(d.sessions, 'session') })
                  + (d.cloudMs > 0 ? tf('projects.dayTitleCloud', { dur: fmtDuration(d.cloudMs) }) : '')
                : fmtDay(date)}
              className={cn(
                'group relative flex h-14 flex-col items-center justify-center rounded-md border transition-transform',
                isToday ? 'border-claude/60' : 'border-line/60',
                future ? 'opacity-30' : 'hover:-translate-y-px hover:border-claude/40'
              )}
              style={{ background: d ? claudeCellColor(d.claudeMs) : undefined }}
            >
              <span
                className="absolute left-1.5 top-1 font-mono text-[10px]"
                style={{ color: d && claudeIntensity(d.claudeMs) >= 0.34 ? 'rgba(0,0,0,0.55)' : 'var(--color-dim)' }}
              >
                {i + 1}
              </span>
              <span className={cn('font-mono text-[14px] font-medium', d ? 'text-ink' : 'text-dim/50')}>
                {d ? compact(d.claudeMs) : '·'}
              </span>
              {d && d.cloudMs > 0 && (
                <span className="absolute right-1.5 top-1" title={t('projects.cloudTimeTitle')}>
                  <Cloud size={9} className="text-claude/70" aria-label={t('pill.includesCloud')} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 font-mono text-[11px] text-dim">
        {t('projects.calendarFootnote')}
      </div>
    </Card>
  );
}
