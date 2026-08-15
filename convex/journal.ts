import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("journal")
      .withIndex("by_ts")
      .order("desc")
      .take(Math.min(limit ?? 50, 200));
    // rename localId → id so the shape matches the local REST response
    return rows.map(({ _id, _creationTime, localId, ...rest }) => ({
      id: localId,
      ...rest,
    }));
  },
});
