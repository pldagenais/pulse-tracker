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
import { useT } from '../lib/i18n';

const TARGETS = [
  { key: 'code', icon: Code2, labelKey: 'actions.openCode' },
  { key: 'terminal', icon: SquareTerminal, labelKey: 'actions.openTerminal' },
  { key: 'explorer', icon: Folder, labelKey: 'actions.openExplorer' },
] as const;

export function OpenInButtons({ projectId, size = 13, className }: { projectId: number; size?: number; className?: string }) {
  const { t } = useT();
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
      {TARGETS.map((tgt) => (
        <button
          key={tgt.key}
          onClick={(e) => open(e, tgt.key)}
          aria-label={t(tgt.labelKey)}
          title={err ?? t(tgt.labelKey)}
          className="rounded border border-transparent p-1 text-dim hover:border-line hover:bg-surface2 hover:text-ink"
        >
          <tgt.icon size={size} strokeWidth={1.8} />
        </button>
      ))}
    </span>
  );
}

export function ResumeButton({ sessionId, className }: { sessionId: string; className?: string }) {
  const { t } = useT();
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
        title={t('actions.resumeTitle')}
        className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-50"
      >
        <Play size={11} />
        {state === 'done' ? t('actions.terminalOpened') : state === 'busy' ? t('actions.opening') : t('actions.resume')}
      </button>
      {err && <span className="font-mono text-[11px] text-danger">{err}</span>}
    </span>
  );
}

/** "Continue headless" — one follow-up turn on a finished session via --resume. */
export function ContinueBox({ sessionId }: { sessionId: string }) {
  const { t } = useT();
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
      <div className="microlabel mb-2">{t('actions.continueTitle')}</div>
      <div className="flex items-start gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder={t('actions.continuePlaceholder')}
          className="min-w-0 flex-1 resize-y rounded-md border border-line bg-surface2 px-3 py-2 font-mono text-xs leading-5 text-ink outline-none placeholder:text-dim focus:border-claude/50"
        />
        <button
          onClick={run}
          disabled={state === 'busy' || !prompt.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          <Rocket size={11} /> {state === 'busy' ? t('actions.launching') : t('actions.run')}
        </button>
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-dim">
        {t('actions.continueNote')}{' '}
        <Link to="/run" className="text-mid hover:text-claude">{t('actions.runPage')}</Link>.
        {state === 'done' && <span className="ml-2 text-ok">{t('actions.launched')}</span>}
        {err && <span className="ml-2 text-danger">{err}</span>}
      </div>
    </div>
  );
}

/** Pinned/project-bound templates as one-click launchers on the project page. */
export function QuickActions({ projectId }: { projectId: number }) {
  const { t } = useT();
  const q = useQuery(templatesQuery());
  const actions = (q.data ?? []).filter((tpl) => tpl.projectId === projectId || (tpl.pinned && tpl.projectId == null));
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="microlabel flex items-center gap-1"><Zap size={10} /> {t('actions.quickActions')}</span>
      {actions.map((tpl) => (
        <Link
          key={tpl.id}
          to={`/run?template=${tpl.id}&project=${projectId}`}
          className="rounded-full border border-line bg-surface2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:border-claude/40 hover:text-claude"
        >
          {tpl.name}
        </Link>
      ))}
    </div>
  );
}
