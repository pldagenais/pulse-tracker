import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAgent } from "./lib/guards";

/**
 * Agent-only writes. The local Pulse server is the source of truth; these
 * mutations only ever receive derived data it has already computed.
 * Every function upserts by natural key so re-syncing is idempotent.
 */

export const putSnapshots = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        key: v.string(),
        kind: v.string(),
        day: v.optional(v.string()),
        payload: v.any(),
        updatedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("snapshots")
        .withIndex("by_key", (q) => q.eq("key", item.key))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("snapshots", item);
    }
    return { written: items.length };
  },
});

export const putSessions = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
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
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", item.sessionId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("sessions", item);
    }
    return { written: items.length };
  },
});

export const putPrompts = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        uuid: v.string(),
        sessionId: v.string(),
        projectId: v.number(),
        projectName: v.union(v.string(), v.null()),
        sessionTitle: v.union(v.string(), v.null()),
        ts: v.number(),
        kind: v.string(),
        text: v.string(),
        charCount: v.number(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("prompts")
        .withIndex("by_uuid", (q) => q.eq("uuid", item.uuid))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("prompts", item);
    }
    return { written: items.length };
  },
});

export const putJournal = mutation({
  args: {
    agentKey: v.string(),
    items: v.array(
      v.object({
        localId: v.number(),
        ts: v.number(),
        projectPath: v.union(v.string(), v.null()),
        projectName: v.union(v.string(), v.null()),
        sessionId: v.union(v.string(), v.null()),
        text: v.string(),
        source: v.string(),
      }),
    ),
  },
  handler: async (ctx, { agentKey, items }) => {
    requireAgent(agentKey);
    for (const item of items) {
      const existing = await ctx.db
        .query("journal")
        .withIndex("by_localId", (q) => q.eq("localId", item.localId))
        .unique();
      if (existing) await ctx.db.patch(existing._id, item);
      else await ctx.db.insert("journal", item);
    }
    return { written: items.length };
  },
});

export const heartbeat = mutation({
  args: {
    agentKey: v.string(),
    version: v.string(),
    ingestPhase: v.string(),
    liveCount: v.number(),
    dbSessions: v.number(),
    syncedThrough: v.number(),
    tz: v.optional(v.string()),
  },
  handler: async (ctx, { agentKey, ...rest }) => {
    requireAgent(agentKey);
    const row = { key: "status", lastHeartbeatAt: Date.now(), ...rest };
    const existing = await ctx.db
      .query("agent")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("agent", row);
    return { ok: true };
  },
});
