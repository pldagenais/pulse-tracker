// Memory-file editor: global ~/.claude/CLAUDE.md + each project's auto-memory
// (MEMORY.md index + topic files). Saves keep rotating backups server-side.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { memoryTreeQuery } from '../../lib/queries';
import { fmtBytes, fmtRelative } from '../../lib/format';
import { Card, Skeleton } from '../ui';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/cn';

export function MemoryCard() {
  const { t } = useT();
  const q = useQuery(memoryTreeQuery());
  const [openFile, setOpenFile] = useState<{ path: string; name: string; group: string } | null>(null);

  return (
    <>
      <Card title={t('run.memoryTitle')} bodyClassName="p-0">
        {q.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
        <div className="max-h-[420px] overflow-y-auto">
          {(q.data?.groups ?? []).map((g) => (
            <div key={g.label} className="border-b border-line/60 last:border-0">
              <div className="microlabel px-4 pb-1 pt-2.5">{g.label}</div>
              {g.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => setOpenFile({ path: f.path, name: f.name, group: g.label })}
                  className="flex w-full items-baseline gap-2.5 px-4 py-1.5 text-left hover:bg-surface2/60"
                >
                  <BrainCircuit size={11} className={cn('shrink-0 self-center', f.name === 'MEMORY.md' || f.name === 'CLAUDE.md' ? 'text-claude/80' : 'text-dim')} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{f.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-dim">{fmtBytes(f.sizeBytes)} · {fmtRelative(f.mtime)}</span>
                </button>
              ))}
            </div>
          ))}
          {q.data && q.data.groups.length === 0 && <div className="px-4 py-4 text-xs text-dim">{t('run.memoryEmpty')}</div>}
        </div>
        <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
          {t('run.memoryFooter')}
        </div>
      </Card>
      {openFile && <MemoryEditor file={openFile} onClose={() => setOpenFile(null)} />}
    </>
  );
}

function MemoryEditor({ file, onClose }: { file: { path: string; name: string; group: string }; onClose: () => void }) {
  const { t, tf } = useT();
  const q = useQuery({
    queryKey: ['memory-file', file.path],
    queryFn: () => api.get<{ path: string; content: string }>(`/api/memory/file${qs({ path: file.path })}`),
    staleTime: 0,
    gcTime: 0,
  });
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const text = content ?? q.data?.content ?? '';
  const dirty = content != null && content !== q.data?.content;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.put('/api/memory/file', { path: file.path, content: text });
      queryClient.invalidateQueries({ queryKey: ['memory-tree'] });
      queryClient.invalidateQueries({ queryKey: ['memory-file', file.path] });
      setContent(null);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={tf('run.editFileAria', { name: file.name })}>
      <div className="absolute inset-0 bg-black/60" onClick={() => !dirty && onClose()} />
      <div className="glass-strong drawer-in absolute left-1/2 top-10 flex max-h-[85vh] w-[760px] max-w-[95vw] -translate-x-1/2 flex-col overflow-hidden rounded-xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <BrainCircuit size={14} className="text-claude" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] text-ink">{file.name}</div>
            <div className="truncate font-mono text-[11px] text-dim">{file.group}</div>
          </div>
          {dirty && <span className="font-mono text-[11px] text-user">{t('run.unsaved')}</span>}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-md border border-claude/50 bg-claude/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20 disabled:opacity-40"
          >
            {saving ? t('run.saving') : t('run.save')}
          </button>
          <button onClick={onClose} aria-label={t('run.close')} className="rounded p-1 text-dim hover:text-ink"><X size={14} /></button>
        </div>
        {q.isLoading ? (
          <div className="p-4"><Skeleton className="h-64" /></div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="min-h-[380px] flex-1 resize-none bg-bg px-4 py-3 font-mono text-xs leading-5 text-ink outline-none"
          />
        )}
        {err && <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-danger">{err}</div>}
      </div>
    </div>
  );
}
