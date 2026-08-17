// Memory-file editor: every file Claude loads into context — the global
// CLAUDE.md, each project's committed CLAUDE.md walking up from its cwd, and
// the auto-memory index plus topic files. Saves keep rotating backups
// server-side. Worktree copies of a repo's CLAUDE.md nest under the parent so
// one repo with 45 checkouts doesn't drown the card.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, ChevronRight, X } from 'lucide-react';
import { ApiError, api, qs } from '../../lib/api';
import { memoryTreeQuery } from '../../lib/queries';
import { fmtBytes, fmtRelative } from '../../lib/format';
import type { MemoryFileEntry, MemoryScope } from '../../lib/types';
import { Badge, Card, Skeleton } from '../ui';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/cn';

type T = ReturnType<typeof useT>['t'];

function scopeLabel(t: T, scope: MemoryScope): string {
  switch (scope) {
    case 'global': return t('run.scopeGlobal');
    case 'project': return t('run.scopeProject');
    case 'local': return t('run.scopeLocal');
    case 'projectDir': return t('run.scopeProjectDir');
    case 'auto': return t('run.scopeAuto');
  }
}

const scopeTone = (scope: MemoryScope) => (scope === 'local' ? 'user' : scope === 'auto' ? 'default' : 'claude');

/** Colour by scope, not by filename — once 20 files are named CLAUDE.md the
 *  filename says nothing about which one you're looking at. */
function iconTone(f: MemoryFileEntry): string {
  if (!f.exists) return 'text-dim/50';
  if (f.scope !== 'auto') return 'text-claude';
  return f.name === 'MEMORY.md' ? 'text-claude/80' : 'text-dim';
}

function FileRow({ f, indent, onOpen }: { f: MemoryFileEntry; indent?: boolean; onOpen: () => void }) {
  const { t, tf } = useT();
  return (
    <button
      onClick={onOpen}
      title={f.path}
      aria-label={tf('run.editFileAria', { name: f.rel || f.name })}
      className={cn('flex w-full items-baseline gap-2.5 px-4 py-1.5 text-left hover:bg-surface2/60', indent && 'pl-10')}
    >
      <BrainCircuit size={11} className={cn('shrink-0 self-center', iconTone(f))} />
      <span className={cn('min-w-0 flex-1 truncate font-mono text-[12px]', f.exists ? 'text-ink' : 'text-dim')}>
        {f.rel || f.name}
      </span>
      <Badge tone={scopeTone(f.scope)} className="shrink-0 self-center">{scopeLabel(t, f.scope)}</Badge>
      <span className={cn('shrink-0 font-mono text-[11px]', f.exists ? 'text-dim' : 'text-claude/70')}>
        {f.exists ? `${fmtBytes(f.sizeBytes)} · ${fmtRelative(f.mtime)}` : t('run.memoryCreate')}
      </span>
    </button>
  );
}

