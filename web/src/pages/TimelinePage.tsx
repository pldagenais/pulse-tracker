import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { timelineQuery, dailyStatsQuery, projectStatsQuery, heatmapQuery } from '../lib/queries';
import { todayKey, addDays, weekOf, monthGrid, addMonths, isToday, monthKey } from '../lib/time';
import { fmtCost, fmtCount, fmtDay, fmtDayFull, fmtDuration, plural } from '../lib/format';
import { Card, EmptyState, SegmentedControl, Skeleton, StatCard, useChartTip } from '../components/ui';
import { useT } from '../lib/i18n';
import { Gantt, type LaneMode } from '../components/timeline/Gantt';
import { projectColor, claudeCellColor, legacyCellColor, CLAUDE_ALPHAS, LEGACY_HATCH } from '../lib/colors';
import { cn } from '../lib/cn';

type View = 'day' | 'week' | 'month';

export default function TimelinePage() {
  const { view = 'day' } = useParams<{ view: View }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, locale } = useT();
  const date = params.get('date') ?? todayKey();

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    next.set('date', d);
    setParams(next, { replace: true });
  };
  const step = (dir: 1 | -1) => {
    if (view === 'day') setDate(addDays(date, dir));
    else if (view === 'week') setDate(addDays(date, 7 * dir));
    else setDate(addMonths(date, dir));
  };
  const atToday = date >= todayKey();

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<View>
          options={[
            { value: 'day', label: t('timeline.day') },
            { value: 'week', label: t('timeline.week') },
            { value: 'month', label: t('timeline.month') },
          ]}
          value={view as View}
          onChange={(v) => navigate(`/timeline/${v}?date=${date}`)}
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => step(-1)}
            aria-label={t(view === 'day' ? 'timeline.prevDay' : view === 'week' ? 'timeline.prevWeek' : 'timeline.prevMonth')}
            className="rounded border border-line p-1.5 text-mid hover:bg-surface2 hover:text-ink"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="min-w-44 text-center font-mono text-xs text-ink">
            {view === 'month' ? new Date(date + 'T00:00').toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-US', { month: 'long', year: 'numeric' }) : fmtDayFull(date)}
          </span>
          <button
            onClick={() => step(1)}
            disabled={atToday}
            aria-label={t(view === 'day' ? 'timeline.nextDay' : view === 'week' ? 'timeline.nextWeek' : 'timeline.nextMonth')}
            className="rounded border border-line p-1.5 text-mid enabled:hover:bg-surface2 enabled:hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => setDate(todayKey())}
            className="ml-1 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
          >
            {t('timeline.today')}
          </button>
        </div>
      </div>

      {view === 'day' && <DayView date={date} />}
      {view === 'week' && <WeekView date={date} />}
      {view === 'month' && <MonthView date={date} />}
    </div>
  );
}

/* ───────────────────────── Day ───────────────────────── */

function DayView({ date }: { date: string }) {
  const tl = useQuery(timelineQuery(date));
  const day = useQuery(dailyStatsQuery(date, date));
  const [full24, setFull24] = useState(false);
  const [laneMode, setLaneMode] = useState<LaneMode>('project');
  const { t, tf } = useT();
  const d = day.data?.rows[0];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('timeline.claudeWorking')} value={fmtDuration(d?.claudeMs ?? 0)} accent="claude" />
        <StatCard label={t('timeline.youActive')} value={fmtDuration(d?.userActiveMs ?? 0)} accent="user" />
        <StatCard label={t('timeline.prompts')} value={fmtCount(d?.prompts ?? 0)} />
        <StatCard label={t('timeline.sessions')} value={fmtCount(d?.sessions ?? 0)} />
        <StatCard label={t('timeline.estCost')} value={fmtCost(d?.estCostUsd ?? 0)} />
      </div>

      <Card
        title={t('timeline.sessionTimeline')}
        action={
          <div className="flex items-center gap-3">
            <SegmentedControl<LaneMode>
              options={[
                { value: 'project', label: t('timeline.byProject') },
                { value: 'session', label: t('timeline.bySession') },
              ]}
              value={laneMode}
              onChange={setLaneMode}
            />
            <button
              onClick={() => setFull24((v) => !v)}
              className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude"
            >
              {full24 ? t('timeline.fitActivity') : t('timeline.full24h')}
            </button>
          </div>
        }
        bodyClassName="p-3"
      >
        {tl.isLoading && <Skeleton className="h-64" />}
        {tl.data && tl.data.sessions.length === 0 && (
          <EmptyState
            title={tf('timeline.noActivityOn', { date: fmtDay(date) })}
            hint={
              tl.data.legacy
                ? tf('timeline.legacyDayHint', { count: fmtCount(tl.data.legacy.message_count ?? 0) })
                : undefined
            }
          />
        )}
        {tl.data && tl.data.sessions.length > 0 && <Gantt day={tl.data} full24={full24} laneMode={laneMode} />}
      </Card>
    </>
  );
}

