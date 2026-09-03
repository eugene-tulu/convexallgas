import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_timestamp")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const forObligation = query({
  args: { obligationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_timestamp")
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("rowId"), args.obligationId),
          q.eq(q.field("table"), "obligations")
        )
      )
      .take(20);
  },
});

export const byAction = query({
  args: { action: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("events")
      .withIndex("by_timestamp")
      .order("desc")
      .filter((q) => q.eq(q.field("action"), args.action))
      .take(args.limit ?? 50);
  },
});
