import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

/**
 * Returns the mirrored REST payload verbatim, so cloud-mode components
 * receive exactly what the local API would have returned. Null means the
 * key was never synced (e.g. a day outside the rolling window).
 */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("snapshots")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.payload ?? null;
  },
});
