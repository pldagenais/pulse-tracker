// Wire types for the tracker API. Timestamps are epoch milliseconds; `date`
// fields are local YYYY-MM-DD day keys.

export interface DayStat {
  date: string;
  claudeMs: number;
  userActiveMs: number;
  wallMs: number;
  prompts: number;
  turns: number;
  sessions: number;
  estCostUsd: number;
  /** a session without a price-table entry touched this day: cost is a floor */
  unpriced: boolean;
  outputTokens: number;
  subagentMs: number;
}

export interface ProjectSplitRow {
  id: number;
  name: string;
  parentProjectId: number | null;
  worktreeBranch: string | null;
  claudeMs: number;
  turns: number;
  sessions: number;
  prompts: number;
  estCostUsd: number;
}

export type LiveStatus = 'working' | 'needs-you' | 'idle' | 'open';

export interface LiveSession {
  sessionId: string;
  status: LiveStatus;
  since: number;
  /** Cloud/background run in a git worktree (no local process). */
  cloud: boolean;
  /** Working but transcript silent for 5+ min — possibly blocked. */
  stalled: boolean;
  /** Message from the Notification hook when status is needs-you. */
  notification: string | null;
  lastPrompt: string | null;
  title: string | null;
  projectId: number | null;
  projectName: string | null;
  cwd: string | null;
  /** Session-so-far rollups from the DB (null until first ingest). */
  estCostUsd: number | null;
  claudeMs: number;
  promptCount: number;
  models: string[];
  /** Subagents with activity in the last 10 minutes (working sessions only). */
  agentsActive: number;
  /** Estimated current context size (last API call's input side); null when unknown. */
  contextTokens: number | null;
  /** 200K or 1M depending on the model variant in use. */
  contextWindow: number | null;
}

export interface RecordsData {
  currentStreak: number;
  longestStreak: number;
  busiestDay: { date: string; claudeMs: number } | null;
  mostPromptsDay: { date: string; prompts: number } | null;
  biggestTokenDay: { date: string; outputTokens: number } | null;
  longestSession: { sessionId: string; title: string | null; project: string; claudeMs: number; startedAt: number } | null;
}

export interface Overview extends DayStat {
  byProject: ProjectSplitRow[];
  liveSessions: LiveSession[];
  records: RecordsData;
  /** 14 local days ending on `date` — chart, sparklines, and delta comparisons. */
  trend: DayStat[];
}

export interface ActivityRow {
  id: number;
  ts: number;
  event: string;
  sessionId: string | null;
  title: string | null;
  projectName: string | null;
  prompt: string | null;
}

export type ReplayItem =
  | { kind: 'prompt'; ts: number; promptUuid: string | null; text: string }
  | { kind: 'reply'; ts: number; text: string }
  | { kind: 'tools'; ts: number; tools: Record<string, number> }
  | { kind: 'edit'; ts: number; file: string; tool: string; edits: { old: string | null; new: string }[] };

export interface ReplayData {
  items: ReplayItem[];
  truncated: boolean;
  missing?: boolean;
}

export interface TimelineTurn {
  start: number;
  end: number;
  contLeft: boolean;
  contRight: boolean;
  claudeMs: number;
  toolUseCount: number;
  promptUuid: string | null;
  promptText: string | null;
}

export interface TimelinePrompt {
  uuid: string;
  ts: number;
  kind: string;
  text: string;
}

export interface TimelineSession {
  sessionId: string;
  title: string | null;
  lastPrompt: string | null;
  projectId: number;
  projectName: string;
  parentProjectId: number | null;
  worktreeBranch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  turns: TimelineTurn[];
  activeGaps: { start: number; end: number }[];
  prompts: TimelinePrompt[];
}

export interface TimelineDay {
  date: string;
  sessions: TimelineSession[];
  legacy: { date: string; message_count: number | null; session_count: number | null } | null;
}

export interface PrLink {
  number: number | null;
  url: string;
  repo: string | null;
}

