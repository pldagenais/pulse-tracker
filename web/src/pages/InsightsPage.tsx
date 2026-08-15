import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  heatmapQuery, modelStatsQuery, toolStatsQuery, skillStatsQuery, hourStatsQuery, overviewQuery, dailyStatsQuery, prsQuery,
  tokenFlowQuery, errorFeedQuery, claudeAiQuery, mcpStatsQuery, compactionStatsQuery, focusStatsQuery,
} from '../lib/queries';
import { todayKey, addDays, weekOf } from '../lib/time';
import type { DayStat, HeatDay } from '../lib/types';
import { fmtCost, fmtCount, fmtDay, fmtDuration, fmtModel, fmtTokens, plural } from '../lib/format';
import { Card, SegmentedControl, Skeleton, StatCard, Badge, useChartTip } from '../components/ui';
import { MiniBars } from '../components/session/SessionDetailView';
import { modelColor, claudeCellColor, legacyCellColor, CLAUDE_ALPHAS, CLAUDE_COLOR, LEGACY_HATCH, USER_COLOR } from '../lib/colors';
import { cn } from '../lib/cn';

type Range = '7d' | '30d' | '90d' | 'all';

export default function InsightsPage() {
  const [range, setRange] = useState<Range>('30d');
  const to = todayKey();
  const heat = useQuery(heatmapQuery());
  const from =
    range === 'all'
      ? heat.data?.firstActivityDay ?? addDays(to, -364)
      : addDays(to, -(range === '7d' ? 6 : range === '30d' ? 29 : 89));

  const modelsRaw = useQuery(modelStatsQuery(from, to));
  // Distinct model-id variants (dated snapshots, fast-mode ids) share a display
  // label — merge them so "Opus 4.8" appears once.
  const models = useMemo(() => {
    if (!modelsRaw.data) return modelsRaw;
    const byLabel = new Map<string, (typeof modelsRaw.data.rows)[number]>();
    for (const m of modelsRaw.data.rows) {
      const label = fmtModel(m.model);
      const cur = byLabel.get(label);
      if (!cur) byLabel.set(label, { ...m });
      else {
        cur.inputTokens += m.inputTokens;
        cur.outputTokens += m.outputTokens;
        cur.cacheReadTokens += m.cacheReadTokens;
        cur.cacheWriteTokens += m.cacheWriteTokens;
        cur.estCostUsd = Math.round((cur.estCostUsd + m.estCostUsd) * 100) / 100;
        cur.messages += m.messages;
        cur.unpriced ||= m.unpriced;
      }
    }
    return { ...modelsRaw, data: { rows: [...byLabel.values()].sort((a, b) => b.estCostUsd - a.estCostUsd) } };
  }, [modelsRaw]);
  const tools = useQuery(toolStatsQuery(from, to));
  const skills = useQuery(skillStatsQuery(from, to));
  const hours = useQuery(hourStatsQuery(from, to));
  const costDaily = useQuery(dailyStatsQuery(addDays(to, -83), to));
  const ov = useQuery(overviewQuery(to));
  const records = ov.data?.records;

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <Card title="activity · last 12 months" bodyClassName="p-4">
        {heat.data ? <YearHeatmap days={heat.data.days} /> : <Skeleton className="h-32" />}
      </Card>

      {records && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="current streak" value={`${records.currentStreak}d`} sub={`longest ${records.longestStreak}d`} />
          <StatCard
            label="busiest day"
            value={records.busiestDay ? fmtDuration(records.busiestDay.claudeMs) : '—'}
            sub={records.busiestDay ? <Link className="hover:text-claude" to={`/timeline/day?date=${records.busiestDay.date}`}>{fmtDay(records.busiestDay.date)}</Link> : undefined}
            accent="claude"
          />
          <StatCard
            label="longest session"
            value={records.longestSession ? fmtDuration(records.longestSession.claudeMs) : '—'}
            sub={records.longestSession ? `${records.longestSession.project} — ${records.longestSession.title ?? ''}`.slice(0, 42) : undefined}
          />
          <StatCard
            label="most prompts · day"
            value={records.mostPromptsDay ? fmtCount(records.mostPromptsDay.prompts) : '—'}
            sub={records.mostPromptsDay ? fmtDay(records.mostPromptsDay.date) : undefined}
            accent="user"
          />
          <StatCard
            label="biggest token day"
            value={records.biggestTokenDay ? fmtTokens(records.biggestTokenDay.outputTokens) : '—'}
            sub={records.biggestTokenDay ? `${fmtDay(records.biggestTokenDay.date)} · output` : undefined}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="microlabel">breakdowns</span>
        <SegmentedControl<Range>
          options={[
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
            { value: 'all', label: 'all' },
          ]}
          value={range}
          onChange={setRange}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Card title="models · est. cost" bodyClassName="p-4">
          {models.data ? (
            models.data.rows.length === 0 ? (
              <div className="text-xs text-dim">No model usage in range.</div>
            ) : (
              <div className="space-y-3">
                <MiniBars
                  rows={models.data.rows.slice(0, 6).map((m) => ({
                    label: fmtModel(m.model),
                    value: Math.round(m.estCostUsd),
                    color: modelColor(m.model),
                  }))}
                />
                <table className="w-full font-mono text-[12px]">
                  <thead>
                    <tr className="text-left text-dim">
                      <th className="py-1 font-normal">model</th>
                      <th className="text-right font-normal">output</th>
                      <th className="text-right font-normal">cache w</th>
                      <th className="text-right font-normal">est. cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.data.rows.map((m) => (
                      <tr key={m.model} className="border-t border-line/60">
                        <td className="py-1.5 text-mid">{fmtModel(m.model)}</td>
                        <td className="text-right text-ink">{fmtTokens(m.outputTokens)}</td>
                        <td className="text-right text-dim">{fmtTokens(m.cacheWriteTokens)}</td>
                        <td
                          className="text-right text-user"
                          title={m.unpriced ? 'No price-table entry for this model — its tokens are not in this figure' : undefined}
                        >
                          {fmtCost(m.estCostUsd)}
                          {m.unpriced && <span className="text-danger">*</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <Skeleton className="h-40" />
          )}
        </Card>

        <Card title="est. cost · last 12 weeks" bodyClassName="p-4">
          {costDaily.data ? <CostWeeks rows={costDaily.data.rows} /> : <Skeleton className="h-32" />}
        </Card>

        <Card title="tools claude uses" bodyClassName="p-4">
          {tools.data ? (
            <div className="space-y-3">
              <MiniBars rows={tools.data.tools.slice(0, 9).map((t) => ({ label: t.name, value: t.count }))} />
              {(tools.data.linesAdded > 0 || tools.data.linesRemoved > 0) && (
                <div className="border-t border-line pt-2 font-mono text-[12px] text-dim">
                  subagent edits: <span className="text-ok">+{fmtCount(tools.data.linesAdded)}</span>{' '}
                  <span className="text-danger">−{fmtCount(tools.data.linesRemoved)}</span> lines
                </div>
              )}
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Card>

        <Card title="busiest hours" bodyClassName="p-4">
          {hours.data ? <HourHistogram rows={hours.data.rows} /> : <Skeleton className="h-32" />}
        </Card>

        <TokenFlowCard />

        <CompactionCard from={from} to={to} />

        <FocusCard from={from} to={to} />

        <McpUsageCard from={from} to={to} />

        <PrOutcomesCard />

        <ErrorFeedCard />

        <ClaudeAiCard />

        <Card title="skills & plugins" bodyClassName="p-4">
          {skills.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {skills.data.skills.slice(0, 16).map((s, i) => (
                  <Badge key={s.name} tone={i < 3 ? 'claude' : 'default'}>{s.name} ×{s.count}</Badge>
                ))}
                {skills.data.skills.length === 0 && <span className="text-xs text-dim">No skill attributions in range.</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                {skills.data.plugins.slice(0, 12).map((p) => (
                  <Badge key={p.name}>{p.name} ×{p.count}</Badge>
                ))}
              </div>
            </div>
          ) : (
            <Skeleton className="h-32" />
          )}
        </Card>
      </div>
    </div>
  );
}

/* Compaction tax: how often context collapsed and what rebuilding it cost.
 * The sharpest cost event in a long session, previously invisible. */
function CompactionCard({ from, to }: { from: string; to: string }) {
  const q = useQuery(compactionStatsQuery(from, to));
  const d = q.data;
  return (
    <Card title="compaction tax" bodyClassName="p-4">
      {!d ? (
        <Skeleton className="h-32" />
      ) : d.compactions === 0 ? (
        <div className="text-xs text-dim">
          No compactions detected in range — no session's context collapsed by more than 40%.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-6">
            <div>
              <div className="font-mono text-[29px] leading-9 font-medium text-ink">{d.compactions}</div>
              <div className="microlabel mt-0.5">compactions</div>
            </div>
            <div>
              <div className="font-mono text-[29px] leading-9 font-medium text-user">{fmtTokens(d.rebuildTokens)}</div>
              <div className="microlabel mt-0.5">rebuild tokens</div>
            </div>
          </div>
          <div className="border-t border-line pt-2 font-mono text-[12px] text-dim">
            {d.sessionsHit} of {d.sessionsTotal} sessions compacted · rebuild = cache writes on the
            first requests after each collapse
          </div>
        </div>
      )}
    </Card>
  );
}

/* Fragmentation: project switches per day and the longest unbroken run. */
function FocusCard({ from, to }: { from: string; to: string }) {
  const q = useQuery(focusStatsQuery(from, to));
  const d = q.data;
  const maxDay = d ? Math.max(...d.days.map((x) => x.switches), 1) : 1;
  return (
    <Card title="focus & context switching" bodyClassName="p-4">
      {!d ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-6">
            <div>
              <div className="font-mono text-[29px] leading-9 font-medium text-ink">{d.switches}</div>
              <div className="microlabel mt-0.5">project switches</div>
            </div>
            {d.longestBlock && (
              <div className="min-w-0">
                <div className="truncate font-mono text-[29px] leading-9 font-medium text-claude">
                  {fmtDuration(d.longestBlock.ms)}
                </div>
                <div className="microlabel mt-0.5 truncate" title={d.longestBlock.project}>
                  longest run · {d.longestBlock.project}
                </div>
              </div>
            )}
          </div>
          {d.days.length > 0 && (
            <div className="flex h-10 items-end gap-[2px]" aria-hidden>
              {d.days.slice(-30).map((x) => (
                <div
                  key={x.date}
                  className="min-w-[3px] flex-1 rounded-t-[2px] bg-user/60"
                  style={{ height: `${Math.max((x.switches / maxDay) * 100, 8)}%` }}
                  title={`${x.date}: ${x.switches} switch${x.switches === 1 ? '' : 'es'}`}
                />
              ))}
            </div>
          )}
          <div className="border-t border-line pt-2 font-mono text-[12px] text-dim">
            {d.projectsTouched} projects touched · a switch = consecutive turns in different projects
          </div>
        </div>
      )}
    </Card>
  );
}

/* Which MCP servers earn their context cost: every configured server burns
 * tool-definition tokens in every request, used or not. */
function McpUsageCard({ from, to }: { from: string; to: string }) {
  const q = useQuery(mcpStatsQuery(from, to));
  const d = q.data;
  return (
    <Card title="mcp servers" bodyClassName="p-4">
      {!d ? (
        <Skeleton className="h-32" />
      ) : d.servers.length === 0 ? (
        <div className="text-xs text-dim">No MCP tool calls in range.</div>
      ) : (
        <div className="space-y-3">
          <MiniBars rows={d.servers.slice(0, 8).map((s) => ({ label: s.name, value: s.calls }))} />
          <div className="border-t border-line pt-2 font-mono text-[12px] text-dim">
            top tool: {d.tools[0] ? `${d.tools[0].name} ×${d.tools[0].calls}` : '—'} · every configured
            server costs context whether used or not — see Manage for per-server detail
          </div>
        </div>
      )}
    </Card>
  );
}

/* Token-economics flow: where input tokens come from (fresh vs cache) per
 * model, with the est. dollar figure caching saved. Sankey-style ribbons,
 * hand-rolled SVG to match the gantt aesthetic. */
function TokenFlowCard() {
  const q = useQuery(tokenFlowQuery(30));
  const d = q.data;
  if (!d || d.models.length === 0) return null;

  const SOURCES = [
    { key: 'cacheRead' as const, label: 'cache reads', color: 'var(--chart-bar-muted)' },
    { key: 'cacheWrite' as const, label: 'cache writes', color: 'var(--color-user)' },
    { key: 'freshInput' as const, label: 'fresh input', color: 'var(--color-claude)' },
  ];
  const models = d.models.slice(0, 4);
  const totalIn = models.reduce((t, m) => t + m.freshInput + m.cacheRead + m.cacheWrite, 0) || 1;
  const H = 190;
  const GAP = 6;
  const usableH = H - GAP * 2;
  const scale = (v: number) => Math.max((v / totalIn) * usableH, v > 0 ? 2 : 0);

  // left column: source nodes; right column: model nodes
  let y = 0;
  const srcNodes = SOURCES.map((s) => {
    const v = models.reduce((t, m) => t + m[s.key], 0);
    const h = scale(v);
    const node = { ...s, v, y, h };
    y += h + GAP;
    return node;
  });
  let y2 = 0;
  const modelNodes = models.map((m) => {
    const v = m.freshInput + m.cacheRead + m.cacheWrite;
    const h = scale(v);
    const node = { m, v, y: y2, h, offsets: {} as Record<string, number> };
    y2 += h + GAP;
    return node;
  });
  // ribbon offsets
  const srcOffsets: Record<string, number> = {};
  for (const s of srcNodes) srcOffsets[s.key] = s.y;
  const ribbons: { path: string; color: string; v: number; src: string; model: string }[] = [];
  for (const mn of modelNodes) {
    let mOff = mn.y;
    for (const s of srcNodes) {
      const v = mn.m[s.key];
      if (v <= 0) continue;
      const h = scale(v);
      const y0 = srcOffsets[s.key];
      srcOffsets[s.key] += h;
      const x0 = 130;
      const x1 = 330;
      const c = (x1 - x0) / 2;
      ribbons.push({
        v,
        src: s.label,
        model: mn.m.model,
        color: s.color,
        path: `M${x0},${y0} C${x0 + c},${y0} ${x1 - c},${mOff} ${x1},${mOff} L${x1},${mOff + h} C${x1 - c},${mOff + h} ${x0 + c},${y0 + h} ${x0},${y0 + h} Z`,
      });
      mOff += h;
    }
  }

  return (
    <Card
      title="token economics · 30d"
      action={<span className="font-mono text-[11px] text-ok">caching saved ~{fmtCost(d.savedUsd)} est.</span>}
      bodyClassName="p-4"
    >
      <svg viewBox={`0 0 470 ${H}`} className="w-full" role="img" aria-label="Token flow from input sources to models">
        {srcNodes.map((s) => (
          <g key={s.key}>
            <rect x={122} y={s.y} width={8} height={Math.max(s.h, 1)} rx={2} style={{ fill: s.color }} />
            <text x={116} y={s.y + s.h / 2 + 3} textAnchor="end" fontSize={9.5} className="fill-mid font-mono">
              {s.label} {fmtTokens(s.v)}
            </text>
          </g>
        ))}
        {ribbons.map((r, i) => (
          <path key={i} d={r.path} style={{ fill: r.color }} opacity={0.28}>
            <title>{`${r.src} → ${fmtModel(r.model)}: ${fmtTokens(r.v)}`}</title>
          </path>
        ))}
        {modelNodes.map((mn) => (
          <g key={mn.m.model}>
            <rect x={330} y={mn.y} width={8} height={Math.max(mn.h, 1)} rx={2} style={{ fill: modelColor(mn.m.model) }} />
            <text x={344} y={mn.y + mn.h / 2 + 3} fontSize={9.5} className="fill-mid font-mono">
              {fmtModel(mn.m.model)} · {fmtTokens(mn.v)} in → {fmtTokens(mn.m.output)} out
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 font-mono text-[11px] text-dim">
        input-side composition per model — cache reads are billed at ~10% of fresh input, which is where the savings come from
      </div>
    </Card>
  );
}

function PrOutcomesCard() {
  const q = useQuery(prsQuery());
  const d = q.data;
  if (!d || d.rows.length === 0) return null;
  return (
    <Card
      title="pull requests · 30d"
      action={<span className="font-mono text-[11px] text-dim">{d.merged}/{d.opened} merged{d.open ? ` · ${d.open} open` : ''}</span>}
      bodyClassName="p-0"
    >
      <div className="max-h-48 overflow-y-auto">
        {d.rows.slice(0, 14).map((r) => (
          <div key={r.url} className="flex items-center gap-2 border-b border-line/60 px-4 py-1.5 last:border-0">
            <span className={cn(
              'shrink-0 rounded-sm px-1 font-mono text-[10px] uppercase tracking-wider',
              r.state === 'MERGED' ? 'bg-ok/15 text-ok' : r.state === 'OPEN' ? 'bg-claude/15 text-claude' : r.state ? 'bg-danger/15 text-danger' : 'bg-raise text-dim'
            )}>
              {r.state?.toLowerCase() ?? '…'}
            </span>
            <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs text-ink hover:text-claude">
              {r.repo ? `${r.repo}#${r.number}` : `#${r.number}`} {r.title ?? ''}
            </a>
            {r.additions != null && (
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-ok">+{r.additions}</span> <span className="text-danger">−{r.deletions}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* claude.ai chat usage — imported from account data exports, deliberately
 * separate from Claude Code stats (exports carry no tokens/cost). */
function ClaudeAiCard() {
  const q = useQuery(claudeAiQuery());
  const d = q.data;
  if (!d || d.chats === 0) return null;
  const max = Math.max(...d.days.map((x) => x.messages), 1);
  return (
    <Card
      title="claude.ai chats · imported"
      action={<span className="font-mono text-[11px] text-dim">{fmtCount(d.chats)} chats · {fmtCount(d.messages)} messages</span>}
      bodyClassName="p-4"
    >
      <div className="flex h-16 items-end gap-[2px]">
        {d.days.map((x) => (
          <div
            key={x.date}
            className="min-w-0 flex-1 rounded-t-[2px] bg-[var(--chart-subagent)]"
            style={{ height: `${Math.max((x.messages / max) * 100, 4)}%`, opacity: 0.75 }}
            title={`${fmtDay(x.date)} — ${x.chats} chat${x.chats === 1 ? '' : 's'}, ${x.messages} messages`}
          />
        ))}
        {d.days.length === 0 && <span className="text-xs text-dim">no chats in the last 30 days</span>}
      </div>
      <div className="mt-2 font-mono text-[11px] text-dim">
        from your claude.ai data export — refresh anytime with scripts/import-claudeai.mjs. Coding cloud sessions are not part of claude.ai exports.
      </div>
    </Card>
  );
}

/* API/tool failure feed — explains "why was today slow" and flags flaky tools.
 * Populated live going forward (and for all history after a reingest). */
function ErrorFeedCard() {
  const q = useQuery(errorFeedQuery());
  const d = q.data;
  if (!d || (d.apiErrors === 0 && d.toolErrors === 0)) return null;
  return (
    <Card
      title="errors & retries · 30d"
      action={
        <span className="font-mono text-[11px] text-dim">
          {d.apiErrors > 0 && <span className="text-danger">{d.apiErrors} api</span>}
          {d.apiErrors > 0 && d.toolErrors > 0 && ' · '}
          {d.toolErrors > 0 && `${d.toolErrors} tool`}
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="max-h-48 overflow-y-auto">
        {d.recent.map((r) => (
          <Link
            key={r.id}
            to={r.sessionId ? `/sessions/${r.sessionId}` : '#'}
            className="flex items-baseline gap-2 border-b border-line/60 px-4 py-1.5 last:border-0 hover:bg-surface2/60"
          >
            <span className={cn('shrink-0 rounded-sm px-1 font-mono text-[10px] uppercase tracking-wider', r.kind === 'api' ? 'bg-danger/15 text-danger' : 'bg-user/15 text-user')}>
              {r.kind}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mid">{r.snippet ?? 'error'}</span>
            <span className="shrink-0 font-mono text-[10px] text-dim">{r.project ?? ''}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/* GitHub-style 52-week heatmap; legacy days hatched (counts only). Cell colors
 * come from lib/colors.ts so this view can never drift from the month view. */
function cellColor(d: HeatDay): string {
  return d.legacy ? legacyCellColor(d.messages ?? 0) : claudeCellColor(d.claudeMs);
}

function YearHeatmap({ days }: { days: HeatDay[] }) {
  const { hostRef, show, hide, tipEl } = useChartTip();
  const weeks = useMemo(() => {
    const out: HeatDay[][] = [];
    let week: HeatDay[] = [];
    for (const d of days) {
      const dow = (new Date(d.date + 'T00:00').getDay() + 6) % 7;
      if (dow === 0 && week.length) {
        out.push(week);
        week = [];
      }
      week.push(d);
    }
    if (week.length) out.push(week);
    return out;
  }, [days]);

  return (
    <div ref={hostRef} className="relative">
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 15 }}>
        {weeks.map((week, wi) => {
          const firstOfMonth = week.find((d) => d.date.endsWith('-01'));
          return (
            <div key={wi} className="flex flex-col gap-[3px]">
              <div className="h-3 font-mono text-[8px] leading-3 text-dim">
                {firstOfMonth
                  ? new Date(firstOfMonth.date + 'T00:00').toLocaleDateString('en-US', { month: 'short' })
                  : ' '}
              </div>
              {week.map((d) => (
                <Link
                  key={d.date}
                  to={`/timeline/day?date=${d.date}`}
                  className={cn('h-3 w-3 rounded-[2px] border border-line/70 hover:border-claude')}
                  style={{
                    background: d.legacy ? undefined : cellColor(d),
                    backgroundImage: d.legacy ? LEGACY_HATCH : undefined,
                  }}
                  onPointerEnter={(e) =>
                    show(
                      e,
                      <>
                        <div className="text-ink">{fmtDay(d.date)}</div>
                        <div className="text-mid">
                          {d.legacy
                            ? `legacy: ${fmtCount(d.messages ?? 0)} messages`
                            : `${fmtDuration(d.claudeMs)} claude · ${plural(d.prompts, 'prompt')}`}
                        </div>
                      </>,
                    )
                  }
                  onPointerLeave={hide}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">
        less
        {CLAUDE_ALPHAS.map((a) => (
          <span key={a} className="h-2.5 w-2.5 rounded-[2px] border border-line" style={{ background: `rgba(var(--claude-rgb),${a})` }} />
        ))}
        more
        <span className="ml-3 h-2.5 w-2.5 rounded-[2px] border border-line" style={{ backgroundImage: LEGACY_HATCH }} />
        pre-transcript era (counts only)
        </div>
      </div>
      {tipEl}
    </div>
  );
}

function HourHistogram({ rows }: { rows: { hour: number; prompts: number; claudeMs: number }[] }) {
  const { hostRef, show, hide, tipEl } = useChartTip();
  const max = Math.max(...rows.map((r) => r.claudeMs), 1);
  const W = 480;
  const H = 100;
  const bw = W / 24 - 3;
  return (
    <div ref={hostRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full">
        {rows.map((r) => {
          const h = Math.max((r.claudeMs / max) * H, r.claudeMs > 0 ? 2 : 0.75);
          const x = r.hour * (bw + 3);
          return (
            <g key={r.hour}>
              <rect
                x={x} y={H - h} width={bw} height={h} rx={2} style={{ fill: CLAUDE_COLOR }} opacity={0.8}
                onPointerEnter={(e) =>
                  show(
                    e,
                    <>
                      <div className="text-ink">
                        {String(r.hour).padStart(2, '0')}:00–{String((r.hour + 1) % 24).padStart(2, '0')}:00
                      </div>
                      <div className="text-mid">{fmtDuration(r.claudeMs)} claude · {plural(r.prompts, 'prompt')}</div>
                    </>,
                  )
                }
                onPointerLeave={hide}
              />
              {r.hour % 6 === 0 && (
                <text x={x} y={H + 12} fontSize={8.5} className="fill-dim font-mono">
                  {String(r.hour).padStart(2, '0')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tipEl}
    </div>
  );
}

/* Weekly est. cost — Monday-start weeks bucketed via weekOf(). Amber = est.
 * cost, matching the rest of the app. */
function CostWeeks({ rows }: { rows: DayStat[] }) {
  const { hostRef, show, hide, tipEl } = useChartTip();
  const currentMonday = weekOf(todayKey())[0];
  const weeks = useMemo(() => {
    const starts = Array.from({ length: 12 }, (_, i) => addDays(currentMonday, -7 * (11 - i)));
    const byMonday = new Map(starts.map((s) => [s, { start: s, estCostUsd: 0, claudeMs: 0 }]));
    for (const r of rows) {
      const bucket = byMonday.get(weekOf(r.date)[0]);
      if (bucket) {
        bucket.estCostUsd += r.estCostUsd;
        bucket.claudeMs += r.claudeMs;
      }
    }
    return starts.map((s) => byMonday.get(s)!);
  }, [rows, currentMonday]);

  const max = Math.max(...weeks.map((w) => w.estCostUsd), 1);
  const W = 480;
  const H = 100;
  const bw = W / 12 - 2;
  return (
    <div ref={hostRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full">
        {weeks.map((w, i) => {
          const h = Math.max((w.estCostUsd / max) * H, w.estCostUsd > 0 ? 2 : 0.75);
          const x = i * (bw + 2);
          const firstOfMonth = Array.from({ length: 7 }, (_, j) => addDays(w.start, j)).find((d) => d.endsWith('-01'));
          return (
            <g key={w.start}>
              <rect
                x={x} y={H - h} width={bw} height={h} rx={2} style={{ fill: USER_COLOR }}
                opacity={w.start === currentMonday ? 1 : 0.6}
                onPointerEnter={(e) =>
                  show(
                    e,
                    <>
                      <div className="text-ink">{fmtDay(w.start)} – {fmtDay(addDays(w.start, 6))}</div>
                      <div className="text-mid">
                        <span className="text-user">{fmtCost(w.estCostUsd)}</span> · {fmtDuration(w.claudeMs)} claude
                      </div>
                    </>,
                  )
                }
                onPointerLeave={hide}
              />
              {firstOfMonth && (
                <text x={x} y={H + 12} fontSize={8.5} className="fill-dim font-mono">
                  {new Date(firstOfMonth + 'T00:00').toLocaleDateString('en-US', { month: 'short' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tipEl}
    </div>
  );
}
