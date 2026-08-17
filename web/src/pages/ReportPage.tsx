import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { FileDown, Sparkles, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { MODE } from '../lib/source';
import { projectsQuery } from '../lib/queries';
import type { PrLink } from '../lib/types';
import { todayKey, addDays } from '../lib/time';
import { fmtClock, fmtCost, fmtCount, fmtDay, fmtDayFull, fmtDuration, fmtRelative, plural } from '../lib/format';
import { renderInline } from '../lib/md';
import { Badge, Card, EmptyState, SegmentedControl, SkeletonRows, StatCard } from '../components/ui';
import { cn } from '../lib/cn';
import { getLocale, useT } from '../lib/i18n';

interface ReportSession {
  id: string;
  title: string;
  startedAt: number;
  claudeMs: number;
  promptCount: number;
  estCostUsd: number | null;
  worktreeBranch: string | null;
  subagentCount: number;
  prLinks: PrLink[];
  linesAdded: number;
  linesRemoved: number;
}

interface ReportData {
  project: { id: number; name: string; path: string };
  from: string;
  to: string;
  totals: {
    sessions: number;
    claudeMs: number;
    userActiveMs: number;
    prompts: number;
    estCostUsd: number;
    linesAdded: number;
    linesRemoved: number;
    prCount: number;
  };
  days: {
    date: string;
    sessions: ReportSession[];
    journal: { id: number; ts: number; text: string; source: string }[];
    prompts: number;
  }[];
  summary: { markdown: string; createdAt: number; stale: boolean } | null;
}

const reportQuery = (projectId: number | null, from: string | null, to: string | null) =>
  queryOptions({
    queryKey: ['report', projectId, from, to],
    queryFn: () => api.get<ReportData>(`/api/report/${projectId}${qs({ from, to })}`),
    enabled: projectId != null,
    staleTime: 15_000,
  });

type Range = 'all' | '90d' | '60d' | '30d' | '7d' | 'custom';
type Mode = 'summary' | 'review';

const RANGE_DAYS: Partial<Record<Range, number>> = { '90d': 89, '60d': 59, '30d': 29, '7d': 6 };

interface DayReviewData {
  project: { id: number; name: string; path: string };
  from: string;
  to: string;
  gitAvailable: boolean;
  days: { date: string; prompts: { text: string; truncatedFrom: number | null }[]; journal: string[] }[];
  cached: { markdown: string; createdAt: number; stale: boolean } | null;
}

const dayReviewQuery = (projectId: number | null, from: string | null, to: string | null) =>
  queryOptions({
    queryKey: ['day-review', projectId, from, to, getLocale()],
    queryFn: () => api.get<DayReviewData>(`/api/review/${projectId}${qs({ from, to, lang: getLocale() })}`),
    enabled: projectId != null,
    staleTime: 15_000,
  });

export default function ReportPage() {
  const [params, setParams] = useSearchParams();
  const { t, tf } = useT();
  const projects = useQuery(projectsQuery());
  const roots = useMemo(
    () => (projects.data ?? []).filter((p) => p.parentProjectId == null).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
    [projects.data]
  );
  const projectId = params.get('project') ? Number(params.get('project')) : roots[0]?.id ?? null;
  const range = (params.get('range') as Range) ?? 'all';
  const mode = (params.get('mode') as Mode) ?? 'summary';
  const to = range === 'custom' ? (params.get('to') ?? todayKey()) : todayKey();
  const from = range === 'all' ? null
    : range === 'custom' ? (params.get('from') ?? addDays(to, -29))
    : addDays(to, -RANGE_DAYS[range]!);
  const effectiveTo = range === 'all' ? null : to;

  const report = useQuery(reportQuery(projectId, from, effectiveTo));
  const queryClient = useQueryClient();
  const summarize = useMutation({
    mutationFn: () =>
      api.post<{ markdown: string }>(`/api/report/${projectId}/summarize`, {
        from: report.data?.from,
        to: report.data?.to,
        lang: getLocale(), // AI summary follows the UI language
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['report'] }),
  });
  const review = useQuery({
    ...dayReviewQuery(projectId, from, effectiveTo),
    enabled: projectId != null && mode === 'review',
  });
  const generate = useMutation({
    mutationFn: () =>
      api.post<{ markdown: string }>(
        `/api/review/${projectId}/generate${qs({ from, to: effectiveTo })}`,
        { lang: getLocale() }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['day-review'] }),
  });

  const setParam = (key: string, value: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  const d = report.data;
  const pdfHref = projectId != null ? `/api/report/${projectId}/pdf${qs({ from, to: effectiveTo })}` : '#';

  return (
    <div className="fade-up w-full space-y-4 p-5">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={projectId ?? ''}
          onChange={(e) => setParam('project', e.target.value)}
          aria-label={t('report.projectAria')}
          className="min-w-52 rounded-md border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none"
        >
          {roots.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <SegmentedControl<Mode>
          value={mode}
          onChange={(v) => setParam('mode', v === 'summary' ? null : v)}
          options={[
            { value: 'summary', label: t('report.modeSummary') },
            { value: 'review', label: t('report.modeReview') },
          ]}
        />
        <SegmentedControl<Range>
          options={[
            { value: 'all', label: t('report.allTime') },
            { value: '90d', label: t('report.range90') },
            { value: '60d', label: t('report.range60d') },
            { value: '30d', label: t('report.range30') },
            { value: '7d', label: t('report.range7d') },
            { value: 'custom', label: t('report.rangeCustom') },
          ]}
          value={range}
          onChange={(v) => setParam('range', v === 'all' ? null : v)}
        />
        {range === 'custom' && (
          <span className="flex items-center gap-1.5">
            <input
              type="date" value={from ?? ''} max={to}
              aria-label={t('report.fromLabel')}
              onChange={(e) => setParam('from', e.target.value || null)}
              className="rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none"
            />
            <span className="text-dim" aria-hidden>→</span>
            <input
              type="date" value={to} min={from ?? undefined}
              aria-label={t('report.toLabel')}
              onChange={(e) => setParam('to', e.target.value || null)}
              className="rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none"
            />
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => summarize.mutate()}
            disabled={summarize.isPending || !d || d.days.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-2 font-mono text-[12px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
          >
            {summarize.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {summarize.isPending ? t('report.summarizing') : d?.summary && !d.summary.stale ? t('report.refreshSummary') : d?.summary?.stale ? t('report.updateSummary') : t('report.aiSummaryBtn')}
          </button>
          {/* the PDF is rendered by the local server, so the link only exists there */}
          {MODE === 'local' && (
            <a
              href={pdfHref}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
              title={t('report.exportPdf')}
            >
              <FileDown size={12} /> pdf
            </a>
          )}
        </div>
      </div>
      {summarize.isPending && (
        <div className="rounded-md border border-claude/30 bg-claude/5 px-3 py-2 font-mono text-[12px] text-claude">
          {t('report.summarizeProgress')}
        </div>
      )}
      {summarize.isError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          {String((summarize.error as Error).message)}
        </div>
      )}

      {report.isLoading && <SkeletonRows n={8} />}

      {d && (
        <>
          <div>
            <h1 className="font-display text-xl font-medium text-ink">{tf('report.changelogTitle', { name: d.project.name })}</h1>
            <div className="mt-0.5 font-mono text-[12px] text-dim">
              {fmtDay(d.from)} — {fmtDay(d.to)} · {d.project.path}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t('report.claudeWorking')} value={fmtDuration(d.totals.claudeMs)} accent="claude" sub={plural(d.totals.sessions, 'session')} />
            <StatCard label={t('report.prompts')} value={fmtCount(d.totals.prompts)} />
            <StatCard
              label={t('report.linesChanged')}
              value={d.totals.linesAdded ? `+${fmtCount(d.totals.linesAdded)}` : '—'}
              sub={d.totals.linesRemoved ? tf('report.removedVia', { n: fmtCount(d.totals.linesRemoved) }) : t('report.viaSubagents')}
            />
            <StatCard label={t('report.estCost')} value={fmtCost(d.totals.estCostUsd)} sub={d.totals.prCount ? plural(d.totals.prCount, 'pull request') : undefined} />
          </div>

          {mode === 'summary' && (
            <>
              {d.summary && (
                <Card
                  title={`${t('report.aiSummaryTitle')}${d.summary.stale ? t('report.aiSummaryStale') : ''}`}
                  action={<span className="font-mono text-[11px] text-dim">{fmtRelative(d.summary.createdAt)}</span>}
                  bodyClassName={cn('p-4', d.summary.stale && 'opacity-70')}
                >
                  <SummaryMarkdown markdown={d.summary.markdown} />
                </Card>
              )}

              {d.days.length === 0 && <EmptyState title={t('report.noActivity')} />}

              {[...d.days].reverse().map((day) => (
                <section key={day.date}>
                  <h3 className="microlabel sticky top-0 z-10 -mx-1 bg-bg/95 px-1 py-2 backdrop-blur">
                    {fmtDayFull(day.date)}
                    {day.prompts > 0 && <span className="ml-2 normal-case tracking-normal">· {plural(day.prompts, 'prompt')}</span>}
                  </h3>
                  <div className="space-y-1.5">
                    {day.sessions.map((s) => (
                      <div key={s.id} className="rounded-md border border-line bg-surface px-3.5 py-2.5">
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-[11px] text-dim">{fmtClock(s.startedAt)}</span>
                          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.title}</span>
                          <span className="shrink-0 font-mono text-[12px] text-claude">{fmtDuration(s.claudeMs)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
                          {s.worktreeBranch && <Badge>{s.worktreeBranch}</Badge>}
                          <span>{plural(s.promptCount, 'prompt')}</span>
                          {s.linesAdded > 0 && (
                            <span>
                              <span className="text-ok">+{fmtCount(s.linesAdded)}</span> <span className="text-danger">−{fmtCount(s.linesRemoved)}</span> {t('report.lines')}
                            </span>
                          )}
                          {s.prLinks.map((pr) => (
                            <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" className="text-mid hover:text-claude">
                              {pr.repo ? `${pr.repo}#${pr.number}` : `PR #${pr.number}`} ↗
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                    {day.journal.map((j) => (
                      <div key={j.id} className="rounded-md border border-line/60 bg-surface2/40 px-3.5 py-2 text-xs leading-5 text-ink/85">
                        ✎ {renderInline(j.text)}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {mode === 'review' && (
            <>
              {review.isLoading && <SkeletonRows n={8} />}
              {review.data && !review.data.gitAvailable && (
                <div className="rounded border border-user/40 bg-user/5 px-3 py-2 font-mono text-[11px] text-user">
                  {t('report.reviewNoGit')}
                </div>
              )}
              <button
                onClick={() => generate.mutate()}
                disabled={generate.isPending || !review.data || review.data.days.length === 0}
                className="flex items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
              >
                {generate.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {generate.isPending ? t('report.reviewing')
                  : review.data?.cached && !review.data.cached.stale ? t('report.refreshReview')
                  : review.data?.cached?.stale ? t('report.updateReview')
                  : t('report.reviewBtn')}
              </button>
              {generate.isError && (
                <div className="font-mono text-[11px] text-danger">{String((generate.error as Error).message)}</div>
              )}
              {review.data?.cached && (
                <Card
                  title={`${t('report.modeReview')}${review.data.cached.stale ? t('report.aiSummaryStale') : ''}`}
                  action={<span className="font-mono text-[11px] text-dim">{fmtRelative(review.data.cached.createdAt)}</span>}
                  bodyClassName={cn('p-4', review.data.cached.stale && 'opacity-70')}
                >
                  <SummaryMarkdown markdown={review.data.cached.markdown} />
                </Card>
              )}
              {!review.data?.cached && !generate.isPending && (
                <EmptyState title={t('report.reviewEmpty')} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SummaryMarkdown({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let i = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('###')) {
      blocks.push(
        <h4 key={i++} className="mt-3 font-mono text-[12px] uppercase tracking-wider text-claude first:mt-0">
          {fmtDayLoose(line.replace(/^#+\s*/, ''))}
        </h4>
      );
    } else if (/^[-*•]\s+/.test(line)) {
      blocks.push(
        <div key={i++} className="flex gap-2 text-[14px] leading-5 text-ink/90">
          <span aria-hidden className="text-dim">•</span>
          <span>{renderInline(line.replace(/^[-*•]\s+/, ''))}</span>
        </div>
      );
    } else {
      blocks.push(
        <p key={i++} className="text-[14px] leading-5 text-ink/90">{renderInline(line)}</p>
      );
    }
  }
  return <div className="space-y-1.5">{blocks}</div>;
}

function fmtDayLoose(s: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDayFull(s) : s;
}