export interface SessionSummary {
  id: string;
  projectId: number;
  projectName: string;
  parentProjectId: number | null;
  worktreeBranch: string | null;
  title: string | null;
  lastPrompt: string | null;
  firstPrompt: string | null;
  starred: boolean;
  tags: string[];
  note: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  /** Which subscription ran this session; null when we could not tell. */
  accountUuid: string | null;
  /** How we know — 'env-profile'/'env-explicit'/'manual' are exact, the rest inferred. */
  accountSource: string | null;
  startedAt: number | null;
  endedAt: number | null;
  lastEventAt: number | null;
  promptCount: number;
  turnCount: number;
  claudeMs: number;
  userActiveMs: number;
  subagentCount: number;
  subagentMs: number;
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estCostUsd: number | null;
  hasUnpricedTokens: boolean;
  models: string[];
  prLinks: PrLink[];
}

export interface SessionTurn {
  start: number;
  end: number;
  claudeMs: number;
  eventCount: number;
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estCostUsd: number | null;
  promptUuid: string | null;
}

export interface SessionPrompt {
  uuid: string;
  ts: number;
  kind: string;
  commandName: string | null;
  text: string;
  charCount: number;
}

export interface AgentRun {
  agentId: string;
  agentType: string | null;
  model: string | null;
  status: string | null;
  firstTs: number | null;
  lastTs: number | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  toolUseCount: number;
  estCostUsd: number | null;
  toolStats: Record<string, number> | null;
}

export interface SessionCommit {
  sha: string;
  ts: number;
  message: string | null;
  additions: number;
  deletions: number;
}

export interface SessionDetail {
  session: SessionSummary;
  turns: SessionTurn[];
  prompts: SessionPrompt[];
  agents: AgentRun[];
  toolBreakdown: { name: string; count: number }[];
  skills: { name: string; count: number }[];
  efforts: string[];
  /** Commits whose author time falls inside this session's window. */
  commits: SessionCommit[];
  /** PR lifecycle by URL (tracked via gh), for the pr_links badges. */
  prStates: Record<string, { state: string | null; mergedAt: number | null }>;
  /** context-size curve (input side per credited request) with compaction
   * marks. Optional: cloud session snapshots mirrored before this shipped
   * never re-mirror, so old sessions arrive without it. */
  context?: { points: { ts: number; tokens: number; compacted: boolean }[]; compactions: number };
}

export interface ProjectCalendarData {
  month: string;
  /** claudeMs includes cloud/worktree sessions; cloudMs is that subset. */
  days: { date: string; claudeMs: number; cloudMs: number; turns: number; sessions: number }[];
}

export interface ErrorFeedData {
  apiErrors: number;
  toolErrors: number;
  recent: { id: number; ts: number; kind: string; snippet: string | null; sessionId: string | null; project: string | null }[];
}

export interface CloudRoutine {
  id: string;
  name: string;
  cron: string | null;
  runOnceAt: string | null;
  enabled: boolean;
  endedReason: string | null;
  lastFiredAt: number | null;
  nextRunAt: number | null;
  createdVia: string | null;
  prompt: string;
}

export interface RoutinesData {
  routines: CloudRoutine[];
  cachedAt: number;
  environments: { id: string; name: string }[];
}

/** Where a memory file comes from — global, committed in the repo, or auto-memory. */
export type MemoryScope = 'global' | 'project' | 'local' | 'projectDir' | 'auto';

export interface MemoryFileEntry {
  path: string;
  name: string;
  scope: MemoryScope;
  /** posix path relative to the group root; '' for global/auto */
  rel: string;
  /** ancestor distance from the project cwd (0 = its own dir); null for global/auto */
  depth: number | null;
  exists: boolean;
  sizeBytes: number;
  mtime: number;
}

export interface MemoryWorktreeEntry {
  key: string;
  label: string;
  branch: string | null;
  files: MemoryFileEntry[];
}

export interface MemoryGroupEntry {
  key: string;
  label: string;
  rootPath: string | null;
  lastSeen: number | null;
  files: MemoryFileEntry[];
  worktrees: MemoryWorktreeEntry[];
}

export interface MemoryTree {
  groups: MemoryGroupEntry[];
  count: number;
}

export interface McpServersData {
  servers: { name: string; command: string; healthy: boolean; status: string }[];
  checkedAt: number;
}

