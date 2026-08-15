import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Bot, Square, AlertTriangle, Gauge } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { usageWindowQuery } from '../lib/queries';
import { api } from '../lib/api';
import type { LiveSession } from '../lib/types';
import { fmtCost, fmtDuration, fmtElapsed, fmtModel, fmtRelative, plural } from '../lib/format';
import { EmptyState, ProgressBar, StatCard } from '../components/ui';
import { cn } from '../lib/cn';

export default function MissionPage() {
  const { sessions } = useLive();
  const now = useNow(1000);
  const usage = useQuery(usageWindowQuery());

  const prio = (s: LiveSession) => (s.status === 'needs-you' ? 0 : s.status === 'working' ? 1 : 2);
  const sorted = [...sessions].sort((a, b) => prio(a) - prio(b) || b.since - a.since);
  const u = usage.data;
  const pct5h = u?.ceiling5hUsd ? Math.min((u.window5h.estCostUsd / u.ceiling5hUsd) * 100, 100) : null;

  return (
    <div className="fade-up w-full space-y-4 p-5">
      {/* rate-window strip — StatCard, same as every other KPI in the app:
          the page about live pressure had its headline numbers at ~65% the
          size of everyone else's, under labels louder than the values */}
      {u && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <StatCard
            label="trailing 5h window"
            accent="user"
            value={fmtCost(u.window5h.estCostUsd)}
            topRight={
              pct5h != null ? (
                <span className={cn('flex items-center gap-1 font-mono text-[11px]', pct5h > 85 ? 'text-danger' : pct5h > 60 ? 'text-user' : 'text-dim')}>
                  <Gauge size={11} aria-hidden /> {Math.round(pct5h)}% of your estimate
                </span>
              ) : (
                <Gauge size={11} className="text-dim" aria-hidden />
              )
            }
            sub={
              <span className="flex flex-col gap-1.5">
                <span>{plural(u.window5h.prompts, 'prompt')} · {plural(u.window5h.turns, 'turn')}</span>
                {pct5h != null && <ProgressBar value={u.window5h.estCostUsd} max={u.ceiling5hUsd!} />}
                <span className="font-mono text-[11px]">
                  {u.easesAt && u.easesAt > now ? `pressure eases ${fmtRelative(u.easesAt)}` : 'window is quiet'}
                  {u.ceiling5hUsd == null && ' · set a 5h estimate in Status to see a fill bar'}
                </span>
              </span>
            }
          />
          <StatCard
            label="trailing 7 days"
            accent="user"
            value={fmtCost(u.window7d.estCostUsd)}
            sub={
              <span className="flex flex-col gap-0.5">
                <span>{plural(u.window7d.prompts, 'prompt')}</span>
                <span className="font-mono text-[11px]">est. API-equivalent consumed this week</span>
              </span>
            }
          />
          <StatCard
            label="fleet"
            accent="claude"
            value={`${sessions.filter((s) => s.status === 'working').length} working`}
            sub={
              <span className="flex flex-col gap-0.5">
                <span>
                  {sessions.filter((s) => s.status === 'needs-you').length > 0 && `${sessions.filter((s) => s.status === 'needs-you').length} need you · `}
                  {sessions.filter((s) => s.cloud).length} cloud · {sessions.reduce((t, s) => t + s.agentsActive, 0)} subagents
                </span>
                <span className="font-mono text-[11px]">
                  {u.burnTokPerMin > 0
                    ? <>burn <span className="text-claude">{u.burnTokPerMin.toLocaleString()} tok/min</span> (15m avg)</>
                    : 'no token burn in the last 15 minutes'}
                </span>
              </span>
            }
          />
        </div>
      )}

      {sorted.length === 0 && (
        <EmptyState title="No live sessions" hint="Sessions appear the moment a hook fires or a transcript grows — start one in a terminal or from the Run page." />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {sorted.map((s) => <Tile key={s.sessionId} s={s} now={now} />)}
      </div>
    </div>
  );
}

function Tile({ s, now }: { s: LiveSession; now: number }) {
  const navigate = useNavigate();
  const attention = s.status === 'needs-you';
  const kill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Interrupt ${s.projectName ?? s.sessionId}?`)) return;
    try {
      await api.post(`/api/sessions/${s.sessionId}/kill`, {});
    } catch (err) {
      window.alert(`Kill failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/sessions/${s.sessionId}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/sessions/${s.sessionId}`)}
      className={cn(
        'glass glass-hover group cursor-pointer rounded-xl p-4',
        attention ? '!border-user/60' : s.status === 'working' ? '!border-claude/40' : ''
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn(
          'h-2.5 w-2.5 shrink-0 rounded-full',
          attention ? 'bg-user pulse-dot' : s.status === 'working' ? 'bg-claude pulse-dot' : s.status === 'idle' ? 'bg-ok' : 'bg-dim'
        )} />
        <span className="truncate text-[14px] font-medium text-ink">{s.projectName ?? '?'}</span>
        {s.cloud && <Cloud size={12} className="shrink-0 text-claude/70" aria-label="cloud session" />}
        <span className="ml-auto shrink-0 font-mono text-[12px] text-dim">
          {s.status === 'working' || attention ? fmtElapsed(now - s.since) : s.status}
        </span>
        {!s.cloud && (s.status === 'working' || attention) && (
          <button
            onClick={kill}
            aria-label="Interrupt session"
            title="Interrupt (kill)"
            className="shrink-0 rounded border border-line p-1 text-dim opacity-40 transition-opacity hover:border-danger/50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Square size={9} fill="currentColor" />
          </button>
        )}
      </div>

      {attention && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-user/40 bg-user/10 px-2 py-1.5 font-mono text-[12px] text-user">
          <AlertTriangle size={11} className="shrink-0" />
          <span className="truncate">{s.notification ?? 'waiting for your input'}</span>
        </div>
      )}
      {s.stalled && !attention && (
        <div className="mt-2 rounded border border-user/30 bg-user/5 px-2 py-1 font-mono text-[11px] text-user">
          stalled? no transcript activity for 5+ min
        </div>
      )}

      <div className="mt-2 truncate text-xs text-mid">{s.title ?? s.lastPrompt ?? 'no prompt yet'}</div>

      {s.contextTokens != null && s.contextWindow != null && (
        <ContextGauge tokens={s.contextTokens} window={s.contextWindow} />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
        {s.claudeMs > 0 && <span className="text-claude">{fmtDuration(s.claudeMs)} worked</span>}
        {s.promptCount > 0 && <span>{plural(s.promptCount, 'prompt')}</span>}
        {s.estCostUsd != null && s.estCostUsd > 0 && <span className="text-user">{fmtCost(s.estCostUsd)}</span>}
        {s.agentsActive > 0 && (
          <span className="flex items-center gap-1 text-claude"><Bot size={10} /> {plural(s.agentsActive, 'subagent')}</span>
        )}
        {s.models.slice(0, 2).map((m) => <span key={m}>{fmtModel(m)}</span>)}
      </div>
    </div>
  );
}

/** Context-window pressure: last API call's input side vs the model's window. */
function ContextGauge({ tokens, window: win }: { tokens: number; window: number }) {
  const pct = Math.min((tokens / win) * 100, 100);
  const hot = pct > 75;
  return (
    <div className="mt-2" title={`~${tokens.toLocaleString()} of ${win.toLocaleString()} tokens (estimate — compaction resets it)`}>
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-dim">
        <span>context</span>
        <span className={cn(hot && 'text-user')}>{Math.round(pct)}%{hot && ' · compact soon'}</span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-raise">
        <div className={cn('h-full rounded-full', hot ? 'bg-user' : 'bg-claude/70')} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}
