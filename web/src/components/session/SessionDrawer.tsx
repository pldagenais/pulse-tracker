import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { X, Maximize2 } from 'lucide-react';
import { sessionQuery } from '../../lib/queries';
import { SessionDetailView } from './SessionDetailView';
import { ErrorState, SkeletonRows } from '../ui';

/** Cross-route overlay: `?session=<id>&prompt=<uuid>` opens it over any page. */
export function SessionDrawer() {
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session');
  const promptId = params.get('prompt');
  const q = useQuery(sessionQuery(sessionId));

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('session');
    next.delete('prompt');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!sessionId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (q.data && promptId) {
      setTimeout(() => document.getElementById('highlight-prompt')?.scrollIntoView({ block: 'center' }), 60);
    }
  }, [q.data, promptId]);

  if (!sessionId) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Session detail">
      <div className="absolute inset-0 bg-black/55" onClick={close} />
      <div className="drawer-in absolute inset-y-0 right-0 flex w-[620px] max-w-[92vw] flex-col border-l border-line bg-bg shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-4 py-2.5">
          <span className="microlabel">session detail</span>
          <div className="flex items-center gap-1">
            <Link
              to={`/sessions/${sessionId}`}
              onClick={close}
              className="rounded p-1.5 text-dim hover:bg-raise hover:text-ink"
              title="Open full page"
              aria-label="Open session as full page"
            >
              <Maximize2 size={14} />
            </Link>
            <button
              onClick={close}
              autoFocus
              className="rounded p-1.5 text-dim hover:bg-raise hover:text-ink"
              title="Close (Esc)"
              aria-label="Close session detail"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {q.isLoading && <SkeletonRows n={6} />}
          {q.isError && <ErrorState message={String(q.error)} onRetry={() => q.refetch()} />}
          {/* keyed: the drawer stays mounted across sessions, so without this
              its child state would carry over from the previous one */}
          {q.data && <SessionDetailView key={q.data.session.id} detail={q.data} highlightPrompt={promptId} />}
        </div>
      </div>
    </div>
  );
}
