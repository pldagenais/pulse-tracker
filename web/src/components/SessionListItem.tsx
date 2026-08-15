import { useSearchParams } from 'react-router';
import { Star } from 'lucide-react';
import type { SessionSummary } from '../lib/types';
import { projectColor, USER_COLOR } from '../lib/colors';
import { fmtCost, fmtDuration, fmtRelative, fmtCount, fmtModel } from '../lib/format';
import { Badge } from './ui';

export function SessionListItem({ s, showProject = true }: { s: SessionSummary; showProject?: boolean }) {
  const [params, setParams] = useSearchParams();
  const open = () => {
    const next = new URLSearchParams(params);
    next.set('session', s.id);
    setParams(next);
  };
  return (
    <button
      onClick={open}
      className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-left transition-colors hover:bg-surface2"
    >
      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: projectColor(s.projectId) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink">
          {s.title ?? s.lastPrompt ?? s.firstPrompt ?? 'Untitled session'}
        </span>
        <span className="block truncate font-mono text-[11px] text-dim">
          {showProject && `${s.projectName} · `}
          {fmtRelative(s.startedAt)} · {fmtCount(s.promptCount)} prompt{s.promptCount === 1 ? '' : 's'}
          {s.worktreeBranch ? ` · ${s.worktreeBranch}` : ''}
          {s.models.length > 0
            ? ` · ${fmtModel(s.models[0])}${s.models.length > 1 ? ` +${s.models.length - 1}` : ''}`
            : ''}
        </span>
      </span>
      {s.endedAt == null && s.lastEventAt != null && Date.now() - s.lastEventAt < 30 * 60_000 && (
        <Badge tone="ok">open</Badge>
      )}
      {s.starred && (
        <Star aria-hidden size={11} className="shrink-0" style={{ fill: USER_COLOR, stroke: USER_COLOR }} />
      )}
      <span className="w-16 shrink-0 text-right font-mono text-[12px] text-claude" title="Claude working time">
        {fmtDuration(s.claudeMs)}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-[12px] text-dim" title="Estimated API-equivalent cost">
        {fmtCost(s.estCostUsd)}
      </span>
    </button>
  );
}
