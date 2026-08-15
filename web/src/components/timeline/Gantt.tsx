/* Day-view gantt: one row per session, grouped under project headers.
 * SVG marks over an HTML label gutter; amber underlay = you active,
 * cyan blocks = Claude working, ticks = prompts, vertical line = now.
 *
 * Interaction state deliberately does NOT live in this component: hover and
 * brush-drag fire at pointer frequency, and a setState here re-renders every
 * mark in the SVG per event. The tooltip owns its own state in a sibling
 * (imperative handle), and the brush paints via direct attribute writes,
 * committing to React state only on pointerup. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSearchParams } from 'react-router';
import { Cloud } from 'lucide-react';
import type { TimelineDay, TimelineSession } from '../../lib/types';
import { dayStartMs, dayEndMs, isToday } from '../../lib/time';
import { projectColor, CLAUDE_COLOR, USER_COLOR } from '../../lib/colors';
import { fmtClock, fmtDuration, plural } from '../../lib/format';
import { useNow } from '../../lib/live';
import { useT } from '../../lib/i18n';
import { Badge } from '../ui';

const ROW_H = 26;
const HEADER_H = 22;
const AXIS_H = 24;
const MIN_ZOOM_MS = 10 * 60_000;

export type LaneMode = 'project' | 'session';

interface Row {
  kind: 'header' | 'session';
  projectId: number;
  label: string;
  worktree?: string | null;
  session?: TimelineSession;
}

export function buildRows(sessions: TimelineSession[], laneMode: LaneMode = 'project', untitled = 'Untitled session'): Row[] {
  if (laneMode === 'session') {
    return [...sessions]
      .sort((a, b) => (a.turns[0]?.start ?? 0) - (b.turns[0]?.start ?? 0))
      .map((s) => ({
        kind: 'session' as const,
        projectId: s.projectId,
        label: `${s.projectName} — ${s.title || s.lastPrompt || untitled}`,
        worktree: s.worktreeBranch,
        session: s,
      }));
  }
  const byProject = new Map<number, { name: string; sessions: TimelineSession[] }>();
  for (const s of sessions) {
    let g = byProject.get(s.parentProjectId ?? s.projectId);
    if (!g) {
      g = { name: s.parentProjectId ? s.projectName.split(' [')[0] : s.projectName, sessions: [] };
      byProject.set(s.parentProjectId ?? s.projectId, g);
    }
    g.sessions.push(s);
  }
  const rows: Row[] = [];
  for (const [pid, g] of byProject) {
    rows.push({ kind: 'header', projectId: pid, label: g.name });
    for (const s of g.sessions.sort((a, b) => (a.turns[0]?.start ?? 0) - (b.turns[0]?.start ?? 0))) {
      rows.push({ kind: 'session', projectId: s.projectId, label: s.title || s.lastPrompt || untitled, worktree: s.worktreeBranch, session: s });
    }
  }
  return rows;
}

export function domainFor(day: TimelineDay, full24: boolean, nowMs: number): [number, number] {
  const a = dayStartMs(day.date);
  const b = dayEndMs(day.date);
  if (full24) return [a, b];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of day.sessions) {
    for (const t of s.turns) {
      lo = Math.min(lo, t.start);
      hi = Math.max(hi, t.end);
    }
    for (const p of s.prompts) {
      lo = Math.min(lo, p.ts);
      hi = Math.max(hi, p.ts);
    }
  }
  if (!Number.isFinite(lo)) return [a, b];
  if (isToday(day.date)) hi = Math.max(hi, nowMs);
  const HOUR = 3600_000;
  lo = Math.max(Math.floor((lo - 30 * 60_000) / HOUR) * HOUR, a);
  hi = Math.min(Math.ceil((hi + 30 * 60_000) / HOUR) * HOUR, b);
  if (hi - lo < 6 * HOUR) {
    const mid = (lo + hi) / 2;
    lo = Math.max(mid - 3 * HOUR, a);
    hi = Math.min(lo + 6 * HOUR, b);
    lo = Math.max(hi - 6 * HOUR, a);
  }
  return [lo, hi];
}

function ticksFor(lo: number, hi: number, width: number): number[] {
  const HOUR = 3600_000;
  const hours = (hi - lo) / HOUR;
  const pxPerHour = width / hours;
  const step = pxPerHour >= 56 ? 1 : pxPerHour >= 28 ? 2 : pxPerHour >= 18 ? 3 : 6;
  const out: number[] = [];
  const start = Math.ceil(lo / HOUR) * HOUR;
  for (let t = start; t <= hi; t += step * HOUR) out.push(t);
  return out;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

export interface TipHandle {
  show: (e: React.PointerEvent, content: ReactNode) => void;
  hide: () => void;
}

/**
 * Tooltip layer with its own state, so hovering a mark re-renders THIS tiny
 * component instead of the whole SVG above it.
 */
