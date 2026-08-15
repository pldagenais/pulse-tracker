import { useT } from '../../lib/i18n';
import type { MsgKey } from '../../i18n';

const SHORTCUTS: [string, MsgKey][] = [
  ['Ctrl+K', 'shortcuts.palette'],
  ['?', 'shortcuts.help'],
  ['Esc', 'shortcuts.close'],
  ['/', 'shortcuts.search'],
  ['← / →', 'shortcuts.period'],
  ['d · w · m', 'shortcuts.views'],
  ['t', 'shortcuts.today'],
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={t('shortcuts.aria')}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="glass-strong drawer-in absolute left-1/2 top-1/2 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5">
        <div className="microlabel mb-3">{t('shortcuts.title')}</div>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map(([key, descKey]) => (
              <tr key={key}>
                <td className="py-1.5 pr-4">
                  <kbd className="rounded border border-line2 bg-surface2 px-1.5 py-0.5 font-mono text-[12px] text-ink">{key}</kbd>
                </td>
                <td className="py-1.5 text-[14px] text-mid">{t(descKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded border border-line py-1.5 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
        >
          {t('shortcuts.closeBtn')}
        </button>
      </div>
    </div>
  );
}