export function MemoryCard() {
  const { t, tf } = useT();
  const q = useQuery(memoryTreeQuery());
  const [openFile, setOpenFile] = useState<MemoryFileEntry | null>(null);
  const [groupOverride, setGroupOverride] = useState<Record<string, boolean>>({});
  const [wtOpen, setWtOpen] = useState<Record<string, boolean>>({});
  // Normalize at the API boundary. The bundle and the server are separate
  // deploys, so a freshly built page can briefly talk to a server that predates
  // a field — exactly what happens between `npm run build:web` and the server
  // restart. A missing collection should cost a row, not white-screen the page.
  const groups = useMemo(
    () => (q.data?.groups ?? []).map((g) => ({
      ...g,
      files: g.files ?? [],
      worktrees: (g.worktrees ?? []).map((w) => ({ ...w, files: w.files ?? [] })),
    })),
    [q.data]
  );

  // Groups arrive most-recently-active first; expand down the list until a row
  // budget is spent so the card opens on what you actually touched today.
  const openByDefault = useMemo(() => {
    const set = new Set<string>();
    let budget = 25;
    for (const g of groups) {
      if (budget <= 0) break;
      set.add(g.key);
      budget -= g.files.length;
    }
    return set;
  }, [groups]);

  return (
    <>
      <Card title={`${t('run.memoryTitle')}${q.data ? ` · ${q.data.count}` : ''}`} bodyClassName="p-0">
        {q.isLoading && <div className="p-4"><Skeleton className="h-24" /></div>}
        <div className="max-h-[520px] overflow-y-auto">
          {groups.map((g) => {
            const isOpen = groupOverride[g.key] ?? openByDefault.has(g.key);
            const wtCount = g.worktrees.length;
            return (
              <div key={g.key} className="border-b border-line/60 last:border-0">
                <button
                  onClick={() => setGroupOverride((s) => ({ ...s, [g.key]: !isOpen }))}
                  aria-expanded={isOpen}
                  aria-label={tf('run.memoryGroupAria', { name: g.label })}
                  title={g.rootPath ?? g.label}
                  className="flex w-full items-center gap-1.5 px-4 pb-1 pt-2.5 hover:bg-surface2/40"
                >
                  <ChevronRight size={10} className={cn('shrink-0 text-dim transition-transform', isOpen && 'rotate-90')} />
                  <span className="microlabel min-w-0 flex-1 truncate text-left">{g.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-dim">{g.files.length}</span>
                </button>

                {isOpen && (
                  <>
                    {g.files.map((f) => <FileRow key={f.path} f={f} onOpen={() => setOpenFile(f)} />)}
                    {wtCount > 0 && (
                      <>
                        <button
                          onClick={() => setWtOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
                          aria-expanded={!!wtOpen[g.key]}
                          className="flex w-full items-center gap-1.5 px-4 py-1 pl-8 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-ink"
                        >
                          <ChevronRight size={10} className={cn('shrink-0 transition-transform', wtOpen[g.key] && 'rotate-90')} />
                          {tf(wtCount === 1 ? 'run.memoryWorktree' : 'run.memoryWorktrees', { n: wtCount })}
                        </button>
                        {wtOpen[g.key] && g.worktrees.map((w) => (
                          <div key={w.key}>
                            <div className="px-4 pl-10 pt-1">
                              <Badge className="max-w-[220px] truncate" >{w.branch ?? w.label}</Badge>
                            </div>
                            {w.files.map((f) => <FileRow key={f.path} f={f} indent onOpen={() => setOpenFile(f)} />)}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {q.data && groups.length === 0 && <div className="px-4 py-4 text-xs text-dim">{t('run.memoryEmpty')}</div>}
        </div>
        <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-dim">
          {t('run.memoryFooter')}
        </div>
      </Card>
      {openFile && <MemoryEditor file={openFile} onClose={() => setOpenFile(null)} />}
    </>
  );
}

interface FileResponse { path: string; content: string; mtime: number; exists: boolean; scope: MemoryScope }

function MemoryEditor({ file, onClose }: { file: MemoryFileEntry; onClose: () => void }) {
  const { t, tf } = useT();
  const q = useQuery({
    queryKey: ['memory-file', file.path],
    queryFn: () => api.get<FileResponse>(`/api/memory/file${qs({ path: file.path })}`),
    staleTime: 0,
    gcTime: 0,
  });
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const text = content ?? q.data?.content ?? '';
  const missing = q.data ? !q.data.exists : !file.exists;
  // A file that doesn't exist yet is worth saving the moment there's anything
  // in it, even though nothing has "changed".
  const dirty = content != null && content !== (q.data?.content ?? '');
  const canSave = dirty || (missing && text.length > 0);

  const save = async (force = false) => {
    setSaving(true);
    setErr(null);
    try {
      await api.put('/api/memory/file', {
        path: file.path,
        content: text,
        ...(force ? {} : { baseMtime: q.data?.mtime ?? 0 }),
      });
      queryClient.invalidateQueries({ queryKey: ['memory-tree'] });
      queryClient.invalidateQueries({ queryKey: ['memory-file', file.path] });
      setContent(null);
      onClose();
    } catch (ex) {
      if (ex instanceof ApiError && ex.status === 409) setConflict(true);
      else setErr(ex instanceof Error ? ex.message : String(ex));
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
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] text-ink">{file.name}</span>
              <Badge tone={scopeTone(file.scope)}>{scopeLabel(t, file.scope)}</Badge>
              {missing && <span className="shrink-0 font-mono text-[11px] text-claude/70">{t('run.memoryNewFile')}</span>}
            </div>
            {/* the absolute path, not the group name: with many files called
                CLAUDE.md this is the only unambiguous identifier */}
            <div className="truncate font-mono text-[11px] text-dim" title={file.path}>{file.path}</div>
          </div>
          {dirty && <span className="font-mono text-[11px] text-user">{t('run.unsaved')}</span>}
          <button
            onClick={() => save()}
            disabled={saving || !canSave}
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
        {conflict && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 font-mono text-[11px] text-user">
            <span className="min-w-0 flex-1">{t('run.memoryConflict')}</span>
            <button
              onClick={() => { setConflict(false); save(true); }}
              disabled={saving}
              className="shrink-0 rounded border border-user/50 px-2 py-1 uppercase tracking-wider text-user hover:bg-user/10 disabled:opacity-40"
            >
              {t('run.memoryOverwrite')}
            </button>
          </div>
        )}
        {err && <div className="border-t border-line px-4 py-2 font-mono text-[11px] text-danger">{err}</div>}
      </div>
    </div>
  );
}