const TipLayer = forwardRef<TipHandle, { hostRef: RefObject<HTMLDivElement | null> }>(
  function TipLayer({ hostRef }, ref) {
    const [tip, setTip] = useState<Tip | null>(null);
    useImperativeHandle(
      ref,
      () => ({
        show: (e, content) => {
          const host = hostRef.current?.getBoundingClientRect();
          if (host) setTip({ x: e.clientX - host.left, y: e.clientY - host.top, content });
        },
        hide: () => setTip(null),
      }),
      [hostRef]
    );
    if (!tip) return null;
    return (
      <div
        className="tip-in pointer-events-none absolute z-30 rounded border border-line2 bg-raise px-2.5 py-1.5 font-mono text-[12px] shadow-xl shadow-black/40"
        style={{
          left: Math.min(tip.x + 14, (hostRef.current?.clientWidth ?? 600) - 320),
          top: tip.y + 14,
        }}
      >
        {tip.content}
      </div>
    );
  }
);

/** Measured pixel width so the SVG renders 1:1 — scaling a viewBox with
 * preserveAspectRatio="none" would distort every text glyph. */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Gantt({ day, full24, laneMode = 'project' }: { day: TimelineDay; full24: boolean; laneMode?: LaneMode }) {
  const now = useNow(30_000);
  const [, setParams] = useSearchParams();
  const { t, tf } = useT();
  const tipRef = useRef<TipHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildRows(day.sessions, laneMode, t('timeline.untitledSession')), [day.sessions, laneMode, t]);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  useEffect(() => setZoom(null), [day.date]);
  const fitDomain = useMemo(() => domainFor(day, full24, now), [day, full24, now]);
  const [lo, hi] = zoom ?? fitDomain;

  const [plotRef, plotW] = useElementWidth<HTMLDivElement>();
  const PAD = 6; // keep edge tick labels unclipped
  const W = Math.max(plotW, 320);
  const x = (t: number) => PAD + ((t - lo) / (hi - lo)) * (W - PAD * 2);
  const timeOf = (px: number) => lo + ((px - PAD) / (W - PAD * 2)) * (hi - lo);
  const ticks = ticksFor(lo, hi, W);
  const bodyH = rows.reduce((h, r) => h + (r.kind === 'header' ? HEADER_H : ROW_H), 0);

  /* Brush-zoom: drag state in a ref, painted by direct attribute writes.
   * The old version measured getBoundingClientRect() AND setState on every
   * pointermove — a forced layout followed by a full SVG re-render, at
   * pointer-event frequency. The svg's left edge is cached at pointerdown. */
  const dragRef = useRef<{ start: number; cur: number; svgLeft: number } | null>(null);
  const dragMoved = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const brushRef = useRef<SVGGElement>(null);
  const brushFill = useRef<SVGRectElement>(null);
  const brushL = useRef<SVGLineElement>(null);
  const brushR = useRef<SVGLineElement>(null);

  const paintBrush = () => {
    const d = dragRef.current;
    const g = brushRef.current;
    if (!g) return;
    if (!d || Math.abs(d.cur - d.start) <= 2) {
      g.setAttribute('visibility', 'hidden');
      return;
    }
    const x1 = Math.min(d.start, d.cur);
    const x2 = Math.max(d.start, d.cur);
    g.setAttribute('visibility', 'visible');
    brushFill.current?.setAttribute('x', String(x1));
    brushFill.current?.setAttribute('width', String(x2 - x1));
    brushL.current?.setAttribute('x1', String(x1));
    brushL.current?.setAttribute('x2', String(x1));
    brushR.current?.setAttribute('x1', String(x2));
    brushR.current?.setAttribute('x2', String(x2));
  };

  const onPlotPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragMoved.current = false;
    // one measurement per drag, not one per move
    const left = svgRef.current?.getBoundingClientRect().left ?? 0;
    const px = Math.max(0, Math.min(e.clientX - left, W));
    dragRef.current = { start: px, cur: px, svgLeft: left };
    e.currentTarget.setPointerCapture(e.pointerId);
    paintBrush();
  };
  const onPlotPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    d.cur = Math.max(0, Math.min(e.clientX - d.svgLeft, W));
    paintBrush();
  };
  const onPlotPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    const dist = Math.abs(d.cur - d.start);
    // < 6px = click, let the mark's own handler run; otherwise suppress it
    if (dist >= 6) dragMoved.current = true;
    if (dist > 12) {
      let t1 = timeOf(Math.min(d.start, d.cur));
      let t2 = timeOf(Math.max(d.start, d.cur));
      if (t2 - t1 < MIN_ZOOM_MS) {
        const mid = (t1 + t2) / 2;
        t1 = mid - MIN_ZOOM_MS / 2;
        t2 = mid + MIN_ZOOM_MS / 2;
      }
      setZoom([t1, t2]); // the ONLY state commit of the whole gesture
    }
    dragRef.current = null;
    paintBrush();
  };
  const onPlotPointerCancel = () => {
    dragRef.current = null;
    paintBrush();
  };

  const openSession = (id: string, promptUuid?: string | null) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('session', id);
      if (promptUuid) next.set('prompt', promptUuid);
      else next.delete('prompt');
      return next;
    });
  };

  const showTip = useCallback((e: React.PointerEvent, content: ReactNode) => {
    tipRef.current?.show(e, content);
  }, []);
  const hideTip = useCallback(() => tipRef.current?.hide(), []);

  let yCursor = 0;

  return (
    <div ref={scrollRef} className="relative">
      <div className="grid grid-cols-[210px_1fr]">
        {/* label gutter — padding mirrors the SVG axis height exactly */}
        <div className="border-r border-line" style={{ paddingTop: AXIS_H }}>
          {rows.map((r, i) =>
            r.kind === 'header' ? (
              <div key={i} className="flex items-center gap-1.5 px-2" style={{ height: HEADER_H }}>
                <span className="h-2 w-2 rounded-sm" style={{ background: projectColor(r.projectId) }} />
                <span className="microlabel truncate !text-mid">{r.label}</span>
              </div>
            ) : (
              <button
                key={i}
                onClick={() => openSession(r.session!.sessionId)}
                className="flex w-full items-center gap-1.5 px-2 pl-5 text-left hover:bg-surface2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-claude/60"
                style={{ height: ROW_H }}
                title={r.worktree ? tf('timeline.cloudWorktreeTitle', { label: r.label, worktree: r.worktree }) : r.label}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-mid">{r.label}</span>
                {r.worktree && <Cloud size={10} className="shrink-0 text-claude/70" aria-hidden />}
                {r.worktree && <Badge className="max-w-[96px] shrink-0 truncate">{r.worktree}</Badge>}
              </button>
            )
          )}
        </div>

        {/* plot */}
        <div ref={plotRef} className="relative min-w-0">
          {zoom && (
            <button
              onClick={() => setZoom(null)}
              className="absolute right-1.5 top-1 z-20 rounded border border-line bg-raise px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude"
            >
              {t('timeline.resetZoom')}
            </button>
          )}
          <svg
            ref={svgRef}
            width={W} height={AXIS_H + bodyH} viewBox={`0 0 ${W} ${AXIS_H + bodyH}`}
            className="block select-none"
            style={{ touchAction: 'none' }}
            onPointerDown={onPlotPointerDown}
            onPointerMove={onPlotPointerMove}
            onPointerUp={onPlotPointerUp}
            onPointerCancel={onPlotPointerCancel}
            onDoubleClick={() => setZoom(null)}
            onClickCapture={(e) => {
              if (dragMoved.current) {
                e.stopPropagation();
                e.preventDefault();
                dragMoved.current = false;
              }
            }}
          >
            {/* axis + gridlines */}
            {ticks.map((t) => (
              <g key={t}>
                <text
                  x={x(t)} y={14}
                  textAnchor={x(t) < 24 ? 'start' : x(t) > W - 24 ? 'end' : 'middle'}
                  fontSize={10} className="fill-dim font-mono"
                >
                  {fmtClock(t)}
                </text>
                <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={AXIS_H + bodyH} className="stroke-line" strokeWidth={1} />
              </g>
            ))}

            {rows.map((r, i) => {
              const y = AXIS_H + yCursor;
              yCursor += r.kind === 'header' ? HEADER_H : ROW_H;
              if (r.kind === 'header') {
                return <rect key={i} x={0} y={y} width={W} height={HEADER_H} className="fill-surface2/40" />;
              }
              const s = r.session!;
              const mid = y + ROW_H / 2;
              return (
                <g key={i}>
                  {/* row separator */}
                  <line x1={0} x2={W} y1={y + ROW_H} y2={y + ROW_H} className="stroke-line/50" strokeWidth={1} />
                  {/* you-active underlay */}
                  {s.activeGaps.map((g, gi) => (
                    <rect
                      key={`g${gi}`}
                      x={x(g.start)} y={mid - 8} width={Math.max(x(g.end) - x(g.start), 1)} height={16}
                      style={{ fill: USER_COLOR }} opacity={0.22} rx={2}
                      onPointerEnter={(e) => showTip(e, (
                        <>
                          <div className="text-user">{t('timeline.youActive')}</div>
                          <div>{fmtClock(g.start)}–{fmtClock(g.end)} · {fmtDuration(g.end - g.start)}</div>
                        </>
                      ))}
                      onPointerLeave={hideTip}
                    />
                  ))}
                  {/* claude turn blocks */}
                  {s.turns.map((tn, ti) => (
                    <g key={`t${ti}`}>
                      <rect
                        x={x(tn.start)} y={mid - 6} width={Math.max(x(tn.end) - x(tn.start), 2.5)} height={12}
                        style={{ fill: CLAUDE_COLOR }} rx={2.5}
                        opacity={0.92}
                        className="cursor-pointer hover:opacity-100"
                        onClick={() => openSession(s.sessionId, tn.promptUuid)}
                        onPointerEnter={(e) => showTip(e, (
                          <>
                            <div className="text-claude">{t('timeline.claudeWorking')} · {fmtDuration(tn.claudeMs)}</div>
                            <div className="text-dim">{fmtClock(tn.start)}–{fmtClock(tn.end)} · {plural(tn.toolUseCount, 'tool call')}</div>
                            {tn.promptText && <div className="mt-1 max-w-[280px] truncate text-ink/80">“{tn.promptText.slice(0, 140)}”</div>}
                          </>
                        ))}
                        onPointerLeave={hideTip}
                      />
                      {tn.contLeft && <text x={x(tn.start) - 2} y={mid + 3.5} fontSize={9} textAnchor="end" style={{ fill: CLAUDE_COLOR }}>‹</text>}
                      {tn.contRight && <text x={x(tn.end) + 2} y={mid + 3.5} fontSize={9} style={{ fill: CLAUDE_COLOR }}>›</text>}
                    </g>
                  ))}
                  {/* prompt ticks — visible mark is 2px; the hit target is 12px */}
                  {s.prompts.map((p) => (
                    <g key={p.uuid}>
                      <rect x={x(p.ts) - 1} y={mid - 11} width={2} height={5} style={{ fill: USER_COLOR }} pointerEvents="none" />
                      <rect
                        x={x(p.ts) - 6} y={mid - 13} width={12} height={10}
                        fill="transparent"
                        className="cursor-pointer"
                        onClick={() => openSession(s.sessionId, p.uuid)}
                        onPointerEnter={(e) => showTip(e, (
                          <>
                            <div className="text-user">{fmtClock(p.ts)} · prompt</div>
                            <div className="mt-0.5 max-w-[280px] truncate text-ink/80">“{p.text.slice(0, 140)}”</div>
                          </>
                        ))}
                        onPointerLeave={hideTip}
                      />
                    </g>
                  ))}
                </g>
              );
            })}

            {/* brush selection — always mounted; x/width painted imperatively
                during the drag so pointermove never re-renders the SVG */}
            <g ref={brushRef} pointerEvents="none" visibility="hidden">
              <rect ref={brushFill} x={0} y={AXIS_H} width={0} height={bodyH} style={{ fill: CLAUDE_COLOR }} opacity={0.08} />
              <line ref={brushL} x1={0} x2={0} y1={AXIS_H} y2={AXIS_H + bodyH} style={{ stroke: CLAUDE_COLOR }} strokeWidth={1} opacity={0.5} />
              <line ref={brushR} x1={0} x2={0} y1={AXIS_H} y2={AXIS_H + bodyH} style={{ stroke: CLAUDE_COLOR }} strokeWidth={1} opacity={0.5} />
            </g>

            {/* now line */}
            {isToday(day.date) && now >= lo && now <= hi && (
              <g>
                <line x1={x(now)} x2={x(now)} y1={AXIS_H - 6} y2={AXIS_H + bodyH} style={{ stroke: CLAUDE_COLOR }} strokeWidth={1} strokeDasharray="2 3" />
                <circle cx={x(now)} cy={AXIS_H - 6} r={2.5} style={{ fill: CLAUDE_COLOR }} className="pulse-dot" />
              </g>
            )}
          </svg>
        </div>
      </div>

      <TipLayer ref={tipRef} hostRef={scrollRef} />

      {/* legend */}
      <div className="mt-3 flex items-center gap-4 border-t border-line pt-2.5 font-mono text-[11px] uppercase tracking-wider text-dim">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm" style={{ background: CLAUDE_COLOR }} /> {t('timeline.claudeWorking')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm" style={{ background: USER_COLOR, opacity: 0.4 }} /> {t('timeline.youActive')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-0.5" style={{ background: USER_COLOR }} /> prompt</span>
        <span className="flex items-center gap-1.5"><Cloud size={10} className="text-claude/70" aria-hidden /> {t('timeline.cloudWorktreeSession')}</span>
      </div>
    </div>
  );
}
