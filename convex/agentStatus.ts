import { query } from "./_generated/server";
import { requireUser } from "./lib/guards";

/**
 * Serves GET /api/status remotely: the mirrored status payload (so the Status
 * page renders the same fields as locally) plus the agent heartbeat.
 *
 * Returns null — never a partial object — when the snapshot has not synced.
 * The Status page reads `d?.watcher.watching`, and optional chaining only
 * short-circuits when `d` itself is nullish; an object missing `watcher`
 * throws and white-screens the page.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const snap = await ctx.db
      .query("snapshots")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    if (!snap) return null;
    const agent = await ctx.db
      .query("agent")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    return {
      ...(snap.payload as Record<string, unknown>),
      lastHeartbeatAt: agent?.lastHeartbeatAt ?? null,
      ingestPhase: agent?.ingestPhase ?? null,
    };
  },
});

/**
 * Just the heartbeat. Separate from `get` on purpose: the offline banner needs
 * to know the PC is unreachable precisely in the situations where the status
 * snapshot may be missing or stale, so it must not depend on that snapshot.
 */
export const heartbeat = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const agent = await ctx.db
      .query("agent")
      .withIndex("by_key", (q) => q.eq("key", "status"))
      .unique();
    return { lastHeartbeatAt: agent?.lastHeartbeatAt ?? null };
  },
});
