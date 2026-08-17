import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { statusQuery, settingsQuery, parseFailuresQuery, webhooksQuery, accountsQuery } from '../lib/queries';
import { api, qs } from '../lib/api';
import { useLiveSelector } from '../lib/live';
import { fmtBytes, fmtCount, fmtDuration, fmtRelative, plural } from '../lib/format';
import { Card, Skeleton, Switch, WriteError, useWriteAction } from '../components/ui';
import type { Webhook } from '../lib/types';
import { MODE } from '../lib/source';
import { useT } from '../lib/i18n';

/** Writes that need the local machine are disabled rather than left to fail. */
const LOCAL = MODE === 'local';
import { cn } from '../lib/cn';

export default function StatusPage() {
  const q = useQuery(statusQuery());
  const connection = useLiveSelector((s) => s.connection);
  const { t, tf } = useT();
  const d = q.data;

  return (
    <div className="fade-up mx-auto max-w-3xl space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HealthCard
          label={t('status.watcher')}
          ok={!!d?.watcher.watching}
          detail={d?.watcher.lastEventAt ? tf('status.lastChange', { when: fmtRelative(d.watcher.lastEventAt) }) : t('status.noChanges')}
        />
        <HealthCard
          label={t('status.hooks')}
          ok={!!d?.hooks.installed}
          warn={!!d?.hooks.installed && !d?.hooks.lastSeenAt}
          detail={
            d?.hooks.installed
              ? d.hooks.lastSeenAt
                ? tf('status.lastEvent', { when: fmtRelative(d.hooks.lastSeenAt) })
                : t('status.hooksWaiting')
              : t('status.hooksMissing')
          }
        />
        <HealthCard
          label={t('status.liveStream')}
          ok={connection === 'live'}
          detail={connection === 'live' ? tf('status.clientsConnected', { clients: plural(d?.sseClients ?? 1, 'client') }) : connection}
        />
      </div>

      <Card title={t('status.database')} bodyClassName="p-0">
        {!d ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : (
          <table className="w-full font-mono text-xs">
            <tbody>
              {([
                [t('status.rowSessions'), fmtCount(d.db.sessions)],
                [t('status.rowEvents'), fmtCount(d.db.events)],
                [t('status.rowPrompts'), fmtCount(d.db.prompts)],
                [t('status.rowTurns'), fmtCount(d.db.turns)],
                [t('status.rowAgentRuns'), fmtCount(d.db.agentRuns)],
                [t('status.rowJournal'), fmtCount(d.db.journal)],
                [t('status.rowParseErrors'), fmtCount(d.db.parseErrors)],
                [t('status.rowDbSize'), fmtBytes(d.db.sizeBytes)],
                [t('status.rowLastBackup'), d.backup.latestAt ? tf('status.backupValue', { when: fmtRelative(d.backup.latestAt), size: fmtBytes(d.backup.latestSizeBytes ?? 0), n: d.backup.count }) : t('status.backupNone')],
                [t('status.rowClaudeDir'), d.claudeDir],
                [t('status.rowDataDir'), d.dataDir],
                [t('status.rowVersion'), tf('status.versionValue', { v: d.version, up: d.uptimeMs < 60_000 ? '<1m' : fmtDuration(d.uptimeMs) })],
              ] as const).map(([k, v]) => (
                <tr key={k} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-1.5 text-dim">{k}</td>
                  <td className="px-4 py-1.5 text-right text-ink">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {d && d.db.parseErrors24h > 20 && (
        <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[12px] text-danger">
          <AlertTriangle size={13} />
          {tf('status.parseSpike', { n: d.db.parseErrors24h })}
        </div>
      )}
      <ParseFailuresCard />
      <AccountsCard />
      <SettingsCard />
      <WebhooksCard />
      <NotificationsCard />

      <Card title={t('status.exportTitle')} bodyClassName="flex flex-wrap gap-2 p-4">
        {(['daily', 'sessions', 'prompts'] as const).map((what) => (
          <span key={what} className="flex items-center gap-1">
            <a
              href={`/api/export${qs({ what, format: 'csv' })}`}
              className="flex items-center gap-1.5 rounded-l-md border border-line px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
            >
              <Download size={12} /> {t(({ daily: 'status.exportDaily', sessions: 'status.exportSessions', prompts: 'status.exportPrompts' } as const)[what])} csv
            </a>
            <a
              href={`/api/export${qs({ what, format: 'json' })}`}
              className="rounded-r-md border border-l-0 border-line px-2 py-1.5 font-mono text-[12px] uppercase tracking-wider text-dim hover:bg-surface2 hover:text-ink"
            >
              json
            </a>
          </span>
        ))}
        <RescanButton />
      </Card>
    </div>
  );
}

function ParseFailuresCard() {
  const q = useQuery(parseFailuresQuery());
  const queryClient = useQueryClient();
  const [reparsing, setReparsing] = useState<string | null>(null);
  const { t, tf } = useT();
  const d = q.data;
  if (!d || d.byFile.length === 0) return null;

  const reparse = async (file: string) => {
    setReparsing(file);
    try {
      await api.post('/api/parse-failures/reparse', { path: file });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['parse-failures'] }), 2500);
    } finally {
      setTimeout(() => setReparsing(null), 2500);
    }
  };

  return (
    <Card title={tf('status.parseFailuresTitle', { n: d.byFile.reduce((sum, f) => sum + f.n, 0) })} bodyClassName="p-0">
      <div className="max-h-64 overflow-y-auto">
        {d.byFile.map((f) => (
          <div key={f.file} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px] text-ink" title={f.file}>
                …{f.file.split(/[\\/]/).slice(-2).join('\\')}
              </div>
              <div className="font-mono text-[11px] text-dim">
                {tf('status.badLinesLast', { lines: plural(f.n, 'bad line'), when: fmtRelative(f.last) })}
              </div>
            </div>
            <button
              onClick={() => reparse(f.file)}
              disabled={reparsing === f.file}
              className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-50"
            >
              {reparsing === f.file ? t('status.reparsing') : t('status.reparse')}
            </button>
          </div>
        ))}
      </div>
      {d.recent[0]?.snippet && (
        <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
          {t('status.latest')} <span className="text-mid">{d.recent[0].snippet}</span>
        </div>
      )}
    </Card>
  );
}

function HealthCard({ label, ok, warn, detail }: { label: string; ok: boolean; warn?: boolean; detail: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="microlabel">{label}</span>
        <span className={cn('h-2 w-2 rounded-full', warn ? 'bg-user' : ok ? 'bg-ok' : 'bg-danger')} />
      </div>
      <div className="mt-1.5 font-mono text-[12px] text-mid">{detail}</div>
    </div>
  );
}

function SettingsCard() {
  const q = useQuery(settingsQuery());
  const queryClient = useQueryClient();
  const { t } = useT();
  const [idle, setIdle] = useState('');
  const [cap, setCap] = useState('');
  const [budget, setBudget] = useState('');
  const [w5, setW5] = useState('');
  const [alertDaily, setAlertDaily] = useState('');
  const [alertSession, setAlertSession] = useState('');
  const [llmConfigDir, setLlmConfigDir] = useState('');
  const [llmModel, setLlmModel] = useState('');

  useEffect(() => {
    if (q.data) {
      setIdle(String(q.data.idleThresholdMin));
      setCap(String(q.data.stallCapMin));
      setBudget(q.data.monthlyBudgetUsd != null ? String(q.data.monthlyBudgetUsd) : '');
      setW5(q.data.window5hBudgetUsd != null ? String(q.data.window5hBudgetUsd) : '');
      setAlertDaily(q.data.alertDailyCostUsd != null ? String(q.data.alertDailyCostUsd) : '');
      setAlertSession(q.data.alertSessionCostUsd != null ? String(q.data.alertSessionCostUsd) : '');
      setLlmConfigDir(q.data.llmConfigDir ?? '');
      setLlmModel(q.data.llmModel ?? '');
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/api/settings', {
        idleThresholdMin: Number(idle),
        stallCapMin: Number(cap),
        monthlyBudgetUsd: budget.trim() === '' ? null : Number(budget),
        window5hBudgetUsd: w5.trim() === '' ? null : Number(w5),
        alertDailyCostUsd: alertDaily.trim() === '' ? null : Number(alertDaily),
        alertSessionCostUsd: alertSession.trim() === '' ? null : Number(alertSession),
        llmConfigDir: llmConfigDir.trim(),
        llmModel: llmModel.trim(),
      }),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries(), 1500),
  });

  return (
    <Card title={t('status.timingTitle')} bodyClassName="space-y-3 p-4">
      <Field
        label={t('status.idleLabel')}
        hint={t('status.idleHint')}
        value={idle}
        onChange={setIdle}
      />
      <Field
        label={t('status.capLabel')}
        hint={t('status.capHint')}
        value={cap}
        onChange={setCap}
      />
      <Field
        label={t('status.budgetLabel')}
        hint={t('status.budgetHint')}
        value={budget}
        onChange={setBudget}
        allowEmpty
      />
      <Field
        label={t('status.w5Label')}
        hint={t('status.w5Hint')}
        value={w5}
        onChange={setW5}
        allowEmpty
      />
      <Field
        label={t('status.alertDailyLabel')}
        hint={t('status.alertDailyHint')}
        value={alertDaily}
        onChange={setAlertDaily}
        allowEmpty
      />
      <Field
        label={t('status.alertSessionLabel')}
        hint={t('status.alertSessionHint')}
        value={alertSession}
        onChange={setAlertSession}
        allowEmpty
      />
      <Field
        label={t('status.llmConfigDirLabel')}
        hint={t('status.llmConfigDirHint')}
        value={llmConfigDir}
        onChange={setLlmConfigDir}
        type="text"
        allowEmpty
      />
      <Field
        label={t('status.llmModelLabel')}
        hint={t('status.llmModelHint')}
        value={llmModel}
        onChange={setLlmModel}
        type="text"
        allowEmpty
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-50"
        >
          {save.isPending ? t('status.saving') : t('status.saveRecompute')}
        </button>
        {save.isSuccess && <span className="font-mono text-[12px] text-ok">{t('status.savedRecomputing')}</span>}
        {save.isError && <span className="font-mono text-[12px] text-danger">{String(save.error)}</span>}
      </div>
    </Card>
  );
}

