import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()), projectId: v.optional(v.number()) },
  handler: async (ctx, { limit, projectId }) => {
    await requireUser(ctx);
    const pageSize = Math.min(limit ?? 50, 200);
    const found = await ctx.db
      .query("sessions")
      .withIndex("by_startedAt")
      .order("desc")
      .take(pageSize);
    const rows = found
      .filter((r) => projectId == null || r.projectId === projectId)
      .map((r) => r.payload);
    // Same envelope as GET /api/sessions — the SPA reads `.rows` in both modes.
    return { total: rows.length, page: 0, pageSize, rows };
  },
});
