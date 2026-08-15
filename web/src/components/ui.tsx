import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Runs a write and keeps its failure. An `async` function passed straight to
 * onClick reports nothing when it rejects — the click just does nothing, and
 * in cloud mode every local-only write rejects that way — so the UI would
 * happily show an optimistic result that was never persisted.
 *
 * Returns `run` (never rejects), plus `pending` and `error` to render.
 */
export function useWriteAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // keep the latest fn without making `run` a new identity every render
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A) => {
    setPending(true);
    setError(null);
    try {
      await fnRef.current(...args);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: () => setError(null) };
}

/** Inline failure text for a write that did not land. */
export function WriteError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <span role="alert" className="font-mono text-[11px] text-danger" title={error}>
      {error.length > 60 ? `${error.slice(0, 60)}…` : error}
    </span>
  );
}

export function Card({
  title, action, children, className, bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('glass overflow-hidden rounded-xl', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="card-title flex items-center gap-2">
            <span aria-hidden>┌</span>
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label, value, sub, accent, title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'claude' | 'user' | 'none';
  title?: string;
}) {
  return (
    <div className="glass glass-hover relative h-full overflow-hidden rounded-xl px-4 py-3.5" title={title}>
      {accent && accent !== 'none' && (
        <span
          aria-hidden
          className={cn('absolute inset-y-0 left-0 w-0.5', accent === 'claude' ? 'bg-claude' : 'bg-user')}
        />
      )}
      <div className="microlabel">{label}</div>
      <div className="mt-1 font-mono text-[29px] leading-9 font-medium tracking-tight text-ink">
        {/* re-keying on the rendered value pops the number when live data changes */}
        <span key={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined} className="stat-pop inline-block">
          {value}
        </span>
      </div>
      {sub && <div className="mt-0.5 text-xs text-dim">{sub}</div>}
    </div>
  );
}

export function Badge({
  children, tone = 'default', className,
}: {
  children: ReactNode;
  tone?: 'default' | 'claude' | 'user' | 'ok' | 'danger';
  className?: string;
}) {
  const tones = {
    default: 'border-line2 text-mid',
    claude: 'border-claude/40 text-claude',
    user: 'border-user/40 text-user',
    ok: 'border-ok/40 text-ok',
    danger: 'border-danger/40 text-danger',
  } as const;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[11px] uppercase tracking-wider', tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  title, hint, children,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div aria-hidden className="font-mono text-2xl text-line2">∅</div>
      <div className="text-sm text-mid">{title}</div>
      {hint && <div className="max-w-sm text-xs text-dim">{hint}</div>}
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-surface2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={cn(
            'rounded px-3 py-1 font-mono text-[12px] uppercase tracking-wider transition-colors',
            o.value === value ? 'bg-raise text-ink' : 'text-dim hover:text-mid'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-raise', className)}>
      <div className="h-full rounded-full bg-claude transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Two-tone split bar: Claude vs you. */
export function DuoBar({ claudeMs, userMs, className }: { claudeMs: number; userMs: number; className?: string }) {
  const total = claudeMs + userMs;
  if (!total) return <div className={cn('h-1.5 rounded-full bg-raise', className)} />;
  return (
    <div className={cn('flex h-1.5 gap-px overflow-hidden rounded-full bg-raise', className)}>
      <div className="h-full bg-claude" style={{ width: `${(claudeMs / total) * 100}%` }} />
      <div className="h-full bg-user" style={{ width: `${(userMs / total) * 100}%` }} />
    </div>
  );
}

/**
 * Rich hover tooltip for charts — the app-styled replacement for native
 * <title>. Attach hostRef to a `relative` container, call show/hide from
 * pointer events, render {tipEl} last inside the container.
 */
export function useChartTip() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const show = (e: { clientX: number; clientY: number }, content: ReactNode) => {
    const r = hostRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content });
  };
  const hide = () => setTip(null);
  const tipEl = tip ? (
    <div
      className="tip-in pointer-events-none absolute z-30 rounded border border-line2 bg-raise px-2.5 py-1.5 font-mono text-[12px] shadow-xl shadow-black/40"
      style={{
        left: Math.min(tip.x + 12, (hostRef.current?.clientWidth ?? 400) - 260),
        top: tip.y + 14,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { hostRef, show, hide, tipEl };
}

/** Tiny inline bar trend, no axes. Height ~24px; stretches to container. */
export function Sparkline({
  values, color = 'var(--color-claude)', className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  const max = Math.max(...values, 1);
  const n = values.length || 1;
  const W = 100;
  const gap = 1.5;
  const bw = (W - gap * (n - 1)) / n;
  return (
    <svg viewBox={`0 0 ${W} 24`} preserveAspectRatio="none" aria-hidden className={cn('h-6 w-full', className)}>
      {values.map((v, i) => {
        const h = Math.max((v / max) * 22, v > 0 ? 1.5 : 0.75);
        return (
          <rect
            key={i}
            x={i * (bw + gap)} y={24 - h} width={bw} height={h} rx={1}
            style={{ fill: color }}
            opacity={i === n - 1 ? 1 : 0.45}
          />
        );
      })}
    </svg>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="font-mono text-xs text-danger">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="rounded border border-line2 px-3 py-1 font-mono text-[12px] uppercase tracking-wider text-mid hover:text-ink">
          retry
        </button>
      )}
    </div>
  );
}