/* Outbound webhooks: POST {source:'pulse', rule, message, ts} on alerts.
 * Point one at ntfy.sh or a Discord webhook for phone push. */
function WebhooksCard() {
  const q = useQuery(webhooksQuery());
  const queryClient = useQueryClient();
  const { t } = useT();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });

  const add = async () => {
    setErr(null);
    try {
      await api.post('/api/webhooks', { url: url.trim(), events: [] });
      setUrl('');
      refresh();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    }
  };

  return (
    <Card title={t('status.webhooksTitle')} bodyClassName="p-0">
      {(q.data ?? []).map((w) => (
        <WebhookRow key={w.id} w={w} refresh={refresh} />
      ))}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('status.webhookPlaceholder')}
          className="min-w-64 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim"
        />
        <button
          onClick={add}
          disabled={!url.trim() || !LOCAL}
          title={LOCAL ? undefined : t('status.webhooksNeedPc')}
          className="rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          {t('status.add')}
        </button>
        {err && <span className="w-full font-mono text-[11px] text-danger">{err}</span>}
      </div>
    </Card>
  );
}

function WebhookRow({ w, refresh }: { w: Webhook; refresh: () => void }) {
  const { t } = useT();
  const toggle = useWriteAction(async () => {
    await api.put(`/api/webhooks/${w.id}`, { enabled: !w.enabled });
    refresh();
  });
  const del = useWriteAction(async () => {
    if (!window.confirm(t('status.deleteWebhookConfirm'))) return;
    await api.del(`/api/webhooks/${w.id}`);
    refresh();
  });
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-4 py-2">
      <Switch
        checked={w.enabled}
        onChange={() => toggle.run()}
        disabled={toggle.pending || !LOCAL}
        title={LOCAL ? undefined : t('status.webhooksNeedPc')}
        aria-label={t('status.toggleWebhook')}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{w.url}</span>
      <WriteError error={toggle.error ?? del.error} />
      <span className="shrink-0 font-mono text-[11px] text-dim">
        {w.lastFiredAt ? `${w.lastStatus ?? ''} · ${fmtRelative(w.lastFiredAt)}` : t('status.neverFired')}
      </span>
      <button
        onClick={() => del.run()}
        disabled={del.pending || !LOCAL}
        title={LOCAL ? undefined : t('status.webhooksNeedPc')}
        aria-label={t('status.deleteWebhook')}
        className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim hover:border-danger/50 hover:text-danger disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
}

