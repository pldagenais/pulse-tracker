import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Bot, Square, AlertTriangle, Gauge } from 'lucide-react';
import { useLive, useNow } from '../lib/live';
import { usageWindowQuery } from '../lib/queries';
import { api } from '../lib/api';
import type { AccountUsageWindow, LiveSession } from '../lib/types';
import { fmtCost, fmtDuration, fmtElapsed, fmtModel, fmtRelative, plural } from '../lib/format';
import { EmptyState, ProgressBar, StatCard } from '../components/ui';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';

export default function MissionPage() {
  const { t, tf } = useT();
  const { sessions } = useLive();
  const now = useNow(1000);
  const usage = useQuery(usageWindowQuery());

  const prio = (s: LiveSession) => (s.status === 'needs-you' ? 0 : s.status === 'working' ? 1 : 2);
  const sorted = [...sessions].sort((a, b) => prio(a) - prio(b) || b.since - a.since);
  const u = usage.data;
  const pct5h = u?.ceiling5hUsd ? Math.min((u.window5h.estCostUsd / u.ceiling5hUsd) * 100, 100) : null;
  // Two subscriptions have two independent rolling quotas, so one combined
  // number overstates the pressure on each. Split only when there IS a split.
  const perAccount = (u?.byAccount ?? []).length > 1 ? u!.byAccount : null;

  return (
    <div className="fade-up w-full space-y-4 p-5">
      {/* rate-window strip — StatCard, same as every other KPI in the app:
          the page about live pressure had its headline numbers at ~65% the
          size of everyone else's, under labels louder than the values */}
      {u && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {perAccount
            ? perAccount.map((a) => <AccountWindowCard key={a.accountUuid} a={a} />)
            : <>
          <StatCard
            label={t('run.win5h')}
            accent="user"
            value={fmtCost(u.window5h.estCostUsd)}
            topRight={
              pct5h != null ? (
                <span className={cn('flex items-center gap-1 font-mono text-[11px]', pct5h > 85 ? 'text-danger' : pct5h > 60 ? 'text-user' : 'text-dim')}>
                  <Gauge size={11} aria-hidden /> {tf('run.pctOfEstimate', { pct: Math.round(pct5h) })}
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
                  {u.easesAt && u.easesAt > now ? tf('run.pressureEases', { when: fmtRelative(u.easesAt) }) : t('run.windowQuiet')}
                  {u.ceiling5hUsd == null && t('run.setEstimateHint')}
                </span>
              </span>
            }
          />
          <StatCard
            label={t('run.win7d')}
            accent="user"
            value={fmtCost(u.window7d.estCostUsd)}
            sub={
              <span className="flex flex-col gap-0.5">
                <span>{plural(u.window7d.prompts, 'prompt')}</span>
                <span className="font-mono text-[11px]">{t('run.apiEquiv')}</span>
              </span>
            }
          />
            </>}
          <StatCard
            label={t('run.fleet')}
            accent="claude"
            value={tf('run.nWorking', { n: sessions.filter((s) => s.status === 'working').length })}
            sub={
              <span className="flex flex-col gap-0.5">
                <span>
                  {sessions.filter((s) => s.status === 'needs-you').length > 0 && tf('run.nNeedYou', { n: sessions.filter((s) => s.status === 'needs-you').length })}
                  {tf('run.cloudSubagents', { cloud: sessions.filter((s) => s.cloud).length, agents: sessions.reduce((acc, s) => acc + s.agentsActive, 0) })}
                </span>
                <span className="font-mono text-[11px]">
                  {u.burnTokPerMin > 0
                    ? <>{t('run.burnPrefix')}<span className="text-claude">{u.burnTokPerMin.toLocaleString()} tok/min</span>{t('run.burnSuffix')}</>
                    : t('run.noBurn')}
                </span>
              </span>
            }
          />
        </div>
      )}

      {/* Say it plainly when the split does not add up to the whole. */}
      {u && perAccount && u.unattributedTurns7d > 0 && (
        <p className="font-mono text-[11px] text-dim">
          {tf('run.acctUnattributed', { n: u.unattributedTurns7d })} · {t('run.acctCliHint')}
        </p>
      )}

      {sorted.length === 0 && (
        <EmptyState title={t('run.noLiveTitle')} hint={t('run.noLiveHint')} />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {sorted.map((s) => <Tile key={s.sessionId} s={s} now={now} />)}
      </div>
    </div>
  );
}

/**
 * One subscription's rolling windows. The headline is still our cost estimate,
 * but the bars are the real quota percentages the desktop app records — the
 * only numbers that actually say how close this account is to its limit.
 */
function AccountWindowCard({ a }: { a: AccountUsageWindow }) {
  const { t, tf } = useT();
  const pu = a.planUsage;
  const fh = pu?.fivehourPct ?? null;
  const sd = pu?.sevendayPct ?? null;
  const worst = Math.max(fh ?? 0, sd ?? 0);

  return (
    <StatCard
      /* the account's own name is user data — never translated */
      label={a.name}
      accent="user"
      value={fmtCost(a.window5h.estCostUsd)}
      topRight={
        fh != null && sd != null ? (
          <span className={cn('flex items-center gap-1 font-mono text-[11px]', worst >= 90 ? 'text-danger' : worst >= 60 ? 'text-user' : 'text-dim')}>
            <Gauge size={11} aria-hidden /> {tf('run.acctPct', { fh, sd })}
          </span>
        ) : (
          <Gauge size={11} className="text-dim" aria-hidden />
        )
      }
      sub={
        <span className="flex flex-col gap-1.5">
          <span>{tf('run.acctSpend', { cost: fmtCost(a.window7d.estCostUsd), prompts: a.window5h.prompts, turns: a.window5h.turns })}</span>
          {fh != null && <QuotaBar label={t('run.acct5h')} pct={fh} />}
          {sd != null && <QuotaBar label={t('run.acct7d')} pct={sd} />}
          <span className="font-mono text-[11px]">
            {pu == null || pu.sampledAt == null
              ? t('run.acctNoMeter')
              : pu.stale
                ? tf('run.acctStale', { when: fmtRelative(pu.sampledAt) })
                : sd != null && sd >= 100
                  ? <span className="text-danger">{t('run.acctMaxed')}</span>
                  : null}
          </span>
        </span>
      }
    />
  );
}

/** Real quota consumption, 0-100 — not an estimate against a guessed ceiling. */
function QuotaBar({ label, pct }: { label: string; pct: number }) {
  const hot = pct >= 90;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-dim">
        <span>{label}</span>
        <span className={cn(hot && 'text-danger')}>{pct}%</span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-raise">
        <span
          className={cn('block h-full rounded-full', hot ? 'bg-danger' : pct >= 60 ? 'bg-user' : 'bg-claude/70')}
          style={{ width: `${Math.max(Math.min(pct, 100), 2)}%` }}
        />
      </span>
    </span>
  );
}

function Tile({ s, now }: { s: LiveSession; now: number }) {
  const { t, tf } = useT();
  const navigate = useNavigate();
  const attention = s.status === 'needs-you';
  const kill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(tf('run.confirmInterrupt', { name: s.projectName ?? s.sessionId }))) return;
    try {
      await api.post(`/api/sessions/${s.sessionId}/kill`, {});
    } catch (err) {
      window.alert(tf('run.killFailed', { msg: err instanceof Error ? err.message : String(err) }));
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
        {s.cloud && <Cloud size={12} className="shrink-0 text-claude/70" aria-label={t('run.cloudSessionAria')} />}
        <span className="ml-auto shrink-0 font-mono text-[12px] text-dim">
          {s.status === 'working' || attention ? fmtElapsed(now - s.since) : s.status}
        </span>
        {!s.cloud && (s.status === 'working' || attention) && (
          <button
            onClick={kill}
            aria-label={t('pill.interrupt')}
            title={t('run.interruptKillTitle')}
            className="shrink-0 rounded border border-line p-1 text-dim opacity-40 transition-opacity hover:border-danger/50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Square size={9} fill="currentColor" />
          </button>
        )}
      </div>

      {attention && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-user/40 bg-user/10 px-2 py-1.5 font-mono text-[12px] text-user">
          <AlertTriangle size={11} className="shrink-0" />
          <span className="truncate">{s.notification ?? t('run.waitingInput')}</span>
        </div>
      )}
      {s.stalled && !attention && (
        <div className="mt-2 rounded border border-user/30 bg-user/5 px-2 py-1 font-mono text-[11px] text-user">
          {t('run.stalledHint')}
        </div>
      )}

      <div className="mt-2 truncate text-xs text-mid">{s.title ?? s.lastPrompt ?? t('run.noPromptYet')}</div>

      {s.contextTokens != null && s.contextWindow != null && (
        <ContextGauge tokens={s.contextTokens} window={s.contextWindow} />
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-dim">
        {s.claudeMs > 0 && <span className="text-claude">{tf('run.workedSuffix', { dur: fmtDuration(s.claudeMs) })}</span>}
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
  const { t, tf } = useT();
  const pct = Math.min((tokens / win) * 100, 100);
  const hot = pct > 75;
  return (
    <div className="mt-2" title={tf('run.ctxTitle', { tokens: tokens.toLocaleString(), window: win.toLocaleString() })}>
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-dim">
        <span>{t('run.context')}</span>
        <span className={cn(hot && 'text-user')}>{Math.round(pct)}%{hot && t('run.compactSoon')}</span>
      </div>
      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-raise">
        <div className={cn('h-full rounded-full', hot ? 'bg-user' : 'bg-claude/70')} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
    </div>
  );
}
