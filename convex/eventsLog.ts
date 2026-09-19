import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const logEvent = internalMutation({
  args: {
    ownerId: v.optional(v.string()),
    table: v.string(),
    rowId: v.string(),
    action: v.string(),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("events", {
      ownerId: args.ownerId,
      table: args.table,
      rowId: args.rowId,
      action: args.action,
      timestamp: Date.now(),
      summary: args.summary,
    });
    return null;
  },
});
