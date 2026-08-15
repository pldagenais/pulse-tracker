// Desktop hand-off buttons: open a project in VS Code / Terminal / Explorer,
// resume a past session in a real terminal, continue one headless. Server
// validates every path against the DB — these only ever act on known
// Claude Code checkouts.
import { useState } from 'react';
import { Link } from 'react-router';
import { Code2, Folder, SquareTerminal, Play, Rocket, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { templatesQuery } from '../lib/queries';
import { cn } from '../lib/cn';

const TARGETS = [
  { key: 'code', icon: Code2, label: 'Open in VS Code' },
  { key: 'terminal', icon: SquareTerminal, label: 'Open in Windows Terminal' },
  { key: 'explorer', icon: Folder, label: 'Show in Explorer' },
] as const;

export function OpenInButtons({ projectId, size = 13, className }: { projectId: number; size?: number; className?: string }) {
  const [err, setErr] = useState<string | null>(null);
  const open = async (e: React.MouseEvent, target: string) => {
    e.stopPropagation();
    e.preventDefault();
    setErr(null);
    try {
      await api.post(`/api/projects/${projectId}/open`, { target });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  };
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {TARGETS.map((t) => (
        <button
          key={t.key}
          onClick={(e) => open(e, t.key)}
          aria-label={t.label}
          title={err ?? t.label}
          className="rounded border border-transparent p-1 text-dim hover:border-line hover:bg-surface2 hover:text-ink"
        >
          <t.icon size={size} strokeWidth={1.8} />
        </button>
      ))}
    </span>
  );
}

export function ResumeButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const resume = async () => {
    setState('busy');
    setErr(null);
    try {
      await api.post(`/api/sessions/${sessionId}/resume`, {});
      setState('done');
      setTimeout(() => setState('idle'), 4000);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setState('idle');
    }
  };
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <button
        onClick={resume}
        disabled={state === 'busy'}
        title="Reopen this session in Windows Terminal (claude --resume)"
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-50"
      >
        <Play size={11} />
        {state === 'done' ? 'terminal opened' : state === 'busy' ? 'opening…' : 'resume in terminal'}
      </button>
      {err && <span className="font-mono text-[11px] text-danger">{err}</span>}
    </span>
  );
}

/** "Continue headless" — one follow-up turn on a finished session via --resume. */
export function ContinueBox({ sessionId }: { sessionId: string }) {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setState('busy');
    setErr(null);
    try {
      await api.post(`/api/sessions/${sessionId}/continue`, { prompt });
      setState('done');
      setPrompt('');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setState('idle');
    }
  };

  return (
    <div className="rounded-md border border-line bg-surface p-3.5">
      <div className="microlabel mb-2">continue this session headless</div>
      <div className="flex items-start gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Follow-up with full context of this conversation — e.g. “now add tests for the fix”"
          className="min-w-0 flex-1 resize-y rounded-md border border-line bg-surface2 px-3 py-2 font-mono text-xs leading-5 text-ink outline-none placeholder:text-dim focus:border-claude/50"
        />
        <button
          onClick={run}
          disabled={state === 'busy' || !prompt.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          <Rocket size={11} /> {state === 'busy' ? 'launching…' : 'run'}
        </button>
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-dim">
        Runs read-only (`claude -p --resume`) — the continuation ingests as a new session; watch it on the{' '}
        <Link to="/run" className="text-mid hover:text-claude">Run page</Link>.
        {state === 'done' && <span className="ml-2 text-ok">launched ✓</span>}
        {err && <span className="ml-2 text-danger">{err}</span>}
      </div>
    </div>
  );
}

/** Pinned/project-bound templates as one-click launchers on the project page. */
export function QuickActions({ projectId }: { projectId: number }) {
  const q = useQuery(templatesQuery());
  const actions = (q.data ?? []).filter((t) => t.projectId === projectId || (t.pinned && t.projectId == null));
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="microlabel flex items-center gap-1"><Zap size={10} /> quick actions</span>
      {actions.map((t) => (
        <Link
          key={t.id}
          to={`/run?template=${t.id}&project=${projectId}`}
          className="rounded-full border border-line bg-surface2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:border-claude/40 hover:text-claude"
        >
          {t.name}
        </Link>
      ))}
    </div>
  );
}
