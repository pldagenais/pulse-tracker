import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { statusQuery, settingsQuery, parseFailuresQuery, webhooksQuery } from '../lib/queries';
import { api, qs } from '../lib/api';
import { useLiveSelector } from '../lib/live';
import { fmtBytes, fmtCount, fmtDuration, fmtRelative, plural } from '../lib/format';
import { Card, Skeleton, WriteError, useWriteAction } from '../components/ui';
import type { Webhook } from '../lib/types';
import { MODE } from '../lib/source';

/** Writes that need the local machine are disabled rather than left to fail. */
const LOCAL = MODE === 'local';
import { cn } from '../lib/cn';

export default function StatusPage() {
  const q = useQuery(statusQuery());
  const connection = useLiveSelector((s) => s.connection);
  const d = q.data;

  return (
    <div className="fade-up mx-auto max-w-3xl space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HealthCard
          label="watcher"
          ok={!!d?.watcher.watching}
          detail={d?.watcher.lastEventAt ? `last change ${fmtRelative(d.watcher.lastEventAt)}` : 'no changes seen yet'}
        />
        <HealthCard
          label="hooks"
          ok={!!d?.hooks.installed}
          warn={!!d?.hooks.installed && !d?.hooks.lastSeenAt}
          detail={
            d?.hooks.installed
              ? d.hooks.lastSeenAt
                ? `last event ${fmtRelative(d.hooks.lastSeenAt)}`
                : 'installed — waiting for first event'
              : 'not installed — run npm run setup'
          }
        />
        <HealthCard
          label="live stream"
          ok={connection === 'live'}
          detail={connection === 'live' ? `${plural(d?.sseClients ?? 1, 'client')} connected` : connection}
        />
      </div>

      <Card title="database" bodyClassName="p-0">
        {!d ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : (
          <table className="w-full font-mono text-xs">
            <tbody>
              {([
                ['sessions', fmtCount(d.db.sessions)],
                ['events', fmtCount(d.db.events)],
                ['prompts', fmtCount(d.db.prompts)],
                ['turns', fmtCount(d.db.turns)],
                ['subagent runs', fmtCount(d.db.agentRuns)],
                ['journal entries', fmtCount(d.db.journal)],
                ['parse errors', fmtCount(d.db.parseErrors)],
                ['db size', fmtBytes(d.db.sizeBytes)],
                ['last backup', d.backup.latestAt ? `${fmtRelative(d.backup.latestAt)} · ${fmtBytes(d.backup.latestSizeBytes ?? 0)} · ${d.backup.count} kept` : 'none yet (runs nightly)'],
                ['claude dir', d.claudeDir],
                ['data dir', d.dataDir],
                ['version', `${d.version} · up ${d.uptimeMs < 60_000 ? '<1m' : fmtDuration(d.uptimeMs)}`],
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
          {d.db.parseErrors24h} parse failures in the last 24h — a Claude Code update may have changed the transcript format. Check the inbox below.
        </div>
      )}
      <ParseFailuresCard />
      <SettingsCard />
      <WebhooksCard />
      <NotificationsCard />

      <Card title="export" bodyClassName="flex flex-wrap gap-2 p-4">
        {(['daily', 'sessions', 'prompts'] as const).map((what) => (
          <span key={what} className="flex items-center gap-1">
            <a
              href={`/api/export${qs({ what, format: 'csv' })}`}
              className="flex items-center gap-1.5 rounded-l-md border border-line px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
            >
              <Download size={12} /> {what} csv
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
    <Card title={`parse failures · ${d.byFile.reduce((t, f) => t + f.n, 0)} recorded`} bodyClassName="p-0">
      <div className="max-h-64 overflow-y-auto">
        {d.byFile.map((f) => (
          <div key={f.file} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px] text-ink" title={f.file}>
                …{f.file.split(/[\\/]/).slice(-2).join('\\')}
              </div>
              <div className="font-mono text-[11px] text-dim">
                {plural(f.n, 'bad line')} · last {fmtRelative(f.last)}
              </div>
            </div>
            <button
              onClick={() => reparse(f.file)}
              disabled={reparsing === f.file}
              className="shrink-0 rounded border border-line px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink disabled:opacity-50"
            >
              {reparsing === f.file ? 'reparsing…' : 're-parse'}
            </button>
          </div>
        ))}
      </div>
      {d.recent[0]?.snippet && (
        <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
          latest: <span className="text-mid">{d.recent[0].snippet}</span>
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
  const [idle, setIdle] = useState('');
  const [cap, setCap] = useState('');
  const [budget, setBudget] = useState('');
  const [w5, setW5] = useState('');
  const [alertDaily, setAlertDaily] = useState('');
  const [alertSession, setAlertSession] = useState('');

  useEffect(() => {
    if (q.data) {
      setIdle(String(q.data.idleThresholdMin));
      setCap(String(q.data.stallCapMin));
      setBudget(q.data.monthlyBudgetUsd != null ? String(q.data.monthlyBudgetUsd) : '');
      setW5(q.data.window5hBudgetUsd != null ? String(q.data.window5hBudgetUsd) : '');
      setAlertDaily(q.data.alertDailyCostUsd != null ? String(q.data.alertDailyCostUsd) : '');
      setAlertSession(q.data.alertSessionCostUsd != null ? String(q.data.alertSessionCostUsd) : '');
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
      }),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries(), 1500),
  });

  return (
    <Card title="timing model & budget" bodyClassName="space-y-3 p-4">
      <Field
        label="idle threshold (min)"
        hint="A pause between turns longer than this counts as you walking away, not reviewing."
        value={idle}
        onChange={setIdle}
      />
      <Field
        label="stall cap (min)"
        hint="Inside a turn, any single silent gap is capped at this — excludes permission-dialog waits and laptop sleeps from Claude's working time."
        value={cap}
        onChange={setCap}
      />
      <Field
        label="monthly budget (USD)"
        hint="Optional. Shows month-to-date estimated cost vs this target on the Dashboard, with a pace projection. Leave empty to disable."
        value={budget}
        onChange={setBudget}
        allowEmpty
      />
      <Field
        label="5h window estimate (USD)"
        hint="Optional. Your rough estimate of how much est. cost fits in a Max-plan 5-hour window before rate limits bite — Mission Control shows a fill bar against it."
        value={w5}
        onChange={setW5}
        allowEmpty
      />
      <Field
        label="alert: daily cost (USD)"
        hint="Optional. Fires a bell alert (and webhooks) once per day when today's est. cost passes this."
        value={alertDaily}
        onChange={setAlertDaily}
        allowEmpty
      />
      <Field
        label="alert: session cost (USD)"
        hint="Optional. Fires once per session when a single session's est. cost passes this."
        value={alertSession}
        onChange={setAlertSession}
        allowEmpty
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-50"
        >
          {save.isPending ? 'saving…' : 'save & recompute'}
        </button>
        {save.isSuccess && <span className="font-mono text-[12px] text-ok">saved — recomputing sessions…</span>}
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
    <Card title="outbound webhooks" bodyClassName="p-0">
      {(q.data ?? []).map((w) => (
        <WebhookRow key={w.id} w={w} refresh={refresh} />
      ))}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://ntfy.sh/your-topic or a Discord webhook URL — POSTed on every alert"
          className="min-w-64 flex-1 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim"
        />
        <button
          onClick={add}
          disabled={!url.trim() || !LOCAL}
          title={LOCAL ? undefined : 'Webhooks need your PC'}
          className="rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
        >
          add
        </button>
        {err && <span className="w-full font-mono text-[11px] text-danger">{err}</span>}
      </div>
    </Card>
  );
}

function WebhookRow({ w, refresh }: { w: Webhook; refresh: () => void }) {
  const toggle = useWriteAction(async () => {
    await api.put(`/api/webhooks/${w.id}`, { enabled: !w.enabled });
    refresh();
  });
  const del = useWriteAction(async () => {
    if (!window.confirm('Delete this webhook?')) return;
    await api.del(`/api/webhooks/${w.id}`);
    refresh();
  });
  return (
    <div className="flex items-center gap-3 border-b border-line/60 px-4 py-2">
      <button
        onClick={() => toggle.run()}
        disabled={toggle.pending || !LOCAL}
        title={LOCAL ? undefined : 'Webhooks need your PC'}
        role="switch"
        aria-checked={w.enabled}
        aria-label="Toggle webhook"
        className={cn('relative h-4 w-8 shrink-0 rounded-full border disabled:opacity-40', w.enabled ? 'border-claude/60 bg-claude/30' : 'border-line2 bg-raise')}
      >
        <span className={cn('absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all', w.enabled ? 'left-[18px] bg-claude' : 'left-0.5 bg-dim')} />
      </button>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{w.url}</span>
      <WriteError error={toggle.error ?? del.error} />
      <span className="shrink-0 font-mono text-[11px] text-dim">
        {w.lastFiredAt ? `${w.lastStatus ?? ''} · ${fmtRelative(w.lastFiredAt)}` : 'never fired'}
      </span>
      <button
        onClick={() => del.run()}
        disabled={del.pending || !LOCAL}
        title={LOCAL ? undefined : 'Webhooks need your PC'}
        aria-label="Delete webhook"
        className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim hover:border-danger/50 hover:text-danger disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
}

function NotificationsCard() {
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
    <Card title="notifications" bodyClassName="flex items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink">Long-run completion alerts</div>
        <div className="mt-0.5 text-[12px] leading-4 text-dim">
          Desktop notification when a session that worked 5+ minutes finishes — useful while Claude runs in the background.
          {permission === 'denied' && <span className="text-danger"> Browser permission is denied — allow notifications for this site first.</span>}
        </div>
      </div>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle completion notifications"
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          enabled ? 'border-claude/60 bg-claude/30' : 'border-line2 bg-raise'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all',
            enabled ? 'left-[18px] bg-claude' : 'left-0.5 bg-dim'
          )}
        />
      </button>
    </Card>
  );
}

function Field({
  label, hint, value, onChange, allowEmpty,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-56 shrink-0">
        <div className="text-xs text-ink">{label}</div>
        <div className="mt-0.5 text-[12px] leading-4 text-dim">{hint}</div>
      </div>
      <input
        type="number"
        min={allowEmpty ? 0 : 1}
        max={allowEmpty ? 1000000 : 240}
        placeholder={allowEmpty ? 'off' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-line bg-surface2 px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-dim focus:border-claude/50"
      />
    </div>
  );
}

function RescanButton() {
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
      title="Re-scan ~/.claude for changed transcripts"
    >
      <RefreshCw size={12} className={cn(busy && 'animate-spin')} /> re-scan
    </button>
  );
}
