import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const pageSize = Math.min(limit ?? 50, 200);
    const found = await ctx.db
      .query("journal")
      .withIndex("by_ts")
      .order("desc")
      .take(pageSize);
    // rename localId → id so the shape matches the local REST response
    const rows = found.map(({ _id, _creationTime, localId, ...rest }) => ({
      id: localId,
      ...rest,
    }));
    // Same envelope as GET /api/journal — the SPA reads `.rows` in both modes.
    return { total: rows.length, page: 0, pageSize, rows };
  },
});
