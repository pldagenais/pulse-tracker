const SHORTCUTS: [string, string][] = [
  ['Ctrl+K', 'Command palette — jump anywhere'],
  ['?', 'This help'],
  ['Esc', 'Close dialogs and drawers'],
  ['/', 'Focus search (Prompts page)'],
  ['← / →', 'Previous / next period (Timeline)'],
  ['d · w · m', 'Day / Week / Month view (Timeline)'],
  ['t', 'Jump to today (Timeline)'],
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="glass-strong drawer-in absolute left-1/2 top-1/2 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5">
        <div className="microlabel mb-3">keyboard shortcuts</div>
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map(([key, desc]) => (
              <tr key={key}>
                <td className="py-1.5 pr-4">
                  <kbd className="rounded border border-line2 bg-surface2 px-1.5 py-0.5 font-mono text-[12px] text-ink">{key}</kbd>
                </td>
                <td className="py-1.5 text-[14px] text-mid">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded border border-line py-1.5 font-mono text-[12px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
        >
          close
        </button>
      </div>
    </div>
  );
}
