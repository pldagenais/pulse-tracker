import { query } from "./_generated/server";
import { requireUser } from "./lib/guards";

/**
 * Serves GET /api/status remotely: the mirrored status payload (so the Status
 * page renders the same fields as locally) plus the agent heartbeat, which the
 * SPA uses to tell that the PC is offline.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const agent = await ctx.db
      .query("agent")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    const snap = await ctx.db
      .query("snapshots")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    const base = (snap?.payload ?? {}) as Record<string, unknown>;
    return {
      ...base,
      lastHeartbeatAt: agent?.lastHeartbeatAt ?? null,
      ingestPhase: agent?.ingestPhase ?? null,
    };
  },
});
