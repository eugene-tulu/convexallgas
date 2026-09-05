import { v } from "convex/values";
import { query } from "./_generated/server";

export const recentForBusiness = query({
  args: {
    businessId: v.id("businesses"),
    sinceFetchedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.sinceFetchedAt ?? Date.now() - 3 * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("localEvents")
      .withIndex("by_businessId_fetchedAt", (q) =>
        q.eq("businessId", args.businessId).gte("fetchedAt", since)
      )
      .collect();
  },
});
