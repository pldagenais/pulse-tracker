import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ExternalLink, Star } from 'lucide-react';
import { Link } from 'react-router';
import type { SessionDetail, SessionTurn } from '../../lib/types';
import { Badge, Card, SkeletonRows, WriteError, useWriteAction } from '../ui';
import { fmtClock, fmtCost, fmtDay, fmtDuration, fmtModel, fmtTokens, fmtCount, plural } from '../../lib/format';
import { projectColor, CLAUDE_COLOR, USER_COLOR, SUBAGENT_COLOR, BAR_MUTED } from '../../lib/colors';
import { replayQuery } from '../../lib/queries';
import { ContinueBox, ResumeButton } from '../actions';
import { api } from '../../lib/api';
import { MODE } from '../../lib/source';
import { useT } from '../../lib/i18n';
import { cn } from '../../lib/cn';

/** Writes that need the local machine are disabled rather than left to fail. */
const LOCAL = MODE === 'local';

export function SessionDetailView({ detail, highlightPrompt }: { detail: SessionDetail; highlightPrompt?: string | null }) {
  const { session: s, turns, prompts, agents, toolBreakdown, skills, efforts, commits, prStates } = detail;
  const { t, tf } = useT();
  const turnByPrompt = useMemo(() => {
    const m = new Map<string, SessionTurn>();
    for (const t of turns) if (t.promptUuid) m.set(t.promptUuid, t);
    return m;
  }, [turns]);

  const maxTime = Math.max(s.claudeMs, s.userActiveMs, s.subagentMs, 1);

  const queryClient = useQueryClient();
  const star = useWriteAction(async () => {
    if (s.starred) await api.del(`/api/sessions/${s.id}/star`);
    else await api.post(`/api/sessions/${s.id}/star`);
    queryClient.invalidateQueries();
  });

  const [showReplay, setShowReplay] = useState(false);
  const replay = useQuery(replayQuery(s.id, showReplay));
  const replayItems =
    showReplay && replay.data && !replay.data.missing && replay.data.items.length > 0
      ? replay.data.items
      : null;

  const spanStart = s.startedAt ?? 0;
  const spanMs = s.startedAt != null && s.lastEventAt != null ? s.lastEventAt - s.startedAt : 0;

  return (
    <div className="space-y-4">
      {/* header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: projectColor(s.projectId) }} />
          <span className="text-sm text-mid">{s.projectName}</span>
          {s.worktreeBranch && <Badge>{s.worktreeBranch}</Badge>}
          {s.gitBranch && s.gitBranch !== 'HEAD' && <Badge>{s.gitBranch}</Badge>}
          <span className="ml-auto flex items-center gap-2">
            <Link
              to={`/compare?a=${s.id}`}
              className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:bg-surface2 hover:text-ink"
              title={t('timeline.compareTitle')}
            >
              <ArrowLeftRight size={11} /> {t('timeline.compare')}
            </Link>
            {!s.worktreeBranch && <ResumeButton sessionId={s.id} />}
          </span>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <h2 className="font-display text-lg font-medium leading-6 text-ink">
            {s.title ?? s.lastPrompt ?? s.firstPrompt ?? t('timeline.untitledSession')}
          </h2>
          <span className="flex shrink-0 items-center gap-1.5">
            <WriteError error={star.error} />
            <button
              onClick={() => star.run()}
              disabled={star.pending || !LOCAL}
              title={LOCAL ? undefined : t('timeline.starNeedsPc')}
              aria-label={s.starred ? t('timeline.unstarSession') : t('timeline.starSession')}
              className={cn('rounded p-1 disabled:opacity-40', s.starred ? 'text-user' : 'text-dim hover:text-user')}
            >
              <Star
                size={15}
                style={{ fill: s.starred ? USER_COLOR : 'none', stroke: s.starred ? USER_COLOR : 'currentColor' }}
              />
            </button>
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-dim">
          {s.startedAt && (
            <span>
              {fmtDay(s.startedAt)} {fmtClock(s.startedAt)}
              {s.lastEventAt && ` → ${fmtDay(s.lastEventAt) === fmtDay(s.startedAt) ? '' : fmtDay(s.lastEventAt) + ' '}${fmtClock(s.lastEventAt)}`}
            </span>
          )}
          {s.ccVersion && <span>cc {s.ccVersion}</span>}
          {s.models.map((m) => (
            <Badge key={m} tone="claude">{fmtModel(m)}</Badge>
          ))}
          {efforts.map((e) => (
            <Badge key={e}>{e}</Badge>
          ))}
        </div>
        {s.prLinks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {s.prLinks.map((pr) => (
              <a
                key={pr.url}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-line2 px-2 py-0.5 font-mono text-[12px] text-mid hover:border-claude/50 hover:text-claude"
              >
                <ExternalLink size={11} />
                {pr.repo ? `${pr.repo}#${pr.number}` : `PR #${pr.number}`}
                {prStates[pr.url]?.state && (
                  <span className={cn(
                    'ml-0.5 rounded-sm px-1 text-[10px] uppercase tracking-wider',
                    prStates[pr.url].state === 'MERGED' ? 'bg-ok/15 text-ok' : prStates[pr.url].state === 'OPEN' ? 'bg-claude/15 text-claude' : 'bg-danger/15 text-danger'
                  )}>
                    {prStates[pr.url].state?.toLowerCase()}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* keyed: its state seeds from props, so without a key a cached session
          would render (and then SAVE) the previously viewed session's tags */}
      <TagsAndNote key={s.id} sessionId={s.id} tags={s.tags} note={s.note} />

      {/* commits landed during this session */}
      {commits.length > 0 && (
        <Card title={tf('timeline.commitsDuring', { n: commits.length })} bodyClassName="p-0">
          <div className="max-h-48 overflow-y-auto">
            {commits.map((c) => (
              <div key={c.sha} className="flex items-baseline gap-2.5 border-b border-line/60 px-4 py-2 last:border-0">
                <span className="shrink-0 font-mono text-[11px] text-dim">{fmtClock(c.ts)}</span>
                <span className="shrink-0 font-mono text-[11px] text-mid">{c.sha.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink">{c.message ?? ''}</span>
                {(c.additions > 0 || c.deletions > 0) && (
                  <span className="shrink-0 font-mono text-[11px]">
                    <span className="text-ok">+{c.additions}</span> <span className="text-danger">−{c.deletions}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* timings */}
      <Card title={t('timeline.timeCard')} bodyClassName="space-y-2.5 p-4">
        {turns.length >= 2 && spanMs > 0 && (
          <div className="relative h-4 w-full rounded bg-raise">
            {turns.map((t, i) => (
              <div
                key={i}
                className="absolute rounded"
                style={{
                  left: `${((t.start - spanStart) / spanMs) * 100}%`,
                  width: `${((t.end - t.start) / spanMs) * 100}%`,
                  minWidth: 2,
                  height: 8,
                  top: 4,
                  background: CLAUDE_COLOR,
                }}
                title={`${fmtClock(t.start)}–${fmtClock(t.end)} · ${fmtDuration(t.claudeMs)}`}
              />
            ))}
          </div>
        )}
        {([
          [t('timeline.claudeWorkingCap'), s.claudeMs, CLAUDE_COLOR],
          [t('timeline.youActiveCap'), s.userActiveMs, USER_COLOR],
          [t('timeline.subagentCompute'), s.subagentMs, SUBAGENT_COLOR],
        ] as const).map(([label, ms, color]) => (
          <div key={label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs text-mid">{label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raise">
              <div className="h-full rounded-full" style={{ width: `${(ms / maxTime) * 100}%`, background: color }} />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-xs text-ink">{fmtDuration(ms)}</span>
          </div>
        ))}
        <div className="pt-1 font-mono text-[12px] text-dim">
          {plural(s.promptCount, 'prompt')} · {plural(s.turnCount, 'turn')} · {plural(s.toolUseCount, 'tool call')}
          {s.subagentCount > 0 && ` · ${plural(s.subagentCount, 'subagent')}`}
        </div>
      </Card>

      {detail.context && detail.context.points.length >= 3 && <ContextCurve context={detail.context} />}

      {/* tokens & cost */}
      <Card title={t('timeline.tokensCostCard')} bodyClassName="p-0">
        <table className="w-full font-mono text-xs">
          <tbody>
            {([
              [t('timeline.input'), s.inputTokens],
              [t('timeline.output'), s.outputTokens],
              [t('timeline.cacheRead'), s.cacheReadTokens],
              [t('timeline.cacheWrite'), s.cacheWriteTokens],
            ] as const).map(([label, v]) => (
              <tr key={label} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-1.5 text-dim">{label}</td>
                <td className="px-4 py-1.5 text-right text-ink">{fmtTokens(v)}</td>
              </tr>
            ))}
            <tr className="bg-surface2/50">
              <td className="px-4 py-2 text-dim">
                {t('timeline.estApiCost')}{s.hasUnpricedTokens ? t('timeline.partial') : ''}
              </td>
              <td className="px-4 py-2 text-right text-user">{fmtCost(s.estCostUsd)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {/* prompts timeline */}
      <Card
        title={tf('timeline.promptsCard', { n: prompts.length })}
        action={
          <button
            onClick={() => setShowReplay((v) => !v)}
            className="font-mono text-[11px] text-dim hover:text-ink"
          >
            {showReplay ? t('timeline.hideConversation') : t('timeline.showConversation')}
          </button>
        }
        bodyClassName="p-0"
      >
        {showReplay && replay.isLoading ? (
          <div className="p-4">
            <SkeletonRows n={4} />
          </div>
        ) : replayItems ? (
          <>
            <ol>
              {replayItems.map((it, i) =>
                it.kind === 'prompt' ? (
                  <li key={i} className="border-b border-line/60 px-4 py-2.5 last:border-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-dim">{fmtClock(it.ts)}</span>
                    </div>
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap font-mono text-xs leading-5 text-ink/90">
                      {it.text}
                    </div>
                  </li>
                ) : it.kind === 'reply' ? (
                  <li key={i} className="px-4">
                    <div className="my-1.5 whitespace-pre-wrap border-l-2 border-claude/40 pl-3 font-mono text-xs leading-5 text-ink/85">
                      {it.text}
                    </div>
                  </li>
                ) : it.kind === 'edit' ? (
                  <li key={i} className="px-4 py-1.5">
                    <div className="overflow-hidden rounded border border-line/80">
                      <div className="flex items-baseline gap-2 border-b border-line/60 bg-surface2/60 px-2.5 py-1 font-mono text-[11px]">
                        <span className="text-claude">{it.tool}</span>
                        <span className="min-w-0 flex-1 truncate text-mid" title={it.file}>{it.file.split(/[\\/]/).slice(-2).join('/')}</span>
                        <span className="text-dim">{fmtClock(it.ts)}</span>
                      </div>
                      {it.edits.map((e, j) => (
                        <div key={j} className={cn('font-mono text-[11px] leading-4', j > 0 && 'border-t border-line/40')}>
                          {e.old != null && e.old !== '' && (
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-danger/10 px-2.5 py-1 text-danger/90">
                              {e.old.split('\n').map((l) => `- ${l}`).join('\n')}
                            </pre>
                          )}
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-ok/10 px-2.5 py-1 text-ok">
                            {e.new.split('\n').map((l) => `+ ${l}`).join('\n')}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </li>
                ) : (
                  <li key={i} className="truncate px-4 py-1 font-mono text-[11px] text-dim">
                    {Object.entries(it.tools)
                      .map(([name, n]) => `${name} ×${n}`)
                      .join(' · ')}
                  </li>
                ),
              )}
            </ol>
            {replay.data?.truncated && <div className="microlabel px-4 py-2">{t('timeline.transcriptTruncated')}</div>}
          </>
        ) : (
          <>
            {prompts.length === 0 && <div className="p-4 text-xs text-dim">{t('timeline.noPrompts')}</div>}
            <ol>
              {prompts.map((p) => (
                <PromptRowItem
                  key={p.uuid}
                  ts={p.ts}
                  kind={p.kind}
                  text={p.text}
                  turn={p.uuid ? turnByPrompt.get(p.uuid) : undefined}
                  highlight={highlightPrompt === p.uuid}
                />
              ))}
            </ol>
          </>
        )}
      </Card>

      {/* activity */}
      {(toolBreakdown.length > 0 || agents.length > 0 || skills.length > 0) && (
        <Card title={t('timeline.activityCard')} bodyClassName="space-y-4 p-4">
          {toolBreakdown.length > 0 && (
            <div>
              <div className="microlabel mb-2">{t('timeline.tools')}</div>
              <MiniBars rows={toolBreakdown.slice(0, 8).map((tb) => ({ label: tb.name, value: tb.count }))} />
            </div>
          )}
          {skills.length > 0 && (
            <div>
              <div className="microlabel mb-2">{t('timeline.skills')}</div>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((sk) => (
                  <Badge key={sk.name}>{sk.name} ×{sk.count}</Badge>
                ))}
              </div>
            </div>
          )}
          {agents.length > 0 && (
            <div>
              <div className="microlabel mb-2">{tf('timeline.subagentRuns', { n: agents.length })}</div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {agents.map((a) => (
                  <div key={a.agentId} className="flex items-center gap-2 rounded bg-surface2/60 px-2.5 py-1.5 font-mono text-[12px]">
                    <span className="text-mid">{a.agentType ?? 'agent'}</span>
                    <span className="text-dim">{fmtModel(a.model)}</span>
                    <span className="ml-auto text-dim">{tf('timeline.tokensOut', { n: fmtTokens(a.outputTokens) })}</span>
                    <span className="w-14 text-right text-ink">{fmtDuration(a.durationMs)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
      {!s.worktreeBranch && <ContinueBox sessionId={s.id} />}
    </div>
  );
}

/**
 * Context-size curve: the input side of every credited request IS the context
 * at that instant. A sawtooth means compaction; each drop is ticked. Until now
 * this number existed only as a live gauge and vanished when a session idled.
 */
function ContextCurve({ context }: { context: NonNullable<SessionDetail['context']> }) {
  const { points, compactions } = context;
  const { t } = useT();
  const W = 860;
  const H = 96;
  const PAD = 4;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const span = Math.max(t1 - t0, 1);
  const max = Math.max(...points.map((p) => p.tokens), 1);
  const x = (ts: number) => PAD + ((ts - t0) / span) * (W - PAD * 2);
  const y = (tok: number) => H - PAD - (tok / max) * (H - PAD * 2);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ');
  const area = `${path} L${x(t1).toFixed(1)},${H - PAD} L${x(t0).toFixed(1)},${H - PAD} Z`;
  const peak = points.reduce((a, b) => (b.tokens > a.tokens ? b : a));
  return (
    <Card
      title={`${t('timeline.contextWindow')}${compactions > 0 ? ` · ${plural(compactions, 'compaction')}` : ''}`}
      bodyClassName="p-4"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden>
        <path d={area} fill={CLAUDE_COLOR} opacity={0.12} />
        <path d={path} fill="none" stroke={CLAUDE_COLOR} strokeWidth={1.5} />
        {points.filter((p) => p.compacted).map((p) => (
          <g key={p.ts}>
            <line x1={x(p.ts)} x2={x(p.ts)} y1={PAD} y2={H - PAD} stroke={USER_COLOR} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(p.ts)} cy={y(p.tokens)} r={2.5} fill={USER_COLOR} />
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-dim">
        <span>{t('timeline.peak')} <span className="text-claude">{fmtTokens(peak.tokens)}</span> {t('timeline.at')} {fmtClock(peak.ts)}</span>
        <span>{t('timeline.final')} <span className="text-ink">{fmtTokens(points[points.length - 1].tokens)}</span></span>
        {compactions > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-0.5" style={{ background: USER_COLOR }} /> {t('timeline.compactionLegend')}
          </span>
        )}
      </div>
    </Card>
  );
}

const TAG_VOCAB = ['bugfix', 'feature', 'refactor', 'exploration', 'infra', 'docs', 'review', 'wasted'];

function TagsAndNote({ sessionId, tags: initialTags, note: initialNote }: { sessionId: string; tags: string[]; note: string | null }) {
  const queryClient = useQueryClient();
  const { t, tf } = useT();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [note, setNote] = useState(initialNote ?? '');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Adopts the server's echo rather than trusting the optimistic value, so a
   * tag the server normalises or drops stops rendering as if it were accepted.
   * On failure the optimistic value is rolled back to what was last persisted.
   */
  const write = useWriteAction(async (nextTags: string[], nextNote: string) => {
    const prevTags = tags;
    const prevNote = note;
    try {
      const saved = await api.put<{ tags: string[]; note: string | null }>(
        `/api/sessions/${sessionId}/meta`,
        { tags: nextTags, note: nextNote }
      );
      if (saved) {
        setTags(saved.tags ?? nextTags);
        setNote(saved.note ?? '');
      }
      queryClient.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      setTags(prevTags);
      setNote(prevNote);
      throw e;
    }
  });
  const save = (nextTags: string[], nextNote: string) => void write.run(nextTags, nextNote);
  const addTag = (t: string) => {
    const next = [...new Set([...tags, t.toLowerCase().trim()])].filter(Boolean);
    setTags(next);
    setSuggestions((sg) => sg.filter((x) => x !== t));
    save(next, note);
  };
  const removeTag = (t: string) => {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    save(next, note);
  };
  const suggest = async () => {
    setSuggesting(true);
    setErr(null);
    try {
      const r = await api.post<{ suggestions: string[] }>(`/api/sessions/${sessionId}/autotag`, {});
      const fresh = r.suggestions.filter((t) => !tags.includes(t));
      setSuggestions(fresh);
      if (!fresh.length) setErr(t('timeline.noNewSuggestions'));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <Card title={t('timeline.tagsNote')} bodyClassName="space-y-2.5 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full border border-claude/40 bg-claude/10 px-2 py-0.5 font-mono text-[11px] text-claude">
            {tag}
            <button onClick={() => removeTag(tag)} aria-label={tf('timeline.removeTag', { tag })} className="hover:text-danger">×</button>
          </span>
        ))}
        {suggestions.map((tag) => (
          <button
            key={tag}
            onClick={() => addTag(tag)}
            title={t('timeline.suggestedApply')}
            className="rounded-full border border-dashed border-line2 px-2 py-0.5 font-mono text-[11px] text-dim hover:border-claude/50 hover:text-claude"
          >
            + {tag}
          </button>
        ))}
        <select
          value=""
          onChange={(e) => e.target.value && addTag(e.target.value)}
          aria-label={t('timeline.addTag')}
          className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[11px] text-dim outline-none"
        >
          <option value="">+ tag</option>
          {TAG_VOCAB.filter((tag) => !tags.includes(tag)).map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <button
          onClick={suggest}
          disabled={suggesting || !LOCAL}
          title={LOCAL ? undefined : t('timeline.aiNeedsPc')}
          className="rounded border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-mid hover:text-claude disabled:opacity-50"
        >
          {suggesting ? t('timeline.thinking') : t('timeline.aiSuggest')}
        </button>
        {err && <span className="font-mono text-[11px] text-dim">{err}</span>}
        <WriteError error={write.error} />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => save(tags, note)}
        rows={2}
        placeholder={t('timeline.notePlaceholder')}
        className="w-full resize-y rounded-md border border-line bg-surface2 px-3 py-2 text-xs leading-5 text-ink outline-none placeholder:text-dim focus:border-claude/50"
      />
    </Card>
  );
}

function PromptRowItem({
  ts, kind, text, turn, highlight,
}: {
  ts: number;
  kind: string;
  text: string;
  turn?: SessionTurn;
  highlight?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useT();
  const long = text.length > 220;
  return (
    <li
      id={highlight ? 'highlight-prompt' : undefined}
      className={cn('border-b border-line/60 px-4 py-2.5 last:border-0', highlight && 'flash-row')}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-dim">{fmtClock(ts)}</span>
        {kind === 'command' && <Badge tone="user">cmd</Badge>}
        {kind === 'legacy' && <Badge>{t('timeline.legacy')}</Badge>}
        {turn && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-claude" title={t('timeline.turnTimeTitle')}>
            ▸ {fmtDuration(turn.claudeMs)}
          </span>
        )}
      </div>
      {long ? (
        <button
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className={cn('mt-1 block w-full cursor-pointer whitespace-pre-wrap text-left font-mono text-xs leading-5 text-ink/90', !expanded && 'line-clamp-2')}
          title={expanded ? t('timeline.clickCollapse') : t('timeline.clickExpand')}
        >
          {expanded ? text : text.slice(0, 2000)}
        </button>
      ) : (
        <div className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-ink/90">{text}</div>
      )}
    </li>
  );
}

export function MiniBars({ rows }: { rows: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2.5">
          <span className="w-28 shrink-0 truncate font-mono text-[12px] text-mid">{r.label}</span>
          <div className="h-3.5 flex-1">
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%`, background: r.color ?? BAR_MUTED }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[12px] text-ink">{fmtCount(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
