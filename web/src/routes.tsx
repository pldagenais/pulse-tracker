import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'));
const SessionPage = lazy(() => import('./pages/SessionPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const JournalPage = lazy(() => import('./pages/JournalPage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const DigestPage = lazy(() => import('./pages/DigestPage'));
const ReportPage = lazy(() => import('./pages/ReportPage'));
const RunPage = lazy(() => import('./pages/RunPage'));
const MissionPage = lazy(() => import('./pages/MissionPage'));
const ManagePage = lazy(() => import('./pages/ManagePage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));

const page = (el: React.ReactNode) => (
  <Suspense fallback={<div className="p-8 text-dim font-mono text-xs">loading…</div>}>{el}</Suspense>
);

/** Route-level crash screen: never a blank page, always a way back. */
function RouteError() {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md rounded-lg border border-line bg-surface p-6 text-center">
        <div className="font-mono text-2xl text-danger">▌</div>
        <h1 className="mt-2 font-display text-base font-medium text-ink">Something broke on this page</h1>
        <p className="mt-1.5 text-xs leading-5 text-dim">
          Usually this means the app was updated while this tab was open. A reload picks up the new version.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md border border-claude/50 bg-claude/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-claude hover:bg-claude/20"
        >
          reload app
        </button>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'timeline', element: <Navigate to="/timeline/day" replace /> },
      { path: 'timeline/:view', element: page(<TimelinePage />) },
      { path: 'projects', element: page(<ProjectsPage />) },
      { path: 'projects/:id', element: page(<ProjectDetailPage />) },
      { path: 'sessions/:id', element: page(<SessionPage />) },
      { path: 'prompts', element: page(<PromptsPage />) },
      { path: 'insights', element: page(<InsightsPage />) },
      { path: 'journal', element: page(<JournalPage />) },
      { path: 'digest', element: page(<DigestPage />) },
      { path: 'report', element: page(<ReportPage />) },
      { path: 'run', element: page(<RunPage />) },
      { path: 'mission', element: page(<MissionPage />) },
      { path: 'manage', element: page(<ManagePage />) },
      { path: 'compare', element: page(<ComparePage />) },
      { path: 'status', element: page(<StatusPage />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
