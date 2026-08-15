// "Why was this day expensive?" — modal decomposing a day's est. cost into
// sessions, model mix, and cache economics (GET /api/cost-explain).
import { useQuery, queryOptions } from '@tanstack/react-query';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtCost, fmtDay, fmtTokens, plural } from '../lib/format';
import { modelColor } from '../lib/colors';
import { Skeleton } from './ui';

interface CostExplainData {
  date: string;
  totalUsd: number;
  medianUsd: number;
  findings: string[];
  sessions: { sessionId: string; title: string; project: string; costUsd: number; outputTokens: number; turns: number; subagents: number }[];
  models: { model: string; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; calls: number }[];
}

const costExplainQuery = (date: string) =>
  queryOptions({
    queryKey: ['cost-explain', date],
    queryFn: () => api.get<CostExplainData>(`/api/cost-explain${qs({ date })}`),
    staleTime: 60_000,
  });

export function CostExplainModal({ date, onClose }: { date: string; onClose: () => void }) {
  const q = useQuery(costExplainQuery(date));
  const d = q.data;
  const maxCost = Math.max(...(d?.sessions.map((s) => s.costUsd) ?? [1]), 0.01);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="Cost breakdown">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="glass-strong drawer-in absolute left-1/2 top-16 max-h-[80vh] w-[640px] max-w-[94vw] -translate-x-1/2 overflow-y-auto rounded-xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="microlabel">why was this day expensive?</div>
            <div className="mt-0.5 font-display text-lg font-medium text-ink">
              {fmtDay(date)} — {d ? fmtCost(d.totalUsd) : '…'}
              {d && d.medianUsd > 0 && <span className="ml-2 font-mono text-[12px] text-dim">14-day median {fmtCost(d.medianUsd)}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-dim hover:text-ink"><X size={15} /></button>
        </div>

        {!d && <Skeleton className="mt-4 h-40" />}

        {d && (
          <>
            {d.findings.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {d.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-[14px] leading-5 text-ink/90">
                    <span aria-hidden className="text-user">▸</span>{f}
                  </li>
                ))}
              </ul>
            )}

            <div className="microlabel mt-4 mb-1.5">sessions by cost</div>
            <div className="space-y-1">
              {d.sessions.map((s) => (
                <Link
                  key={s.sessionId}
                  to={`/sessions/${s.sessionId}`}
                  onClick={onClose}
                  className="block rounded border border-line/60 px-3 py-1.5 hover:bg-surface2/60"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.title}</span>
                    <span className="shrink-0 font-mono text-[12px] text-user">{fmtCost(s.costUsd)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-raise">
                    <div className="h-full rounded-full bg-user/70" style={{ width: `${Math.max((s.costUsd / maxCost) * 100, 1.5)}%` }} />
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-dim">
                    {s.project} · {plural(s.turns, 'turn')} · {fmtTokens(s.outputTokens)} out{s.subagents ? ` · ${plural(s.subagents, 'subagent')}` : ''}
                  </div>
                </Link>
              ))}
              {d.sessions.length === 0 && <div className="text-xs text-dim">No recorded turns this day.</div>}
            </div>

            {d.models.length > 0 && (
              <>
                <div className="microlabel mt-4 mb-1.5">model mix & cache economics</div>
                <table className="w-full font-mono text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-dim">
                      <th className="py-1 font-normal">model</th>
                      <th className="py-1 text-right font-normal">out</th>
                      <th className="py-1 text-right font-normal">cache read</th>
                      <th className="py-1 text-right font-normal">cache write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.models.map((m) => (
                      <tr key={m.model} className="border-t border-line/60">
                        <td className="flex items-center gap-1.5 py-1 text-ink">
                          <span className="h-2 w-2 rounded-sm" style={{ background: modelColor(m.model) }} />
                          {m.model.replace('claude-', '')}
                        </td>
                        <td className="py-1 text-right text-ink">{fmtTokens(m.outputTokens)}</td>
                        <td className="py-1 text-right text-mid">{fmtTokens(m.cacheReadTokens)}</td>
                        <td className="py-1 text-right text-mid">{fmtTokens(m.cacheWriteTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
