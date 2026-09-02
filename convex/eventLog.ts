import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const logEvent = internalMutation({
  args: {
    table: v.string(),
    rowId: v.string(),
    action: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      table: args.table,
      rowId: args.rowId,
      action: args.action,
      timestamp: Date.now(),
      summary: args.summary,
    });
  },
});
