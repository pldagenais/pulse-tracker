// Bell drawer: alert history from the rules engine (thresholds set on the
// Status page), with per-alert and bulk acknowledge.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { alertsQuery } from '../../lib/queries';
import { api } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

export function AlertBell() {
  const q = useQuery(alertsQuery());
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const unacked = q.data?.unacked ?? 0;

  const ack = async (ids?: number[]) => {
    await api.post('/api/alerts/ack', ids ? { ids } : { all: true });
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unacked ? `Alerts — ${unacked} new` : 'Alerts'}
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface2',
          unacked ? 'text-user' : 'text-dim hover:text-mid'
        )}
      >
        <Bell size={13} />
        {unacked > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-user px-1 font-mono text-[10px] font-bold text-bg">
            {unacked > 9 ? '9+' : unacked}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass-strong absolute right-0 z-50 mt-2 w-[380px] rounded-xl p-2">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="microlabel">alerts</span>
              {unacked > 0 && (
                <button onClick={() => ack()} className="font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude">
                  ack all
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {(q.data?.alerts ?? []).map((a) => (
                <div key={a.id} className={cn('flex items-start gap-2 rounded px-2 py-2', !a.acked && 'bg-user/5')}>
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', a.acked ? 'bg-dim/40' : 'bg-user')} />
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-xs leading-4', a.acked ? 'text-dim' : 'text-ink')}>{a.message}</div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-dim">
                      {a.rule.split(':')[0]} · {fmtRelative(a.ts)}
                    </div>
                  </div>
                  {!a.acked && (
                    <button onClick={() => ack([a.id])} aria-label="Acknowledge" className="shrink-0 rounded border border-line p-1 text-dim hover:text-ok">
                      <Check size={10} />
                    </button>
                  )}
                </div>
              ))}
              {(q.data?.alerts.length ?? 0) === 0 && (
                <div className="px-2 py-4 text-center text-xs text-dim">
                  No alerts yet. Set cost thresholds on the Status page — budget, daily and per-session limits, parse-failure spikes, and failed jobs all land here.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
