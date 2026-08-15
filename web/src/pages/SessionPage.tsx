import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { sessionQuery } from '../lib/queries';
import { SessionDetailView } from '../components/session/SessionDetailView';
import { ErrorState, SkeletonRows } from '../components/ui';

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const q = useQuery(sessionQuery(id ?? null));

  return (
    <div className="fade-up mx-auto w-full max-w-5xl space-y-4 p-5">
      <Link to="/timeline/day" className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-dim hover:text-claude">
        <ArrowLeft size={12} /> timeline
      </Link>
      {q.isLoading && <SkeletonRows n={8} />}
      {q.isError && <ErrorState message={String(q.error)} onRetry={() => q.refetch()} />}
      {q.data && <SessionDetailView detail={q.data} highlightPrompt={params.get('prompt')} />}
    </div>
  );
}
