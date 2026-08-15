import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Trash2, Plus, Sparkles, Bot, Package } from 'lucide-react';
import { api } from '../lib/api';
import { mcpServersQuery, manageInventoryQuery, mcpStatsQuery } from '../lib/queries';
import { todayKey, addDays } from '../lib/time';
import { fmtCount, fmtRelative, plural } from '../lib/format';
import { Badge, Card, Skeleton } from '../components/ui';
import { RoutinesCard } from '../components/manage/RoutinesCard';
import { MemoryCard } from '../components/manage/MemoryCard';
import { useT } from '../lib/i18n';
import { cn } from '../lib/cn';

export default function ManagePage() {
  return (
    <div className="fade-up w-full space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <RoutinesCard />
        <MemoryCard />
      </div>
      <McpCard />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <SkillsCard />
        <AgentsCard />
        <PluginsCard />
      </div>
    </div>
  );
}

function McpCard() {
  const { t, tf } = useT();
  const q = useQuery(mcpServersQuery());
  // 90d usage from event attribution: which of these servers earn their
  // context cost. Joined by name; "never used" is the interesting signal.
  const usage = useQuery(mcpStatsQuery(addDays(todayKey(), -89), todayKey()));
  const usageByName = new Map((usage.data?.servers ?? []).map((s) => [s.name.toLowerCase(), s]));
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });

  const add = async () => {
    setBusy('add');
    setErr(null);
    try {
      await api.post('/api/manage/mcp', { name: name.trim(), command: command.trim() });
      setName('');
      setCommand('');
      refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (n: string) => {
    if (!window.confirm(tf('run.mcpConfirmRemove', { name: n }))) return;
    setBusy(n);
    setErr(null);
    try {
      await api.del(`/api/manage/mcp/${encodeURIComponent(n)}`);
      refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={`${t('run.mcpTitle')}${q.data ? ` · ${q.data.servers.length}` : ''}`}
      action={
        <span className="flex items-center gap-2">
          {q.data && <span className="font-mono text-[11px] text-dim">{tf('run.checkedWhen', { when: fmtRelative(q.data.checkedAt) })}</span>}
          <button
            onClick={() => { queryClient.removeQueries({ queryKey: ['mcp-servers'] }); q.refetch(); }}
            aria-label={t('run.recheckAria')}
            title={t('run.recheckTitle')}
            className="rounded border border-line p-1 text-dim hover:text-ink"
          >
            <RefreshCw size={11} className={cn(q.isFetching && 'animate-spin')} />
          </button>
        </span>
      }
      bodyClassName="p-0"
    >
      {q.isLoading && (
        <div className="px-4 py-3">
          <div className="mb-2 font-mono text-[12px] text-dim">{t('run.mcpChecking')}</div>
          <Skeleton className="h-24" />
        </div>
      )}
      {q.isError && <div className="px-4 py-3 font-mono text-[12px] text-danger">{String((q.error as Error).message)}</div>}
      {q.data?.servers.map((s) => {
        const u = usageByName.get(s.name.toLowerCase());
        return (
        <div key={s.name} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', s.healthy ? 'bg-ok' : 'bg-danger')} title={s.status} />
          <span className="w-40 shrink-0 truncate font-mono text-xs text-ink">{s.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim" title={s.command}>{s.command}</span>
          <span
            className={cn('shrink-0 font-mono text-[11px]', u ? 'text-mid' : 'text-dim')}
            title={u ? tf('run.mcpUsageTitle', { calls: u.calls, sessions: u.sessions }) : t('run.mcpNeverTitle')}
          >
            {u ? tf('run.mcpUsage', { calls: fmtCount(u.calls), when: fmtRelative(u.lastUsedAt) }) : t('run.mcpNever')}
          </span>
          <span className={cn('shrink-0 font-mono text-[11px]', s.healthy ? 'text-ok' : 'text-danger')}>{s.status || (s.healthy ? t('run.connected') : t('run.failedStatus'))}</span>
          <button
            onClick={() => remove(s.name)}
            disabled={busy === s.name}
            aria-label={tf('run.removeNameAria', { name: s.name })}
            className="shrink-0 rounded border border-line p-1 text-dim hover:border-danger/50 hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={11} />
          </button>
        </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Plug size={13} className="text-dim" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('run.namePlaceholder')}
          className="w-32 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim"
        />
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t('run.commandPlaceholder')}
          className="min-w-64 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim"
        />
        <button
          onClick={add}
          disabled={busy === 'add' || !name.trim() || !command.trim()}
          className="flex items-center gap-1.5 rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          <Plus size={11} /> {busy === 'add' ? t('run.adding') : t('run.addUserScope')}
        </button>
        {err && <span className="w-full font-mono text-[11px] text-danger">{err}</span>}
      </div>
    </Card>
  );
}

function SkillsCard() {
  const { t } = useT();
  const q = useQuery(manageInventoryQuery());
  const skills = q.data?.skills ?? [];
  return (
    <Card title={`${t('run.skillsTitle')} · ${skills.length}`} bodyClassName="p-0">
      <div className="max-h-64 overflow-y-auto">
        {skills.map((s) => (
          <div key={s.dir} className="border-b border-line/60 px-4 py-2 last:border-0">
            <div className="flex items-center gap-1.5 text-xs text-ink"><Sparkles size={11} className="shrink-0 text-claude/70" />{s.name ?? s.dir}</div>
            {s.description && <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-dim">{s.description}</div>}
          </div>
        ))}
        {!q.isLoading && skills.length === 0 && <div className="px-4 py-4 text-xs text-dim">{t('run.skillsEmpty')}</div>}
      </div>
    </Card>
  );
}

function AgentsCard() {
  const { t } = useT();
  const q = useQuery(manageInventoryQuery());
  const agents = q.data?.agents ?? [];
  return (
    <Card title={`${t('run.agentsTitle')} · ${agents.length}`} bodyClassName="p-0">
      <div className="max-h-64 overflow-y-auto">
        {agents.map((a) => (
          <div key={a.file} className="border-b border-line/60 px-4 py-2 last:border-0">
            <div className="flex items-center gap-1.5 text-xs text-ink"><Bot size={11} className="shrink-0 text-claude/70" />{a.name ?? a.file}</div>
            {a.description && <div className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-dim">{a.description}</div>}
          </div>
        ))}
        {!q.isLoading && agents.length === 0 && <div className="px-4 py-4 text-xs text-dim">{t('run.agentsEmpty')}</div>}
      </div>
    </Card>
  );
}

function PluginsCard() {
  const { t } = useT();
  const q = useQuery(manageInventoryQuery());
  const plugins = q.data?.plugins ?? [];
  return (
    <Card title={`${t('run.pluginsTitle')} · ${plugins.length}`} bodyClassName="p-4">
      <div className="flex flex-wrap gap-1.5">
        {plugins.map((p) => (
          <Badge key={`${p.marketplace}/${p.name}`} className="flex items-center gap-1">
            <Package size={9} /> {p.name}
          </Badge>
        ))}
        {!q.isLoading && plugins.length === 0 && <span className="text-xs text-dim">{t('run.pluginsEmpty')}</span>}
      </div>
      {plugins.length > 0 && (
        <div className="mt-2 font-mono text-[11px] text-dim">{plural(new Set(plugins.map((p) => p.marketplace)).size, 'marketplace')}</div>
      )}
    </Card>
  );
}