function NotificationsCard() {
  const { t } = useT();
  const [enabled, setEnabled] = useState(() => localStorage.getItem('pulse-notify') === '1');
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );

  const toggle = async () => {
    if (!enabled) {
      if (typeof Notification === 'undefined') return;
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;
      localStorage.setItem('pulse-notify', '1');
      setEnabled(true);
    } else {
      localStorage.setItem('pulse-notify', '0');
      setEnabled(false);
    }
  };

  return (
    <Card title={t('status.notifsTitle')} bodyClassName="flex items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink">{t('status.notifsLabel')}</div>
        <div className="mt-0.5 text-[12px] leading-4 text-dim">
          {t('status.notifsHint')}
          {permission === 'denied' && <span className="text-danger"> {t('status.notifsDenied')}</span>}
        </div>
      </div>
      <Switch checked={enabled} onChange={toggle} size="md" aria-label={t('status.toggleNotifs')} />
    </Card>
  );
}

function Field({
  label, hint, value, onChange, allowEmpty, type = 'number',
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  type?: 'number' | 'text';
}) {
  const { t } = useT();
  return (
    <div className="flex items-start gap-4">
      <div className="w-56 shrink-0">
        <div className="text-xs text-ink">{label}</div>
        <div className="mt-0.5 text-[12px] leading-4 text-dim">{hint}</div>
      </div>
      {type === 'text' ? (
        <input
          type="text"
          placeholder={t('status.off')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-64 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim focus:border-claude/50"
        />
      ) : (
        <input
          type="number"
          min={allowEmpty ? 0 : 1}
          max={allowEmpty ? 1000000 : 240}
          placeholder={allowEmpty ? t('status.off') : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim focus:border-claude/50"
        />
      )}
    </div>
  );
}

/**
 * Two subscriptions on one machine. Desktop sessions identify themselves via
 * their profile dir, but a terminal CLI shares one credential store — only the
 * user knows which account it is signed into, so that one is asserted here.
 */
function AccountsCard() {
  const { t, tf } = useT();
  const queryClient = useQueryClient();
  const q = useQuery(accountsQuery());
  const d = q.data;

  const saveLabel = useWriteAction(async (uuid: string, label: string) => {
    await api.put(`/api/accounts/${uuid}`, { label });
    await queryClient.invalidateQueries();
  });
  const saveCli = useWriteAction(async (uuid: string) => {
    await api.put('/api/accounts/cli/current', { accountUuid: uuid || null });
    await queryClient.invalidateQueries();
  });

  // One subscription = nothing to disambiguate; don't add a card that asks a
  // question the user doesn't have.
  if (!d || d.accounts.length < 2) return null;

  return (
    <Card title={t('status.acctTitle')} bodyClassName="space-y-3 p-4">
      {d.accounts.map((a) => (
        <div key={a.uuid} className="flex items-start gap-4">
          <div className="w-56 shrink-0">
            <div className="truncate text-xs text-ink" title={a.email ?? a.uuid}>{a.name}</div>
            <div className="mt-0.5 font-mono text-[11px] leading-4 text-dim">
              {tf('status.acctSessions', { n: fmtCount(a.sessions) })}
              {a.isDefault && ` · ${t('status.acctDefault')}`}
              {a.planUsage?.sevendayPct != null && ` · ${tf('status.acctQuota', { fh: a.planUsage.fivehourPct ?? 0, sd: a.planUsage.sevendayPct })}`}
            </div>
          </div>
          <input
            defaultValue={a.label ?? ''}
            placeholder={t('status.acctLabelPlaceholder')}
            maxLength={60}
            disabled={!LOCAL}
            onBlur={(e) => { if (e.target.value !== (a.label ?? '')) saveLabel.run(a.uuid, e.target.value); }}
            className="w-48 rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none placeholder:text-dim focus:border-claude/50 disabled:opacity-50"
          />
        </div>
      ))}

      <div className="flex items-start gap-4 border-t border-line pt-3">
        <div className="w-56 shrink-0">
          <div className="text-xs text-ink">{t('status.acctCliLabel')}</div>
          <div className="mt-0.5 text-[12px] leading-4 text-dim">{t('status.acctCliHint')}</div>
        </div>
        <select
          value={d.cliAccountUuid ?? ''}
          disabled={!LOCAL}
          onChange={(e) => saveCli.run(e.target.value)}
          className="rounded border border-line bg-surface2 px-2 py-1.5 text-xs text-mid outline-none disabled:opacity-50"
        >
          <option value="">{t('status.acctCliNone')}</option>
          {d.accounts.map((a) => <option key={a.uuid} value={a.uuid}>{a.name}</option>)}
        </select>
      </div>

      {d.unattributedSessions > 0 && (
        <p className="font-mono text-[11px] text-dim">{tf('status.acctUnattributed', { n: fmtCount(d.unattributedSessions) })}</p>
      )}
      <WriteError error={saveLabel.error ?? saveCli.error} />
    </Card>
  );
}

function RescanButton() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const rescan = async () => {
    setBusy(true);
    try {
      await api.post('/api/rescan');
    } finally {
      setTimeout(() => setBusy(false), 3000);
    }
  };
  return (
    <button
      onClick={rescan}
      disabled={busy}
      className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-50"
      title={t('status.rescanTitle')}
    >
      <RefreshCw size={12} className={cn(busy && 'animate-spin')} /> {t('status.rescan')}
    </button>
  );
}
