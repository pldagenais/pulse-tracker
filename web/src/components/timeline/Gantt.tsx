/* Day-view gantt: one row per session, grouped under project headers.
 * SVG marks over an HTML label gutter; amber underlay = you active,
 * cyan blocks = Claude working, ticks = prompts, vertical line = now. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Cloud } from 'lucide-react';
import type { TimelineDay, TimelineSession } from '../../lib/types';
import { dayStartMs, dayEndMs, isToday } from '../../lib/time';
import { projectColor, CLAUDE_COLOR, USER_COLOR } from '../../lib/colors';
import { fmtClock, fmtDuration, plural } from '../../lib/format';
import { useNow } from '../../lib/live';
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

export function buildRows(sessions: TimelineSession[], laneMode: LaneMode = 'project'): Row[] {
  if (laneMode === 'session') {
    return [...sessions]
      .sort((a, b) => (a.turns[0]?.start ?? 0) - (b.turns[0]?.start ?? 0))
      .map((s) => ({
        kind: 'session' as const,
        projectId: s.projectId,
        label: `${s.projectName} — ${s.title || s.lastPrompt || 'Untitled session'}`,
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
      rows.push({ kind: 'session', projectId: s.projectId, label: s.title || s.lastPrompt || 'Untitled session', worktree: s.worktreeBranch, session: s });
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
  const [tip, setTip] = useState<Tip | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildRows(day.sessions, laneMode), [day.sessions, laneMode]);
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

  /* brush-zoom drag state — px coords within the svg */
  const [drag, setDrag] = useState<{ start: number; cur: number } | null>(null);
  const dragMoved = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const svgX = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? Math.max(0, Math.min(e.clientX - r.left, W)) : 0;
  };
  const onPlotPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragMoved.current = false;
    setDrag({ start: svgX(e), cur: svgX(e) });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPlotPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    setDrag({ start: drag.start, cur: svgX(e) });
  };
  const onPlotPointerUp = () => {
    if (!drag) return;
    const dist = Math.abs(drag.cur - drag.start);
    // < 6px = click, let the mark's own handler run; otherwise suppress it
    if (dist >= 6) dragMoved.current = true;
    if (dist > 12) {
      let t1 = timeOf(Math.min(drag.start, drag.cur));
      let t2 = timeOf(Math.max(drag.start, drag.cur));
      if (t2 - t1 < MIN_ZOOM_MS) {
        const mid = (t1 + t2) / 2;
        t1 = mid - MIN_ZOOM_MS / 2;
        t2 = mid + MIN_ZOOM_MS / 2;
      }
      setZoom([t1, t2]);
    }
    setDrag(null);
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

  const showTip = (e: React.PointerEvent, content: ReactNode) => {
    const host = scrollRef.current?.getBoundingClientRect();
    if (!host) return;
    setTip({ x: e.clientX - host.left, y: e.clientY - host.top, content });
  };

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
                title={r.worktree ? `${r.label} · ${r.worktree} · cloud worktree session` : r.label}
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
              reset zoom
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
            onPointerCancel={() => setDrag(null)}
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
                          <div className="text-user">you active</div>
                          <div>{fmtClock(g.start)}–{fmtClock(g.end)} · {fmtDuration(g.end - g.start)}</div>
                        </>
                      ))}
                      onPointerLeave={() => setTip(null)}
                    />
                  ))}
                  {/* claude turn blocks */}
                  {s.turns.map((t, ti) => (
                    <g key={`t${ti}`}>
                      <rect
                        x={x(t.start)} y={mid - 6} width={Math.max(x(t.end) - x(t.start), 2.5)} height={12}
                        style={{ fill: CLAUDE_COLOR }} rx={2.5}
                        opacity={0.92}
                        className="cursor-pointer hover:opacity-100"
                        onClick={() => openSession(s.sessionId, t.promptUuid)}
                        onPointerEnter={(e) => showTip(e, (
                          <>
                            <div className="text-claude">claude working · {fmtDuration(t.claudeMs)}</div>
                            <div className="text-dim">{fmtClock(t.start)}–{fmtClock(t.end)} · {plural(t.toolUseCount, 'tool call')}</div>
                            {t.promptText && <div className="mt-1 max-w-[280px] truncate text-ink/80">“{t.promptText.slice(0, 140)}”</div>}
                          </>
                        ))}
                        onPointerLeave={() => setTip(null)}
                      />
                      {t.contLeft && <text x={x(t.start) - 2} y={mid + 3.5} fontSize={9} textAnchor="end" style={{ fill: CLAUDE_COLOR }}>‹</text>}
                      {t.contRight && <text x={x(t.end) + 2} y={mid + 3.5} fontSize={9} style={{ fill: CLAUDE_COLOR }}>›</text>}
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
                        onPointerLeave={() => setTip(null)}
                      />
                    </g>
                  ))}
                </g>
              );
            })}

            {/* brush selection */}
            {drag && Math.abs(drag.cur - drag.start) > 2 && (
              <g pointerEvents="none">
                <rect
                  x={Math.min(drag.start, drag.cur)} y={AXIS_H}
                  width={Math.abs(drag.cur - drag.start)} height={bodyH}
                  style={{ fill: CLAUDE_COLOR }} opacity={0.08}
                />
                <line x1={Math.min(drag.start, drag.cur)} x2={Math.min(drag.start, drag.cur)} y1={AXIS_H} y2={AXIS_H + bodyH} style={{ stroke: CLAUDE_COLOR }} strokeWidth={1} opacity={0.5} />
                <line x1={Math.max(drag.start, drag.cur)} x2={Math.max(drag.start, drag.cur)} y1={AXIS_H} y2={AXIS_H + bodyH} style={{ stroke: CLAUDE_COLOR }} strokeWidth={1} opacity={0.5} />
              </g>
            )}

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

      {tip && (
        <div
          className="tip-in pointer-events-none absolute z-30 rounded border border-line2 bg-raise px-2.5 py-1.5 font-mono text-[12px] shadow-xl shadow-black/40"
          style={{
            left: Math.min(tip.x + 14, (scrollRef.current?.clientWidth ?? 600) - 320),
            top: tip.y + 14,
          }}
        >
          {tip.content}
        </div>
      )}

      {/* legend */}
      <div className="mt-3 flex items-center gap-4 border-t border-line pt-2.5 font-mono text-[11px] uppercase tracking-wider text-dim">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm" style={{ background: CLAUDE_COLOR }} /> claude working</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm" style={{ background: USER_COLOR, opacity: 0.4 }} /> you active</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-0.5" style={{ background: USER_COLOR }} /> prompt</span>
        <span className="flex items-center gap-1.5"><Cloud size={10} className="text-claude/70" aria-hidden /> cloud (worktree) session</span>
      </div>
    </div>
  );
}
