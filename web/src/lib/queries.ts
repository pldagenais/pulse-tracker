import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query';
import { api, qs } from './api';
import type {
  Overview, TimelineDay, DayStat, HeatmapData, Project, ProjectDetail, Paged,
  SessionSummary, SessionDetail, PromptRow, JournalEntry, StatusInfo, Settings,
  ModelRow, HourRow, ToolUsageData, SkillUsageData, ProjectSplitRow,
  ActivityRow, ReplayData, ParseFailuresData, JobsData, PromptTemplate, UsageWindowData, PrOutcomesData, ScheduledJob,
  TokenFlowData, ProjectCalendarData, ErrorFeedData, ClaudeAiData, McpServersData, ManageInventory,
  AlertsData, Webhook, RoutinesData, MemoryTree,
} from './types';

export interface PromptFilters {
  q?: string;
  project?: number | null;
  kind?: string | null;
  from?: string | null;
  to?: string | null;
}

export const overviewQuery = (date: string) =>
  queryOptions({
    queryKey: ['overview', date],
    queryFn: () => api.get<Overview>(`/api/overview${qs({ date })}`),
    staleTime: 15_000,
  });

export const timelineQuery = (date: string) =>
  queryOptions({
    queryKey: ['timeline', date],
    queryFn: () => api.get<TimelineDay>(`/api/timeline${qs({ date })}`),
    staleTime: 15_000,
  });

export const dailyStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'day', from, to],
    queryFn: () => api.get<{ rows: DayStat[] }>(`/api/stats${qs({ groupBy: 'day', from, to })}`),
    staleTime: 30_000,
  });

export const hourStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'hour', from, to],
    queryFn: () => api.get<{ rows: HourRow[] }>(`/api/stats${qs({ groupBy: 'hour', from, to })}`),
    staleTime: 60_000,
  });

export const modelStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'model', from, to],
    queryFn: () => api.get<{ rows: ModelRow[] }>(`/api/stats${qs({ groupBy: 'model', from, to })}`),
    staleTime: 60_000,
  });

export const toolStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'tool', from, to],
    queryFn: () => api.get<ToolUsageData>(`/api/stats${qs({ groupBy: 'tool', from, to })}`),
    staleTime: 60_000,
  });

export const skillStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'skill', from, to],
    queryFn: () => api.get<SkillUsageData>(`/api/stats${qs({ groupBy: 'skill', from, to })}`),
    staleTime: 60_000,
  });

export const projectStatsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['stats', 'project', from, to],
    queryFn: () => api.get<{ rows: ProjectSplitRow[] }>(`/api/stats${qs({ groupBy: 'project', from, to })}`),
    staleTime: 30_000,
  });

export const heatmapQuery = () =>
  queryOptions({
    queryKey: ['heatmap'],
    queryFn: () => api.get<HeatmapData>('/api/heatmap'),
    staleTime: 60_000,
  });

export const projectsQuery = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: () => api.get<Project[]>('/api/projects'),
    staleTime: 30_000,
  });

