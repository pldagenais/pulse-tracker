import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, requireAgent } from "./lib/guards";

/**
 * Command queue. The remote UI enqueues; the local agent claims and executes.
 * Only the agent may transition a job, so the browser can never fake results.
 */

export const enqueue = mutation({
  args: { kind: v.string(), payload: v.any() },
  handler: async (ctx, { kind, payload }) => {
    const login = await requireUser(ctx);
    return await ctx.db.insert("jobs", {
      kind,
      payload,
      status: "queued",
      requestedBy: login,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    return await ctx.db.query("jobs").order("desc").take(Math.min(limit ?? 20, 50));
  },
});

export const claimNext = mutation({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) => {
    requireAgent(agentKey);
    const next = await ctx.db
      .query("jobs")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "queued"))
      .order("asc")
      .first();
    if (!next) return null;
    await ctx.db.patch(next._id, { status: "running", claimedAt: Date.now() });
    return { ...next, status: "running" };
  },
});

export const update = mutation({
  args: {
    agentKey: v.string(),
    id: v.id("jobs"),
    status: v.optional(v.string()),
    outputTail: v.optional(v.string()),
    localJobId: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { agentKey, id, ...patch }) => {
    requireAgent(agentKey);
    const clean: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (clean.status === "done" || clean.status === "error") {
      clean.finishedAt = Date.now();
    }
    await ctx.db.patch(id, clean);
    return { ok: true };
  },
});
