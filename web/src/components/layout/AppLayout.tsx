import { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, CalendarDays, FolderGit2, MessagesSquare, TrendingUp, BookOpen, Activity, Search, FileText, Sun, Moon, Rocket, Radar, Wrench,
} from 'lucide-react';
import { useTheme } from '../../lib/theme';
import { useLocale, useT } from '../../lib/i18n';
import { LivePill } from './LivePill';
import { AlertBell } from './AlertBell';
import { OfflineBanner } from './OfflineBanner';
import { MODE } from '../../lib/source';
import { CommandPalette } from './CommandPalette';
import { ShortcutHelp } from './ShortcutHelp';
import { useCompletionNotifier } from './notifier';
import { SessionDrawer } from '../session/SessionDrawer';
import { useLiveSelector } from '../../lib/live';
import { ProgressBar } from '../ui';
import { cn } from '../../lib/cn';
import { fmtBytes } from '../../lib/format';
import { todayKey, addDays, addMonths } from '../../lib/time';

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/mission', key: 'nav.mission', icon: Radar },
  { to: '/timeline/day', key: 'nav.timeline', icon: CalendarDays, match: '/timeline' },
  { to: '/projects', key: 'nav.projects', icon: FolderGit2 },
  { to: '/prompts', key: 'nav.prompts', icon: MessagesSquare },
  { to: '/insights', key: 'nav.insights', icon: TrendingUp },
  { to: '/report', key: 'nav.report', icon: FileText },
  { to: '/run', key: 'nav.run', icon: Rocket },
  { to: '/manage', key: 'nav.manage', icon: Wrench },
  { to: '/journal', key: 'nav.journal', icon: BookOpen },
] as const;