export interface ManageInventory {
  skills: { dir: string; name: string | null; description: string | null }[];
  agents: { file: string; name: string | null; description: string | null }[];
  plugins: { marketplace: string; name: string }[];
}

export interface ClaudeAiData {
  chats: number;
  messages: number;
  humanMessages: number;
  lastTs: number | null;
  days: { date: string; chats: number; messages: number }[];
  recent: { uuid: string; name: string | null; lastTs: number | null; messages: number }[];
}

export interface TokenFlowData {
  days: number;
  savedUsd: number;
  models: {
    model: string;
    freshInput: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
  }[];
}

export interface PrOutcomesData {
  opened: number;
  merged: number;
  open: number;
  rows: {
    url: string;
    repo: string | null;
    number: number | null;
    title: string | null;
    state: string | null;
    mergedAt: number | null;
    additions: number | null;
    deletions: number | null;
    sessionId: string | null;
    sessionStartedAt: number | null;
  }[];
}

export interface PromptRow {
  uuid: string;
  ts: number;
  sessionId: string;
  projectId: number;
  projectName: string | null;
  sessionTitle: string | null;
  kind: 'typed' | 'command' | 'legacy';
  commandName: string | null;
  text: string;
  charCount: number;
  snippet: string | null;
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  mode?: string;
  rows: T[];
}

export interface Project {
  id: number;
  path: string;
  name: string;
  parentProjectId: number | null;
  worktreeBranch: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  lastActive: number | null;
  sessionCount: number;
  claudeMs: number;
  userActiveMs: number;
  promptCount: number;
  subagentCount: number;
  estCostUsd: number;
}

export interface ProjectDetail {
  project: { id: number; path: string; name: string; parentProjectId: number | null; worktreeBranch: string | null };
  /** "latest changes" prose; null until generated once for this project */
  changesSummary: { markdown: string; createdAt: number; stale: boolean } | null;
  worktreeCount: number;
  totals: {
    sessions: number;
    claudeMs: number;
    userActiveMs: number;
    prompts: number;
    estCostUsd: number;
    subagents: number;
  };
  daily: { date: string; claudeMs: number; turns: number }[];
  sessions: SessionSummary[];
}

export interface HeatDay {
  date: string;
  claudeMs: number;
  userActiveMs: number;
  prompts: number;
  sessions: number;
  messages: number | null;
  legacy: boolean;
}

export interface HeatmapData {
  from: string;
  to: string;
  days: HeatDay[];
  firstActivityDay: string;
}

export interface ModelRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estCostUsd: number;
  unpriced: boolean;
  messages: number;
}

export interface HourRow {
  hour: number;
  prompts: number;
  claudeMs: number;
}

export interface ToolUsageData {
  tools: { name: string; count: number }[];
  linesAdded: number;
  linesRemoved: number;
}

export interface SkillUsageData {
  skills: { name: string; count: number }[];
  plugins: { name: string; count: number }[];
}

export interface McpUsageData {
  servers: { name: string; calls: number; lastUsedAt: number; sessions: number }[];
  tools: { server: string; name: string; calls: number; lastUsedAt: number }[];
}

export interface CompactionTaxData {
  compactions: number;
  sessionsHit: number;
  sessionsTotal: number;
  /** cache-write tokens spent rebuilding context after each collapse */
  rebuildTokens: number;
}

export interface FocusStatsData {
  switches: number;
  days: { date: string; switches: number }[];
  longestBlock: { ms: number; project: string; start: number } | null;
  projectsTouched: number;
}

export interface JournalEntry {
  id: number;
  ts: number;
  projectPath: string | null;
  projectId: number | null;
  projectName: string | null;
  sessionId: string | null;
  text: string;
  source: 'ui' | 'claude';
}

export interface IngestProgress {
  phase: 'idle' | 'backfill' | 'rescan' | 'watching';
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  parseErrors: number;
  lastFile: string | null;
}

