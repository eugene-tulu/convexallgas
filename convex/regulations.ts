import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("regulations")
      .withIndex("by_crawledAt")
      .order("desc")
      .collect();
  },
});

export const listByAgency = query({
  args: { agency: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("regulations")
      .filter((q) => q.eq(q.field("agency"), args.agency))
      .collect();
  },
});
