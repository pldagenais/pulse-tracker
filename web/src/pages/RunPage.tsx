import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket, Square, Save, Trash2, Pin, ChevronRight, CalendarClock, Play } from 'lucide-react';
import { api } from '../lib/api';
import { jobsQuery, templatesQuery, projectsQuery, schedulesQuery } from '../lib/queries';
import type { Project, PromptTemplate, PulseJob, ScheduledJob } from '../lib/types';
import { fmtClock, fmtDuration, fmtRelative, plural } from '../lib/format';
import { Badge, Card, EmptyState } from '../components/ui';
import { cn } from '../lib/cn';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MODELS = [
  { value: '', label: 'default model' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 · fastest/cheapest' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
] as const;

const MODES = [
  { value: 'default', label: 'read-only (tools that need approval are denied)' },
  { value: 'acceptEdits', label: 'accept edits (can modify files in the project)' },
  { value: 'bypassPermissions', label: '⚠ bypass permissions (unrestricted)' },
] as const;

const VAR_RE = /\{\{(\w+)\}\}/g;

export default function RunPage() {
  const [params, setParams] = useSearchParams();
  const projects = useQuery(projectsQuery());
  const templates = useQuery(templatesQuery());
  const jobs = useQuery(jobsQuery());
  const queryClient = useQueryClient();

  const roots = useMemo(
    () => (projects.data ?? []).filter((p) => p.parentProjectId == null).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0)),
    [projects.data]
  );

  const [projectId, setProjectId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [maxTurns, setMaxTurns] = useState('15');
  const [mode, setMode] = useState('default');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [tplName, setTplName] = useState('');
  const [savingTpl, setSavingTpl] = useState(false);
  const [abModel, setAbModel] = useState('');
  const [abLink, setAbLink] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && roots.length) setProjectId(String(params.get('project') ?? roots[0].id));
  }, [roots, projectId, params]);

  // deep-link: /run?template=ID (quick actions navigate here pre-filled)
  useEffect(() => {
    const tid = params.get('template');
    if (tid && templates.data) {
      const t = templates.data.find((x) => x.id === Number(tid));
      if (t) {
        applyTemplate(t);
        setParams((p) => { const n = new URLSearchParams(p); n.delete('template'); return n; }, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data]);

  const applyTemplate = (t: PromptTemplate) => {
    setPrompt(t.body);
    if (t.projectId != null) setProjectId(String(t.projectId));
    setModel(t.model ?? '');
    if (t.maxTurns) setMaxTurns(String(t.maxTurns));
    if (t.permissionMode) setMode(t.permissionMode);
    setVars({});
  };

  const varNames = useMemo(() => [...new Set([...prompt.matchAll(VAR_RE)].map((m) => m[1]))], [prompt]);
  const filledPrompt = useMemo(
    () => prompt.replace(VAR_RE, (_, name) => vars[name]?.trim() || `{{${name}}}`),
    [prompt, vars]
  );
  const varsMissing = varNames.some((n) => !vars[n]?.trim());

  const launch = useMutation({
    mutationFn: async () => {
      setAbLink(null);
      const post = (m: string | null) =>
        api.post<{ jobId: number; sessionId: string | null }>('/api/jobs', {
          projectId: Number(projectId),
          prompt: filledPrompt,
          model: m,
          maxTurns: Number(maxTurns) || 15,
          permissionMode: abModel ? 'default' : mode, // A/B is read-only: parallel writers would trample each other
        });
      const first = await post(model || null);
      if (abModel) {
        const second = await post(abModel);
        if (first.sessionId && second.sessionId) setAbLink(`/compare?a=${first.sessionId}&b=${second.sessionId}`);
      }
      return first;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const saveTemplate = async () => {
    if (!tplName.trim() || !prompt.trim()) return;
    setSavingTpl(true);
    try {
      await api.post('/api/templates', {
        name: tplName.trim(),
        body: prompt,
        projectId: projectId ? Number(projectId) : null,
        model: model || null,
        maxTurns: Number(maxTurns) || null,
        permissionMode: mode !== 'default' ? mode : null,
      });
      setTplName('');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    } finally {
      setSavingTpl(false);
    }
  };

  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* launcher */}
        <Card title="run claude headless" bodyClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              aria-label="Project"
              className="min-w-52 rounded-md border border-line bg-surface2 px-3 py-2 text-[14px] text-ink outline-none"
            >
              {roots.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model"
              className="rounded-md border border-line bg-surface2 px-3 py-2 text-[14px] text-ink outline-none">
              {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 font-mono text-[12px] text-dim">
              max turns
              <input
                type="number" min={1} max={50} value={maxTurns} onChange={(e) => setMaxTurns(e.target.value)}
                className="w-16 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[12px] text-dim" title="Run the same prompt on a second model and compare the runs — forces read-only permissions">
              A/B vs
              <select value={abModel} onChange={(e) => setAbModel(e.target.value)}
                className="rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none">
                <option value="">off</option>
                {MODELS.filter((m) => m.value && m.value !== model).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={'What should Claude do in this project?\nUse {{variables}} for reusable templates.'}
            rows={5}
            className="w-full resize-y rounded-md border border-line bg-surface2 px-3 py-2.5 font-mono text-xs leading-5 text-ink outline-none placeholder:text-dim focus:border-claude/50"
          />
          {varNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {varNames.map((n) => (
                <label key={n} className="flex items-center gap-1.5 font-mono text-[12px] text-dim">
                  {`{{${n}}}`}
                  <input
                    value={vars[n] ?? ''}
                    onChange={(e) => setVars((v) => ({ ...v, [n]: e.target.value }))}
                    className="w-40 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none focus:border-claude/50"
                  />
                </label>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <div className="microlabel">permissions for this unattended run</div>
            {MODES.map((m) => (
              <label key={m.value} className="flex cursor-pointer items-center gap-2 text-xs text-mid">
                <input type="radio" name="mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                <span className={cn(m.value === 'bypassPermissions' && 'text-danger')}>{m.label}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
            <button
              onClick={() => launch.mutate()}
              disabled={launch.isPending || !prompt.trim() || !projectId || varsMissing}
              className="flex items-center gap-2 rounded-md border border-claude/50 bg-claude/10 px-4 py-2 font-mono text-[12px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
            >
              <Rocket size={13} /> {launch.isPending ? 'launching…' : 'launch'}
            </button>
            {varsMissing && <span className="font-mono text-[11px] text-dim">fill the {'{{variables}}'} first</span>}
            {launch.isError && <span className="font-mono text-[12px] text-danger">{(launch.error as Error).message}</span>}
            {abLink && (
              <Link to={abLink} className="font-mono text-[12px] uppercase tracking-wider text-claude hover:underline">
                a/b launched — open comparison →
              </Link>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <input
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="template name…"
                className="w-36 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none placeholder:text-dim"
              />
              <button
                onClick={saveTemplate}
                disabled={savingTpl || !tplName.trim() || !prompt.trim()}
                title="Save the current form as a reusable template"
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-40"
              >
                <Save size={11} /> save
              </button>
            </span>
          </div>
        </Card>

        {/* template library */}
        <Card title="templates" bodyClassName="p-0">
          {!templates.data?.length && (
            <div className="px-4 py-6 text-center text-xs text-dim">
              No templates yet — write a prompt and save it. <br />Use {'{{variables}}'} for the parts that change.
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            {(templates.data ?? []).map((t) => (
              <TemplateRow key={t.id} t={t} onApply={() => applyTemplate(t)} />
            ))}
          </div>
        </Card>
      </div>

      <Card title={`runs${jobs.data?.running ? ` · ${jobs.data.running} active` : ''}`} bodyClassName="p-0">
        {!jobs.data?.jobs.length && <EmptyState title="No headless runs yet" hint="Launched jobs appear here with live output, then ingest as normal sessions." />}
        <div className="divide-y divide-line/60">
          {(jobs.data?.jobs ?? []).map((j) => <JobRow key={j.id} j={j} />)}
        </div>
      </Card>

      <SchedulesCard roots={roots} currentPrompt={prompt} currentProjectId={projectId} currentModel={model} currentMode={mode} currentMaxTurns={maxTurns} />
    </div>
  );
}

function SchedulesCard({
  roots, currentPrompt, currentProjectId, currentModel, currentMode, currentMaxTurns,
}: {
  roots: Project[];
  currentPrompt: string;
  currentProjectId: string;
  currentModel: string;
  currentMode: string;
  currentMaxTurns: string;
}) {
  const q = useQuery(schedulesQuery());
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [dow, setDow] = useState('1');
  const [time, setTime] = useState('07:30');
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['schedules'] });

  const create = async () => {
    setErr(null);
    const [h, m] = time.split(':').map(Number);
    try {
      await api.post('/api/schedules', {
        name: name.trim(),
        prompt: currentPrompt,
        projectId: Number(currentProjectId),
        model: currentModel || null,
        maxTurns: Number(currentMaxTurns) || 15,
        permissionMode: currentMode,
        cadence,
        hour: h,
        minute: m,
        dow: cadence === 'weekly' ? Number(dow) : null,
      });
      setName('');
      refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  };

  return (
    <Card title="schedules" bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <CalendarClock size={13} className="text-dim" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="schedule name — uses the launcher form above as its job"
          className="min-w-56 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none placeholder:text-dim"
        />
        <select value={cadence} onChange={(e) => setCadence(e.target.value as 'daily' | 'weekly')} aria-label="Cadence"
          className="rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
        {cadence === 'weekly' && (
          <select value={dow} onChange={(e) => setDow(e.target.value)} aria-label="Day of week"
            className="rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none">
            {DOWS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        )}
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time"
          className="rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none" />
        <button
          onClick={create}
          disabled={!name.trim() || !currentPrompt.trim()}
          className="rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          add schedule
        </button>
        {err && <span className="font-mono text-[11px] text-danger">{err}</span>}
      </div>
      {!q.data?.length && (
        <div className="px-4 py-4 text-xs text-dim">
          No schedules. Fill the launcher form, name it here, and Pulse runs it on cadence — e.g. every morning: “update dependencies, run npm run check, summarize anything broken”.
        </div>
      )}
      {(q.data ?? []).map((s) => (
        <ScheduleRow key={s.id} s={s} roots={roots} onChange={refresh} />
      ))}
    </Card>
  );
}

function ScheduleRow({ s, roots, onChange }: { s: ScheduledJob; roots: Project[]; onChange: () => void }) {
  const projectName = roots.find((p) => p.path === s.projectPath)?.name ?? s.projectPath.split(/[\\/]/).pop();
  const toggle = async () => {
    await api.put(`/api/schedules/${s.id}`, { enabled: !s.enabled });
    onChange();
  };
  const del = async () => {
    if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
    await api.del(`/api/schedules/${s.id}`);
    onChange();
  };
  const runNow = async () => {
    try {
      await api.post(`/api/schedules/${s.id}/run`, {});
      onChange();
    } catch (ex) {
      window.alert(ex instanceof Error ? ex.message : String(ex));
    }
  };
  const failing = s.consecutiveFailures > 0;
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
      <button
        onClick={toggle}
        role="switch"
        aria-checked={s.enabled}
        aria-label={`Toggle ${s.name}`}
        className={cn(
          'relative h-4 w-8 shrink-0 rounded-full border',
          s.enabled ? 'border-claude/60 bg-claude/30' : 'border-line2 bg-raise'
        )}
      >
        <span className={cn('absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all', s.enabled ? 'left-[18px] bg-claude' : 'left-0.5 bg-dim')} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs text-ink">
          <span className="truncate">{s.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-dim">
            {s.cadence === 'weekly' ? `${DOWS[s.dow ?? 1]} ` : 'daily '}
            {String(s.hour).padStart(2, '0')}:{String(s.minute).padStart(2, '0')} · {projectName}
          </span>
        </div>
        <div className={cn('truncate font-mono text-[11px]', failing ? 'text-danger' : 'text-dim')}>
          {s.lastRunAt ? `last ${fmtRelative(s.lastRunAt)} · ${s.lastStatus ?? '?'}` : 'never run'}
          {failing && ` · ${s.consecutiveFailures} consecutive failure${s.consecutiveFailures === 1 ? '' : 's'}${!s.enabled ? ' — auto-disabled' : ''}`}
        </div>
      </div>
      <button onClick={runNow} aria-label="Run now" title="Run now" className="shrink-0 rounded border border-line p-1 text-dim hover:text-claude">
        <Play size={11} />
      </button>
      <button onClick={del} aria-label="Delete schedule" className="shrink-0 rounded border border-line p-1 text-dim hover:border-danger/50 hover:text-danger">
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function TemplateRow({ t, onApply }: { t: PromptTemplate; onApply: () => void }) {
  const queryClient = useQueryClient();
  const del = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    await api.del(`/api/templates/${t.id}`);
    queryClient.invalidateQueries({ queryKey: ['templates'] });
  };
  const togglePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await api.put(`/api/templates/${t.id}`, { ...t, pinned: !t.pinned });
    queryClient.invalidateQueries({ queryKey: ['templates'] });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onApply}
      onKeyDown={(e) => e.key === 'Enter' && onApply()}
      className="group flex w-full cursor-pointer items-start gap-2 border-b border-line/60 px-3.5 py-2.5 text-left last:border-0 hover:bg-surface2/60"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs text-ink">
          {t.pinned && <Pin size={10} className="shrink-0 text-user" />}
          <span className="truncate">{t.name}</span>
        </div>
        <div className="truncate font-mono text-[11px] text-dim">{t.body.replace(/\s+/g, ' ')}</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-dim">
          {t.runCount > 0 ? `${plural(t.runCount, 'run')}${t.lastRunAt ? ` · last ${fmtRelative(t.lastRunAt)}` : ''}` : 'never run'}
        </div>
      </div>
      <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
        <button onClick={togglePin} aria-label={t.pinned ? 'Unpin' : 'Pin'} title={t.pinned ? 'Unpin' : 'Pin (shows on project pages)'}
          className="rounded border border-line p-1 text-dim hover:text-user">
          <Pin size={10} />
        </button>
        <button onClick={del} aria-label="Delete template" className="rounded border border-line p-1 text-dim hover:border-danger/50 hover:text-danger">
          <Trash2 size={10} />
        </button>
      </span>
    </div>
  );
}

function JobRow({ j }: { j: PulseJob }) {
  const [open, setOpen] = useState(j.status === 'running');
  const queryClient = useQueryClient();
  const kill = async () => {
    await api.post(`/api/jobs/${j.id}/kill`, {});
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };
  const tone = j.status === 'running' ? 'text-claude' : j.status === 'done' ? 'text-ok' : j.status === 'killed' ? 'text-dim' : 'text-danger';
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="shrink-0 text-dim hover:text-ink">
          <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
        </button>
        <span className={cn('shrink-0 font-mono text-[11px] uppercase tracking-wider', tone)}>
          {j.status === 'running' ? <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-claude pulse-dot" />running</span> : j.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{j.prompt.replace(/\s+/g, ' ')}</span>
        {j.resumeOf && <Badge>resume</Badge>}
        {j.model && <Badge>{j.model.replace('claude-', '')}</Badge>}
        <span className="shrink-0 font-mono text-[11px] text-dim">
          {fmtClock(j.createdAt)}
          {j.endedAt && j.startedAt ? ` · ${fmtDuration(j.endedAt - j.startedAt)}` : ''}
        </span>
        {j.status === 'running' && (
          <button onClick={kill} aria-label="Kill job" title="Kill this run"
            className="shrink-0 rounded border border-line p-1 text-dim hover:border-danger/50 hover:text-danger">
            <Square size={9} fill="currentColor" />
          </button>
        )}
        {j.sessionId && j.status !== 'running' && (
          <Link to={`/sessions/${j.sessionId}`} className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude">
            session →
          </Link>
        )}
      </div>
      {open && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-4 text-mid">
          {j.outputTail?.trim() || (j.status === 'running' ? 'waiting for output…' : 'no output captured')}
        </pre>
      )}
    </div>
  );
}
