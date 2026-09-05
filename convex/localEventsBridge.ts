import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getBusinessForEvents = internalQuery({
  args: { id: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listActiveBusinessIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("businesses").take(100);
    return rows.map((b) => b._id);
  },
});

export const insertLocalEvent = internalMutation({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    sourceUrl: v.string(),
    venueText: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    eventDate: v.optional(v.number()),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args): Promise<string> => {
    return await ctx.db.insert("localEvents", args);
  },
});

export const recentForBusiness = internalQuery({
  args: {
    businessId: v.id("businesses"),
    sinceFetchedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.sinceFetchedAt ?? Date.now() - 3 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("localEvents")
      .withIndex("by_businessId_fetchedAt", (q) =>
        q.eq("businessId", args.businessId).gte("fetchedAt", since)
      )
      .collect();
    return rows;
  },
});
