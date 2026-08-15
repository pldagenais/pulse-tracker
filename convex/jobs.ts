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

/**
 * The Run page's job list. Rows must carry the same fields as the local
 * jobRow (prompt, model, endedAt, …) — the queue table stores {kind, payload}
 * instead, which is a different shape entirely.
 *
 * The mirrored /api/jobs snapshot is the real list; remote jobs that the agent
 * has not claimed yet exist only here, so they are prepended to give the user
 * immediate feedback instead of a blank list until the next sync.
 */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const snap = await ctx.db
      .query("snapshots")
      .withIndex("by_key", (q) => q.eq("key", "jobs"))
      .unique();
    const mirrored = (snap?.payload ?? { jobs: [], running: 0 }) as {
      jobs: unknown[];
      running: number;
    };

    const queued = await ctx.db
      .query("jobs")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "queued"))
      .order("desc")
      .take(20);
    const pending = queued
      .filter((j) => j.kind === "run")
      .map((j) => {
        const p = (j.payload ?? {}) as Record<string, unknown>;
        return {
          id: j._id,
          createdAt: j.createdAt,
          sessionId: null,
          resumeOf: null,
          projectId: p.projectId ?? null,
          projectPath: p.projectPath ?? null,
          prompt: String(p.prompt ?? ""),
          model: p.model ?? null,
          maxTurns: p.maxTurns ?? null,
          permissionMode: "default",
          status: "queued",
          exitCode: null,
          startedAt: null,
          endedAt: null,
          outputTail: null,
        };
      });

    return {
      jobs: [...pending, ...mirrored.jobs].slice(0, Math.min(limit ?? 50, 50)),
      running: mirrored.running ?? 0,
    };
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