export const projectQuery = (id: number) =>
  queryOptions({
    queryKey: ['project', id],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`),
    staleTime: 30_000,
  });

export const sessionsQuery = (filters: { project?: number | null; sort?: string; page?: number; pageSize?: number }) =>
  queryOptions({
    queryKey: ['sessions', filters],
    queryFn: () => api.get<Paged<SessionSummary>>(`/api/sessions${qs(filters as Record<string, string | number | null>)}`),
    staleTime: 15_000,
  });

export const sessionQuery = (id: string | null) =>
  queryOptions({
    queryKey: ['session', id],
    queryFn: () => api.get<SessionDetail>(`/api/sessions/${id}`),
    enabled: !!id,
    staleTime: 15_000,
  });

export const promptsInfiniteQuery = (filters: PromptFilters) =>
  infiniteQueryOptions({
    queryKey: ['prompts', filters],
    queryFn: ({ pageParam }) =>
      api.get<Paged<PromptRow>>(
        `/api/prompts${qs({ ...filters, project: filters.project ?? undefined, page: pageParam, pageSize: 50 })}`
      ),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      (last.page + 1) * last.pageSize < last.total ? last.page + 1 : undefined,
    staleTime: 30_000,
  });

export const journalInfiniteQuery = (project?: number | null) =>
  infiniteQueryOptions({
    queryKey: ['journal', project ?? null],
    queryFn: ({ pageParam }) =>
      api.get<Paged<JournalEntry>>(`/api/journal${qs({ project: project ?? undefined, page: pageParam, pageSize: 50 })}`),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      (last.page + 1) * last.pageSize < last.total ? last.page + 1 : undefined,
    staleTime: 15_000,
  });

export const activityQuery = () =>
  queryOptions({
    queryKey: ['activity'],
    queryFn: () => api.get<ActivityRow[]>('/api/activity'),
    staleTime: 10_000,
  });

export const replayQuery = (id: string, enabled: boolean) =>
  queryOptions({
    queryKey: ['replay', id],
    queryFn: () => api.get<ReplayData>(`/api/sessions/${id}/replay`),
    enabled,
    staleTime: 60_000,
  });

export const statusQuery = () =>
  queryOptions({
    queryKey: ['status'],
    queryFn: () => api.get<StatusInfo>('/api/status'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

export const routinesQuery = () =>
  queryOptions({
    queryKey: ['routines'],
    queryFn: () => api.get<RoutinesData>('/api/routines'),
    staleTime: 10 * 60_000,
    retry: 0, // each fetch is a headless claude run — never auto-hammer it
  });

export const memoryTreeQuery = () =>
  queryOptions({
    queryKey: ['memory-tree'],
    queryFn: () => api.get<MemoryTree>('/api/memory'),
    staleTime: 60_000,
  });

export const alertsQuery = () =>
  queryOptions({
    queryKey: ['alerts'],
    queryFn: () => api.get<AlertsData>('/api/alerts'),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });

export const webhooksQuery = () =>
  queryOptions({
    queryKey: ['webhooks'],
    queryFn: () => api.get<Webhook[]>('/api/webhooks'),
    staleTime: 60_000,
  });

export const mcpServersQuery = () =>
  queryOptions({
    queryKey: ['mcp-servers'],
    queryFn: () => api.get<McpServersData>('/api/manage/mcp'),
    staleTime: 60_000,
    // the CLI health-checks every server — this call can take 10-60s
    retry: 0,
  });

export const manageInventoryQuery = () =>
  queryOptions({
    queryKey: ['manage-inventory'],
    queryFn: () => api.get<ManageInventory>('/api/manage/inventory'),
    staleTime: 5 * 60_000,
  });

export const claudeAiQuery = () =>
  queryOptions({
    queryKey: ['claudeai'],
    queryFn: () => api.get<ClaudeAiData>('/api/claudeai'),
    staleTime: 5 * 60_000,
  });

export const projectCalendarQuery = (id: number, month: string) =>
  queryOptions({
    queryKey: ['project-calendar', id, month],
    queryFn: () => api.get<ProjectCalendarData>(`/api/projects/${id}/calendar?month=${month}`),
    staleTime: 60_000,
  });

export const errorFeedQuery = () =>
  queryOptions({
    queryKey: ['errors'],
    queryFn: () => api.get<ErrorFeedData>('/api/errors'),
    staleTime: 60_000,
  });

export const tokenFlowQuery = (days = 30) =>
  queryOptions({
    queryKey: ['token-flow', days],
    queryFn: () => api.get<TokenFlowData>(`/api/token-flow?days=${days}`),
    staleTime: 5 * 60_000,
  });

export const schedulesQuery = () =>
  queryOptions({
    queryKey: ['schedules'],
    queryFn: () => api.get<ScheduledJob[]>('/api/schedules'),
    staleTime: 30_000,
  });

export const prsQuery = () =>
  queryOptions({
    queryKey: ['prs'],
    queryFn: () => api.get<PrOutcomesData>('/api/prs'),
    staleTime: 5 * 60_000,
  });

export const usageWindowQuery = () =>
  queryOptions({
    queryKey: ['usage-window'],
    queryFn: () => api.get<UsageWindowData>('/api/usage-window'),
    refetchInterval: 60_000,
  });

export const jobsQuery = () =>
  queryOptions({
    queryKey: ['jobs'],
    queryFn: () => api.get<JobsData>('/api/jobs'),
    // live output while anything runs; lazy otherwise
    refetchInterval: (q) => ((q.state.data?.running ?? 0) > 0 ? 2000 : 30_000),
  });

export const templatesQuery = () =>
  queryOptions({
    queryKey: ['templates'],
    queryFn: () => api.get<PromptTemplate[]>('/api/templates'),
    staleTime: 30_000,
  });

export const parseFailuresQuery = () =>
  queryOptions({
    queryKey: ['parse-failures'],
    queryFn: () => api.get<ParseFailuresData>('/api/parse-failures'),
    staleTime: 15_000,
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/api/settings'),
  });

/** Query-key prefixes refreshed when the tracker signals data changes. */
export const LIVE_KEYS: readonly (readonly string[])[] = [
  ['overview'], ['timeline'], ['stats'], ['heatmap'], ['projects'], ['project'],
  ['sessions'], ['session'], ['prompts'], ['journal'], ['status'], ['activity'],
  ['alerts'],
];
