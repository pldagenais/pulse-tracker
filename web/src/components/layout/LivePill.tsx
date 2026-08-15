import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Cloud, Square } from 'lucide-react';
import { useLive, useNow } from '../../lib/live';
import { api } from '../../lib/api';
import { fmtElapsed } from '../../lib/format';
import { cn } from '../../lib/cn';
import type { LiveSession } from '../../lib/types';

export function LivePill() {
  const { connection, sessions, ingest } = useLive();
  const now = useNow(1000);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const needsYou = sessions.filter((s) => s.status === 'needs-you');
  const working = sessions.filter((s) => s.status === 'working');
  const cloudWorking = working.filter((s) => s.cloud).length;
  const rest = sessions.filter((s) => s.status !== 'working' && s.status !== 'needs-you');

  const indexing = ingest && (ingest.phase === 'backfill' || ingest.phase === 'rescan') && ingest.filesTotal > 0;
  const pct = indexing ? Math.round((ingest.filesDone / Math.max(ingest.filesTotal, 1)) * 100) : 0;

  let dot = 'bg-dim';
  let label: string;
  let showCloud = false;
  let tone: 'attention' | 'working' | 'quiet' = 'quiet';
  if (connection === 'stale') {
    // cloud only: the mirror answers but the PC feeding it stopped reporting
    dot = 'bg-dim';
    label = 'PC offline';
  } else if (connection !== 'live') {
    dot = 'bg-user';
    label = 'reconnecting…';
  } else if (indexing) {
    dot = 'bg-claude pulse-dot';
    label = `indexing ${pct}%`;
    tone = 'working';
  } else if (needsYou.length > 0) {
    dot = 'bg-user pulse-dot';
    tone = 'attention';
    label = needsYou.length === 1
      ? `needs you · ${needsYou[0].projectName ?? '?'}`
      : `${needsYou.length} sessions need you`;
  } else if (working.length === 1) {
    dot = 'bg-claude pulse-dot';
    tone = 'working';
    const w = working[0];
    showCloud = w.cloud;
    label = `${w.stalled ? 'stalled? · ' : 'working · '}${w.projectName ?? '?'} · ${fmtElapsed(now - w.since)}`;
  } else if (working.length > 1) {
    dot = 'bg-claude pulse-dot';
    tone = 'working';
    showCloud = cloudWorking > 0;
    label = `${working.length} working${cloudWorking ? ` · ${cloudWorking} cloud` : ''}`;
  } else if (sessions.length > 0) {
    dot = 'bg-ok';
    label = `${sessions.length} open · idle`;
  } else {
    label = 'idle';
  }

  return (
    <div className="relative">
      {/* announce state changes; the visible pill re-renders every second for
          the elapsed timer, so the live region carries a seconds-free string
          or SRs would announce a countdown */}
      <span role="status" aria-live="polite" className="sr-only">
        {label.replace(/ · \d+[hms].*$/, '')}
      </span>
      <button
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          'flex items-center gap-2 rounded-full border border-line bg-surface2 px-3 py-1.5 font-mono text-[12px] tracking-wide',
          tone === 'attention' ? 'border-user/50 text-user' : tone === 'working' ? 'border-claude/30 text-claude' : 'text-mid'
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {showCloud && <Cloud size={11} className="text-claude/80" aria-label="includes cloud sessions" />}
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass-strong absolute right-0 z-50 mt-2 w-96 rounded-xl p-2">
            <div className="microlabel px-2 py-1">live sessions</div>
            {sessions.length === 0 && <div className="px-2 py-3 text-xs text-dim">No Claude Code sessions detected.</div>}
            {[...needsYou, ...working, ...rest].map((s) => (
              <SessionRow key={s.sessionId} s={s} now={now} onOpen={() => { setOpen(false); navigate(`/sessions/${s.sessionId}`); }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SessionRow({ s, now, onOpen }: { s: LiveSession; now: number; onOpen: () => void }) {
  const [killing, setKilling] = useState(false);
  const killable = !s.cloud && (s.status === 'working' || s.status === 'needs-you');

  const kill = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Interrupt this session?\n\n${s.projectName ?? s.sessionId}\nThe claude process is terminated immediately — unsaved terminal state is lost.`)) return;
    setKilling(true);
    try {
      await api.post(`/api/sessions/${s.sessionId}/kill`, {});
    } catch (err) {
      window.alert(`Kill failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setKilling(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex w-full cursor-pointer items-start gap-2.5 rounded px-2 py-2 text-left hover:bg-raise"
    >
      <span
        className={cn(
          'mt-1 h-2 w-2 shrink-0 rounded-full',
          s.status === 'needs-you' ? 'bg-user pulse-dot' : s.status === 'working' ? 'bg-claude pulse-dot' : s.status === 'idle' ? 'bg-ok' : 'bg-dim'
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-xs text-ink">
          {s.cloud && <Cloud size={11} className="shrink-0 text-claude/70" aria-label="cloud session" />}
          {s.projectName ?? '?'}
          {s.title ? <span className="truncate text-dim"> — {s.title}</span> : null}
        </span>
        <span className={cn('block truncate font-mono text-[11px]', s.status === 'needs-you' ? 'text-user' : 'text-dim')}>
          {s.status === 'needs-you'
            ? (s.notification ?? 'waiting for your input')
            : s.status === 'working'
              ? `${s.stalled ? 'stalled? ' : 'working '}${fmtElapsed(now - s.since)}`
              : s.status}
          {s.status !== 'needs-you' && s.lastPrompt ? ` · ${s.lastPrompt}` : ''}
        </span>
      </span>
      {killable && (
        <button
          onClick={kill}
          disabled={killing}
          aria-label="Interrupt session"
          title="Interrupt (kill) this session"
          className="mt-0.5 shrink-0 rounded border border-line p-1 text-dim opacity-40 transition-opacity hover:border-danger/50 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
        >
          <Square size={9} fill="currentColor" />
        </button>
      )}
    </div>
  );
}