const TITLES = [
  ['/mission', 'nav.mission'],
  ['/timeline', 'nav.timeline'],
  ['/projects', 'nav.projects'],
  ['/sessions', 'nav.session'],
  ['/prompts', 'nav.prompts'],
  ['/insights', 'nav.insights'],
  ['/report', 'nav.reportTitle'],
  ['/run', 'nav.runTitle'],
  ['/manage', 'nav.manageTitle'],
  ['/compare', 'nav.compare'],
  ['/journal', 'nav.journal'],
  ['/digest', 'nav.digestTitle'],
  ['/status', 'nav.status'],
] as const;

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Selected, not useLive(): the full session list changes several times a
  // second while Claude works, and the whole shell re-rendered with it. The
  // shell only needs the two badge counts and the ingest banner.
  const { ingest, needsYou, working } = useLiveSelector((s) => ({
    ingest: s.ingest,
    needsYou: s.sessions.filter((x) => x.status === 'needs-you').length,
    working: s.sessions.filter((x) => x.status === 'working').length,
  }));
  const { theme, toggle: toggleTheme } = useTheme();
  const [loc, setLoc] = useLocale();
  const { t, tf } = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const fetching = useIsFetching();
  useCompletionNotifier();

  // installed-PWA taskbar badge: sessions needing attention, else working count
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    const n = needsYou > 0 ? needsYou : working;
    (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => { /* unsupported */ });
  }, [needsYou, working]);

  const title = t(TITLES.find(([p]) => location.pathname.startsWith(p))?.[1] ?? 'nav.dashboard');
  const indexing = ingest && (ingest.phase === 'backfill' || ingest.phase === 'rescan') && ingest.filesTotal > 0;

  // SPA route changes are invisible to a screen reader: the h1 swaps silently
  // and focus stays wherever it was. Announce the page and land focus on main.
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false; // initial load announces the document title already
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // Global keyboard layer. Single-letter shortcuts never fire while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (location.pathname.startsWith('/timeline')) {
        const view = location.pathname.split('/')[2] ?? 'day';
        const params = new URLSearchParams(location.search);
        const date = params.get('date') ?? todayKey();
        const go = (v: string, d: string) => navigate(`/timeline/${v}?date=${d}`);
        const step = (dir: 1 | -1) =>
          view === 'day' ? addDays(date, dir) : view === 'week' ? addDays(date, 7 * dir) : addMonths(date, dir);
        if (e.key === 'ArrowLeft') go(view, step(-1));
        else if (e.key === 'ArrowRight' && date < todayKey()) go(view, step(1));
        else if (e.key === 't') go(view, todayKey());
        else if (e.key === 'd' || e.key === 'w' || e.key === 'm') {
          go({ d: 'day', w: 'week', m: 'month' }[e.key]!, date);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location, navigate]);

  return (
    <div className="grid h-full grid-cols-[56px_1fr] lg:grid-cols-[212px_1fr] print:block">
      <aside className="flex flex-col border-r border-[var(--glass-border)] bg-[var(--glass-bg-strong)] print:hidden">
        <div className="border-b border-line px-4 py-4">
          <div className="font-display text-lg font-semibold tracking-tight text-ink">
            <span className="hidden lg:inline">Pulse</span><span className="text-claude">▌</span>
          </div>
          <div className="microlabel mt-0.5 hidden lg:block">{t('shell.appName')}</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {/* Manage drives local processes and files — meaningless remotely */}
          {NAV.filter((n) => MODE === 'local' || n.to !== '/manage').map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={"end" in n && n.end}
              title={t(n.key)}
              className={({ isActive }) =>
                cn(
                  'flex items-center justify-center gap-2.5 rounded px-2.5 py-2 text-[14px] transition-colors lg:justify-start',
                  isActive || ('match' in n && location.pathname.startsWith(n.match))
                    ? 'bg-raise text-ink'
                    : 'text-mid hover:bg-surface2 hover:text-ink'
                )
              }
            >
              <n.icon size={15} strokeWidth={1.8} className="shrink-0 opacity-80" />
              <span className="hidden lg:inline">{t(n.key)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-2">
          <NavLink
            to="/status"
            title={t('nav.status')}
            className={({ isActive }) =>
              cn(
                'flex items-center justify-center gap-2.5 rounded px-2.5 py-2 text-[14px] lg:justify-start',
                isActive ? 'bg-raise text-ink' : 'text-dim hover:bg-surface2 hover:text-mid'
              )
            }
          >
            <Activity size={15} strokeWidth={1.8} />
            <span className="hidden lg:inline">{t('nav.status')}</span>
          </NavLink>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-5 print:hidden">
          {fetching > 0 && <div className="loading-bar" aria-hidden />}
          <h1 className="font-display text-[15px] font-medium text-ink">{title}</h1>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label={t('shell.openPalette')}
              className="flex items-center gap-2 rounded-full border border-line bg-surface2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-mid"
            >
              <Search size={11} />
              <kbd>ctrl k</kbd>
            </button>
            <button
              onClick={() => setLoc(loc === 'en' ? 'fr' : 'en')}
              aria-label={t('shell.language')}
              title={loc === 'en' ? 'Français' : 'English'}
              className="flex h-8 items-center justify-center rounded-full border border-line bg-surface2 px-2.5 font-mono text-[11px] uppercase tracking-wider text-dim hover:text-mid"
            >
              {loc === 'en' ? 'fr' : 'en'}
            </button>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('shell.switchToLight') : t('shell.switchToDark')}
              title={theme === 'dark' ? t('shell.lightTheme') : t('shell.darkTheme')}
              className="theme-flip flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface2 text-dim hover:text-mid"
            >
              {theme === 'dark' ? <Sun size={13} key="sun" /> : <Moon size={13} key="moon" />}
            </button>
            <AlertBell />
            <LivePill />
          </div>
        </header>
        <OfflineBanner />
        {/* page-change announcement: content changes trigger polite SRs */}
        <span role="status" aria-live="polite" className="sr-only">
          {title}
        </span>
        {indexing && ingest && (
          <div className="border-b border-line bg-surface2 px-5 py-2 print:hidden">
            {/* announced per 10%, not per file — a firehose would drown everything else */}
            <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {tf('shell.indexingPercent', { pct: Math.floor((ingest.filesDone / Math.max(ingest.filesTotal, 1)) * 10) * 10 })}
            </span>
            <div className="flex items-center justify-between font-mono text-[12px] text-mid">
              <span>
                {tf('shell.indexingHistory', { done: ingest.filesDone, total: ingest.filesTotal })}
                {ingest.bytesTotal > 0 && ` · ${tf('shell.bytesOf', { done: fmtBytes(ingest.bytesDone), total: fmtBytes(ingest.bytesTotal) })}`}
              </span>
              <span className="text-claude">{Math.round((ingest.filesDone / Math.max(ingest.filesTotal, 1)) * 100)}%</span>
            </div>
            <ProgressBar value={ingest.filesDone} max={Math.max(ingest.filesTotal, 1)} className="mt-1.5" />
          </div>
        )}
        <main ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none print:overflow-visible">
          <Outlet />
        </main>
      </div>
      <SessionDrawer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