export interface StatusInfo {
  app: string;
  version: string;
  port: number;
  uptimeMs: number;
  claudeDir: string;
  dataDir: string;
  db: {
    sizeBytes: number;
    sessions: number;
    events: number;
    prompts: number;
    turns: number;
    agentRuns: number;
    journal: number;
    parseErrors: number;
    parseErrors24h: number;
  };
  backup: { count: number; latestAt: number | null; latestSizeBytes: number | null };
  ingest: IngestProgress;
  watcher: { watching: boolean; lastEventAt: number | null };
  hooks: {
    installed: boolean;
    lastSeenAt: number | null;
    byEvent: Record<string, { last: number; count: number }>;
  };
  sseClients: number;
}

export type JobStatus = 'running' | 'done' | 'error' | 'killed';

export interface PulseJob {
  id: number;
  createdAt: number;
  sessionId: string | null;
  resumeOf: string | null;
  projectId: number | null;
  projectPath: string;
  prompt: string;
  model: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  status: JobStatus;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  outputTail: string | null;
}

export interface JobsData {
  jobs: PulseJob[];
  running: number;
}

export interface PromptTemplate {
  id: number;
  name: string;
  body: string;
  projectId: number | null;
  model: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  pinned: boolean;
  createdAt: number;
  runCount: number;
  lastRunAt: number | null;
}

export interface ScheduledJob {
  id: number;
  name: string;
  prompt: string;
  projectPath: string;
  model: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  cadence: 'daily' | 'weekly';
  hour: number;
  minute: number;
  dow: number | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastJobId: number | null;
  lastStatus: string | null;
  consecutiveFailures: number;
}

export interface ParseFailuresData {
  recent: { id: number; ts: number; file: string; reason: string | null; snippet: string | null }[];
  byFile: { file: string; n: number; last: number }[];
}

export interface Settings {
  idleThresholdMin: number;
  stallCapMin: number;
  monthlyBudgetUsd: number | null;
  window5hBudgetUsd: number | null;
  alertDailyCostUsd: number | null;
  alertSessionCostUsd: number | null;
  llmConfigDir: string | null;
  llmModel: string;
}

export interface AlertsData {
  unacked: number;
  alerts: { id: number; ts: number; rule: string; message: string; acked: boolean }[];
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  enabled: boolean;
  lastFiredAt: number | null;
  lastStatus: string | null;
}

export interface UsageWindowSlice {
  estCostUsd: number;
  outputTokens: number;
  turns: number;
  prompts: number;
}

/**
 * Real rate-limit consumption as the desktop app records it, per subscription.
 * Only sampled while that account's app is running, hence `stale`.
 */
export interface AccountPlanUsage {
  accountUuid: string;
  name: string;
  email: string | null;
  isDefault: boolean;
  /** Trailing-5h quota used, 0-100. Null when never sampled. */
  fivehourPct: number | null;
  /** Trailing-7d quota used, 0-100. */
  sevendayPct: number | null;
  sampledAt: number | null;
  stale: boolean;
}

/** One subscription's slice of the rolling windows. */
export interface AccountUsageWindow {
  accountUuid: string;
  name: string;
  isDefault: boolean;
  window5h: UsageWindowSlice;
  window7d: UsageWindowSlice;
  planUsage: AccountPlanUsage | null;
}

export interface UsageWindowData {
  window5h: UsageWindowSlice;
  window7d: UsageWindowSlice;
  easesAt: number | null;
  /** Credited output tokens per minute over the trailing 15 minutes. */
  burnTokPerMin: number;
  ceiling5hUsd: number | null;
  ceiling7dUsd: number | null;
  /** Each subscription has its own rolling quota — a combined figure overstates both. */
  byAccount: AccountUsageWindow[];
  /** Turns we could not attribute, so the split is honest about not adding up. */
  unattributedTurns7d: number;
}

export interface AccountSummary {
  uuid: string;
  email: string | null;
  orgUuid: string | null;
  label: string | null;
  profileDir: string | null;
  rateLimitTier: string | null;
  isDefault: boolean;
  name: string;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  sessions: number;
  planUsage: AccountPlanUsage | null;
}

export interface AccountsData {
  accounts: AccountSummary[];
  /** Which account the terminal CLI is signed into — asserted by the user, not detected. */
  cliAccountUuid: string | null;
  unattributedSessions: number;
}
