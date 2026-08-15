import { query } from "./_generated/server";
import { requireUser } from "./lib/guards";

/** Heartbeat row — the SPA uses it to detect that the PC is offline. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return (
      (await ctx.db
        .query("agent")
        .withIndex("by_key", (q) => q.eq("key", "status"))
        .unique()) ?? null
    );
  },
});
