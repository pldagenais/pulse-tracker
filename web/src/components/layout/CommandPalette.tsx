import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Search, LayoutDashboard, CalendarDays, FolderGit2, MessagesSquare, TrendingUp,
  BookOpen, Activity, FileText, Clock,
} from 'lucide-react';
import { projectsQuery, sessionsQuery } from '../../lib/queries';
import { projectColor } from '../../lib/colors';
import { fmtRelative } from '../../lib/format';
import { cn } from '../../lib/cn';

interface Item {
  id: string;
  label: string;
  sub?: string;
  icon: ReactNode;
  run: () => void;
}

const PAGES: { label: string; to: string; icon: ReactNode }[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={14} /> },
  { label: 'Timeline · Day', to: '/timeline/day', icon: <CalendarDays size={14} /> },
  { label: 'Timeline · Week', to: '/timeline/week', icon: <CalendarDays size={14} /> },
  { label: 'Timeline · Month', to: '/timeline/month', icon: <CalendarDays size={14} /> },
  { label: 'Projects', to: '/projects', icon: <FolderGit2 size={14} /> },
  { label: 'Prompts', to: '/prompts', icon: <MessagesSquare size={14} /> },
  { label: 'Insights', to: '/insights', icon: <TrendingUp size={14} /> },
  { label: 'Journal', to: '/journal', icon: <BookOpen size={14} /> },
  { label: 'Weekly digest', to: '/digest', icon: <FileText size={14} /> },
  { label: 'Project report', to: '/report', icon: <FileText size={14} /> },
  { label: 'Status', to: '/status', icon: <Activity size={14} /> },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const projects = useQuery({ ...projectsQuery(), enabled: open });
  const sessions = useQuery({ ...sessionsQuery({ pageSize: 100 }), enabled: open });

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    const all: Item[] = [
      ...PAGES.map((p) => ({ id: `page:${p.to}`, label: p.label, sub: 'page', icon: p.icon, run: go(p.to) })),
      ...(projects.data ?? [])
        .filter((p) => p.parentProjectId == null)
        .map((p) => ({
          id: `proj:${p.id}`,
          label: p.name,
          sub: 'project',
          icon: <span className="h-2 w-2 rounded-sm" style={{ background: projectColor(p.id) }} />,
          run: go(`/projects/${p.id}`),
        })),
      ...(sessions.data?.rows ?? []).map((s) => ({
        id: `sess:${s.id}`,
        label: s.title ?? s.lastPrompt ?? s.firstPrompt ?? 'Untitled session',
        sub: `${s.projectName} · ${fmtRelative(s.startedAt)}`,
        icon: <Clock size={13} className="text-dim" />,
        run: go(`/sessions/${s.id}`),
      })),
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 12);
    return all
      .filter((i) => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, projects.data, sessions.data, navigate, onClose]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="glass-strong drawer-in absolute left-1/2 top-24 w-[560px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="shrink-0 text-dim" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === 'Enter') {
                items[sel]?.run();
              }
            }}
            placeholder="Jump to a page, project, or session…"
            className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-dim"
          />
          <kbd className="rounded border border-line2 px-1.5 py-0.5 font-mono text-[11px] text-dim">esc</kbd>
        </div>
        <ul className="max-h-[380px] overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-dim">No matches.</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              <button
                onClick={it.run}
                onPointerEnter={() => setSel(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left',
                  i === sel ? 'bg-raise text-ink' : 'text-mid'
                )}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{it.label}</span>
                {it.sub && <span className="shrink-0 font-mono text-[11px] text-dim">{it.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
