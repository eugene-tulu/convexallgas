import { v } from "convex/values";
import { query } from "./_generated/server";

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

export const forShift = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("events")
      .withIndex("by_table_rowId", (q) => q.eq("table", "shifts").eq("rowId", args.shiftId))
      .order("desc")
      .take(50);
    return all;
  },
});
