import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()), projectId: v.optional(v.number()) },
  handler: async (ctx, { limit, projectId }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_startedAt")
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    return rows
      .filter((r) => projectId == null || r.projectId === projectId)
      .map((r) => r.payload);
  },
});
