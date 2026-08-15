import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/guards";

/** Full-text prompt search; falls back to newest-first when no query given. */
export const search = query({
  args: {
    q: v.optional(v.string()),
    limit: v.optional(v.number()),
    projectId: v.optional(v.number()),
  },
  handler: async (ctx, { q, limit, projectId }) => {
    await requireUser(ctx);
    const take = Math.min(limit ?? 50, 200);
    const rows = q
      ? await ctx.db
          .query("prompts")
          .withSearchIndex("search_text", (s) => {
            const base = s.search("text", q);
            return projectId == null ? base : base.eq("projectId", projectId);
          })
          .take(take)
      : await ctx.db.query("prompts").withIndex("by_ts").order("desc").take(take);
    return rows.map(({ _id, _creationTime, ...rest }) => rest);
  },
});