/* ───────────────────────── Week ───────────────────────── */

function WeekView({ date }: { date: string }) {
  const days = weekOf(date);
  const totals = useQuery(dailyStatsQuery(days[0], days[6]));
  const perDay = useQueries({ queries: days.map((d) => projectStatsQuery(d, d)) });
  const navigate = useNavigate();
  const { t } = useT();
  const { hostRef, show, hide, tipEl } = useChartTip();

  const { legend, stacks, max } = useMemo(() => {
    const totalsByProject = new Map<number, { name: string; total: number }>();
    const stacks = days.map((day, i) => {
      const rows = perDay[i].data?.rows ?? [];
      for (const r of rows) {
        const key = r.parentProjectId ?? r.id;
        const cur = totalsByProject.get(key) ?? { name: r.parentProjectId ? r.name.split(' [')[0] : r.name, total: 0 };
        cur.total += r.claudeMs;
        totalsByProject.set(key, cur);
      }
      return { day, rows };
    });
    const legend = [...totalsByProject.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([id, v]) => ({ id, name: v.name, total: v.total }));
    const max = Math.max(...stacks.map((s) => s.rows.reduce((t, r) => t + r.claudeMs, 0)), 1);
    return { legend, stacks, max };
  }, [perDay, days]);

  const W = 760;
  const H = 220;
  const gap = 14;
  const bw = (W - gap * 6) / 7;

  return (
    <Card
      title={t('timeline.claudeTimeByProject')}
      action={
        <Link
          to={`/digest?date=${date}`}
          className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude"
        >
          {t('timeline.digestLink')}
        </Link>
      }
      bodyClassName="p-4"
    >
      <div ref={hostRef} className="relative">
        <svg viewBox={`0 0 ${W} ${H + 34}`} className="w-full">
          {stacks.map((s, i) => {
            const x = i * (bw + gap);
            const total = s.rows.reduce((t, r) => t + r.claudeMs, 0);
            let y = H;
            const weekend = i >= 5;
            return (
              <g key={s.day} className="cursor-pointer" onClick={() => navigate(`/timeline/day?date=${s.day}`)}>
                {weekend && <rect x={x - 3} y={0} width={bw + 6} height={H} className="fill-surface2/40" />}
                {/* hit target sits BEHIND the segments so their tooltips still fire */}
                <rect x={x - 3} y={0} width={bw + 6} height={H + 20} fill="transparent" />
                {s.rows.map((r) => {
                  const h = (r.claudeMs / max) * H;
                  if (h < 0.75) return null;
                  y -= h;
                  return (
                    <rect
                      key={r.id} x={x} y={y + 1} width={bw} height={Math.max(h - 2, 1)} rx={2.5}
                      style={{ fill: projectColor(r.parentProjectId ?? r.id) }}
                      onPointerEnter={(e) =>
                        show(e, (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm" style={{ background: projectColor(r.parentProjectId ?? r.id) }} />
                            <span className="text-ink">{r.name}</span>
                            <span className="text-dim">{fmtDuration(r.claudeMs)}</span>
                          </div>
                        ))
                      }
                      onPointerLeave={hide}
                    />
                  );
                })}
                {total > 0 && (
                  <text x={x + bw / 2} y={Math.max(y - 6, 9)} textAnchor="middle" fontSize={9.5} className="fill-mid font-mono">
                    {fmtDuration(total)}
                  </text>
                )}
                <text x={x + bw / 2} y={H + 15} textAnchor="middle" fontSize={9.5} className={cn('font-mono', isToday(s.day) ? 'fill-claude' : 'fill-dim')}>
                  {fmtDay(s.day)}
                </text>
              </g>
            );
          })}
        </svg>
        {tipEl}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3">
        {legend.map((l) => (
          <Link key={l.id} to={`/projects/${l.id}`} className="flex items-center gap-1.5 font-mono text-[12px] text-mid hover:text-ink">
            <span className="h-2 w-2 rounded-sm" style={{ background: projectColor(l.id) }} />
            {l.name}
            <span className="text-dim">{fmtDuration(l.total)}</span>
          </Link>
        ))}
        {totals.data && (
          <span className="ml-auto font-mono text-[12px] text-dim">
            {t('timeline.weekTotal')}{' '}
            <span className="text-claude">{fmtDuration(totals.data.rows.reduce((sum, r) => sum + r.claudeMs, 0))}</span>
            {' · '}
            <span className="text-user">{fmtDuration(totals.data.rows.reduce((sum, r) => sum + r.userActiveMs, 0))} {t('timeline.you')}</span>
          </span>
        )}
      </div>
    </Card>
  );
}

