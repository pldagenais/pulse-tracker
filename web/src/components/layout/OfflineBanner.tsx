import { CloudOff } from 'lucide-react';
import { useLiveSelector } from '../../lib/live';
import { MODE } from '../../lib/source';
import { fmtRelative } from '../../lib/format';
import { useT } from '../../lib/i18n';

/**
 * Cloud mode only: the mirror keeps serving data while the PC sleeps, so say
 * plainly how old it is rather than pretending it is live.
 *
 * Driven by the live store — the same 15s heartbeat poll that flips the pill
 * to "PC offline" — so the banner and the pill can never disagree. (An earlier
 * version ran its own 60s query and lagged the pill by up to a minute.)
 */
export function OfflineBanner() {
  const { connection, staleSince } = useLiveSelector((s) => ({
    connection: s.connection,
    staleSince: s.staleSince,
  }));
  const { t, tf } = useT();

  if (MODE !== 'cloud' || connection !== 'stale') return null;

  return (
    <div role="alert" className="flex items-center gap-2 border-b border-user/40 bg-user/10 px-5 py-2 font-mono text-[12px] text-user">
      <CloudOff size={13} />
      {staleSince ? tf('offline.banner', { when: fmtRelative(staleSince) }) : t('offline.bannerNoTime')}
    </div>
  );
}
