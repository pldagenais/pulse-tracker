// Cloud Routines (claude.ai scheduled agents): list/status/run-now/toggle and
// a create form. Every operation shells out to a headless claude session on
// the server (20-60s) — the UI is explicit about that. No delete in the API;
// that stays on claude.ai/code/routines.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudCog, RefreshCw, Play, Plus, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { routinesQuery } from '../../lib/queries';
import type { CloudRoutine } from '../../lib/types';
import { fmtRelative } from '../../lib/format';
import { Card, Skeleton, Switch } from '../ui';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/cn';

export function RoutinesCard() {
  const { t, tf } = useT();
  const q = useQuery(routinesQuery());
  const queryClient = useQueryClient();
  const [showFired, setShowFired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['routines'] });

  const all = q.data?.routines ?? [];
  const fired = all.filter((r) => r.endedReason === 'run_once_fired');
  const active = all.filter((r) => r.endedReason !== 'run_once_fired');

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={`${t('run.routinesTitle')}${q.data ? tf('run.activeSuffix', { n: active.length }) : ''}`}
      action={
        <span className="flex items-center gap-2">
          <a href="https://claude.ai/code/routines" target="_blank" rel="noreferrer"
            className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-claude">
            claude.ai <ExternalLink size={9} />
          </a>
          <button
            onClick={() => act('refresh', () => api.get('/api/routines?refresh=1'))}
            disabled={busy != null}
            aria-label={t('run.refreshRoutinesAria')}
            title={t('run.refreshRoutinesTitle')}
            className="rounded border border-line p-1 text-dim hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={11} className={cn((q.isFetching || busy === 'refresh') && 'animate-spin')} />
          </button>
        </span>
      }
      bodyClassName="p-0"
    >
      {q.isLoading && (
        <div className="px-4 py-3">
          <div className="mb-2 font-mono text-[12px] text-dim">{t('run.routinesLoading')}</div>
          <Skeleton className="h-20" />
        </div>
      )}
      {q.isError && <div className="px-4 py-3 font-mono text-[12px] text-danger">{String((q.error as Error).message)}</div>}
      {err && <div className="px-4 py-2 font-mono text-[12px] text-danger">{err}</div>}

      {active.map((r) => (
        <RoutineRow key={r.id} r={r} busy={busy} onRun={() => act(r.id, () => api.post(`/api/routines/${r.id}/run`, {}))}
          onToggle={() => act(r.id, () => api.put(`/api/routines/${r.id}`, { enabled: !r.enabled }))} />
      ))}
      {q.data && active.length === 0 && (
        <div className="px-4 py-3 text-xs text-dim">{t('run.noActiveRoutines')}</div>
      )}

      {fired.length > 0 && (
        <button
          onClick={() => setShowFired((s) => !s)}
          className="w-full border-t border-line px-4 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-dim hover:text-mid"
        >
          {showFired ? '▾' : '▸'} {tf(fired.length === 1 ? 'run.firedOne' : 'run.firedMany', { n: fired.length })}
        </button>
      )}
      {showFired && fired.map((r) => (
        <RoutineRow key={r.id} r={r} busy={busy} onRun={() => act(r.id, () => api.post(`/api/routines/${r.id}/run`, {}))} onToggle={null} />
      ))}

      <CreateRoutine environments={q.data?.environments ?? []} onCreated={refresh} />
      <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
        {t('run.routinesFooter')}
      </div>
    </Card>
  );
}

function RoutineRow({ r, busy, onRun, onToggle }: { r: CloudRoutine; busy: string | null; onRun: () => void; onToggle: (() => void) | null }) {
  const { t, tf } = useT();
  const schedule = r.cron
    ? tf('run.cronUtc', { cron: r.cron })
    : r.endedReason === 'run_once_fired'
      ? tf('run.ranWhen', { when: r.lastFiredAt ? fmtRelative(r.lastFiredAt) : '' })
      : r.runOnceAt
        ? tf('run.onceAt', { ts: r.runOnceAt.slice(0, 16) })
        : '—';
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
      {onToggle ? (
        <Switch checked={r.enabled} onChange={onToggle} disabled={busy === r.id} aria-label={tf('run.toggleName', { name: r.name })} />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dim/40" />
      )}
      <div className="min-w-0 flex-1" title={r.prompt}>
        <div className="truncate text-xs text-ink">{r.name}</div>
        <div className="truncate font-mono text-[11px] text-dim">
          {schedule}
          {r.enabled && r.nextRunAt ? tf('run.nextSuffix', { when: fmtRelative(r.nextRunAt) }) : ''}
        </div>
      </div>
      <button
        onClick={onRun}
        disabled={busy === r.id}
        aria-label={tf('run.runNameNowAria', { name: r.name })}
        title={t('run.runNowHeadlessTitle')}
        className="shrink-0 rounded border border-line p-1 text-dim hover:text-claude disabled:opacity-50"
      >
        <Play size={11} />
      </button>
    </div>
  );
}

function CreateRoutine({ environments, onCreated }: { environments: { id: string; name: string }[]; onCreated: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [envId, setEnvId] = useState('');
  const [cron, setCron] = useState('0 12 * * *');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await api.post<{ id: string | null; url: string | null }>('/api/routines', {
        name: name.trim(),
        prompt: prompt.trim(),
        environmentId: envId,
        cron: cron.trim(),
      });
      setResult(r.url ?? 'created');
      setName('');
      setPrompt('');
      onCreated();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 border-t border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude"
      >
        <Plus size={11} /> {t('run.newRoutine')}
      </button>
    );
  }

  return (
    <div className="space-y-2 border-t border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <CloudCog size={13} className="text-dim" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('run.routineNamePlaceholder')}
          className="w-48 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none placeholder:text-dim" />
        <select value={envId} onChange={(e) => setEnvId(e.target.value)} aria-label={t('run.ariaEnvironment')}
          className="rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none">
          <option value="">{t('run.envOption')}</option>
          {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 font-mono text-[12px] text-dim">
          {t('run.cronUtcLabel')}
          <input value={cron} onChange={(e) => setCron(e.target.value)}
            className="w-28 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none" />
        </label>
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder={t('run.routinePromptPlaceholder')}
        className="w-full resize-y rounded-md border border-line bg-surface2 px-3 py-2 font-mono text-xs leading-5 text-ink outline-none placeholder:text-dim focus:border-claude/50"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={create}
          disabled={busy || !name.trim() || !prompt.trim() || !envId}
          className="rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          {busy ? t('run.creating') : t('run.createRoutine')}
        </button>
        <button onClick={() => setOpen(false)} className="font-mono text-[11px] uppercase tracking-wider text-dim hover:text-mid">{t('run.cancel')}</button>
        <span className="font-mono text-[11px] text-dim">{t('run.cronHint')}</span>
        {err && <span className="w-full font-mono text-[11px] text-danger">{err}</span>}
        {result && (
          <a href={result.startsWith('http') ? result : undefined} target="_blank" rel="noreferrer" className="w-full font-mono text-[11px] text-ok hover:underline">
            {t('run.createdCheck')} {result.startsWith('http') ? result : ''}
          </a>
        )}
      </div>
    </div>
  );
}
