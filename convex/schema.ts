import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Cloud mirror of the local Pulse database.
 *
 * `snapshots` stores the *verbatim* JSON that the local REST API returns,
 * keyed by the request it answers ("overview:2026-08-14"). That keeps the
 * React components byte-identical between local and cloud mode. The other
 * tables hold the small collections that need real querying remotely.
 *
 * Raw events (50k+ rows) are never mirrored — everything derived from them
 * ships as a precomputed snapshot.
 */
export default defineSchema({
  snapshots: defineTable({
    key: v.string(),
    kind: v.string(),
    day: v.optional(v.string()),
    payload: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  sessions: defineTable({
    sessionId: v.string(),
    projectId: v.number(),
    projectName: v.string(),
    title: v.union(v.string(), v.null()),
    startedAt: v.union(v.number(), v.null()),
    claudeMs: v.number(),
    estCostUsd: v.union(v.number(), v.null()),
    promptCount: v.number(),
    payload: v.any(),
    updatedAt: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_startedAt", ["startedAt"]),

  prompts: defineTable({
    uuid: v.string(),
    sessionId: v.string(),
    projectId: v.number(),
    projectName: v.union(v.string(), v.null()),
    sessionTitle: v.union(v.string(), v.null()),
    ts: v.number(),
    kind: v.string(),
    text: v.string(),
    charCount: v.number(),
  })
    .index("by_uuid", ["uuid"])
    .index("by_ts", ["ts"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["projectId", "kind"],
    }),

  journal: defineTable({
    localId: v.number(),
    ts: v.number(),
    projectPath: v.union(v.string(), v.null()),
    projectName: v.union(v.string(), v.null()),
    sessionId: v.union(v.string(), v.null()),
    text: v.string(),
    source: v.string(),
  })
    .index("by_localId", ["localId"])
    .index("by_ts", ["ts"]),

  // Commands queued from the remote UI and executed by the local agent.
  jobs: defineTable({
    kind: v.string(), // "run" | "kill"
    status: v.string(), // "queued" | "running" | "done" | "error"
    payload: v.any(),
    requestedBy: v.string(),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    localJobId: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    outputTail: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_status_createdAt", ["status", "createdAt"]),

  // Single row ("status") proving the local agent is alive.
  agent: defineTable({
    key: v.string(),
    lastHeartbeatAt: v.number(),
    version: v.string(),
    ingestPhase: v.string(),
    liveCount: v.number(),
    dbSessions: v.number(),
    syncedThrough: v.number(),
  }).index("by_key", ["key"]),
});
