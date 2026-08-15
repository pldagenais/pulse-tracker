import { useQuery } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { api } from '../../lib/api';
import { MODE } from '../../lib/source';
import { fmtRelative } from '../../lib/format';

const STALE_MS = 120_000;

/**
 * Cloud mode only: the mirror keeps serving data while the PC sleeps, so say
 * plainly how old it is rather than pretending it is live.
 */
export function OfflineBanner() {
  const q = useQuery({
    queryKey: ['agent-heartbeat'],
    // not /api/status: that returns null until the status snapshot has synced,
    // and the banner has to work in exactly that situation
    queryFn: () => api.get<{ lastHeartbeatAt: number | null } | null>('/api/heartbeat'),
    refetchInterval: 60_000,
    enabled: MODE === 'cloud',
  });

  if (MODE !== 'cloud') return null;
  const last = q.data?.lastHeartbeatAt;
  if (!last || Date.now() - last < STALE_MS) return null;

  return (
    <div className="flex items-center gap-2 border-b border-user/40 bg-user/10 px-5 py-2 font-mono text-[12px] text-user">
      <CloudOff size={13} />
      Your PC is offline — showing data as of {fmtRelative(last)}.
    </div>
  );
}