/* ───────────────────────── Month ───────────────────────── */

function MonthView({ date }: { date: string }) {
  const heat = useQuery(heatmapQuery());
  const navigate = useNavigate();
  const { days } = monthGrid(date);
  const byDate = useMemo(() => new Map((heat.data?.days ?? []).map((d) => [d.date, d])), [heat.data]);
  const mk = monthKey(date);
  const { t } = useT();
  const { hostRef, show, hide, tipEl } = useChartTip();

  return (
    <Card title={t('timeline.monthTitle')} bodyClassName="p-4">
      <div ref={hostRef} className="relative">
        <div className="grid grid-cols-7 gap-1.5">
          {(['timeline.wdMon', 'timeline.wdTue', 'timeline.wdWed', 'timeline.wdThu', 'timeline.wdFri', 'timeline.wdSat', 'timeline.wdSun'] as const).map((k) => (
            <div key={k} className="microlabel pb-1 text-center">{t(k)}</div>
          ))}
          {days.map((day) => {
            const d = byDate.get(day);
            const inMonth = monthKey(day) === mk;
            const legacy = d?.legacy ?? false;
            const bg = legacy ? legacyCellColor(d?.messages ?? 0) : claudeCellColor(d?.claudeMs ?? 0);
            return (
              <button
                key={day}
                onClick={() => navigate(`/timeline/day?date=${day}`)}
                className={cn(
                  'group relative flex h-[72px] flex-col rounded border border-line p-1.5 text-left transition-colors hover:border-line2',
                  !inMonth && 'opacity-30',
                  isToday(day) && 'border-claude/60'
                )}
                style={{ background: legacy ? undefined : bg, backgroundImage: legacy ? `${LEGACY_HATCH}, linear-gradient(${bg}, ${bg})` : undefined }}
                onPointerEnter={(e) =>
                  show(e, (
                    <>
                      <div className="text-ink">{fmtDay(day)}</div>
                      {d && (
                        <div className="mt-0.5 text-dim">
                          {legacy ? (
                            <>{t('timeline.legacy')} · {plural(d.messages ?? 0, 'message')} {t('timeline.noDurationsBefore')}</>
                          ) : (
                            <>
                              <span className="text-claude">{fmtDuration(d.claudeMs)}</span> claude · {plural(d.prompts, 'prompt')}
                            </>
                          )}
                        </div>
                      )}
                    </>
                  ))
                }
                onPointerLeave={hide}
              >
                <span className={cn('font-mono text-[11px]', isToday(day) ? 'text-claude' : 'text-dim')}>
                  {Number(day.slice(8))}
                </span>
                {d && !legacy && d.claudeMs > 0 && (
                  <span className="mt-auto font-mono text-[11px] text-ink/90">{fmtDuration(d.claudeMs)}</span>
                )}
                {d && legacy && (d.messages ?? 0) > 0 && (
                  <span className="mt-auto font-mono text-[10px] text-mid">{fmtCount(d.messages ?? 0)} msg</span>
                )}
              </button>
            );
          })}
        </div>
        {tipEl}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 font-mono text-[11px] uppercase tracking-wider text-dim">
        {t('timeline.less')}
        {CLAUDE_ALPHAS.map((a) => (
          <span key={a} className="h-3 w-3 rounded-sm border border-line" style={{ background: `rgba(var(--claude-rgb),${a})` }} />
        ))}
        {t('timeline.more')}
        <span className="ml-4 h-3 w-3 rounded-sm border border-line" style={{ backgroundImage: LEGACY_HATCH }} />
        {t('timeline.preTranscriptEra')}
      </div>
    </Card>
  );
}
