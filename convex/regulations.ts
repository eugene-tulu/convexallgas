import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

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

export const insertRegulation = internalMutation({
  args: {
    sourceUrl: v.string(),
    agency: v.string(),
    extractedText: v.string(),
    summary: v.string(),
    affectedProjectIds: v.array(v.id("projects")),
    crawledAt: v.number(),
    isNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("regulations")
      .withIndex("by_crawledAt")
      .filter((q) => q.eq(q.field("sourceUrl"), args.sourceUrl))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        extractedText: args.extractedText,
        summary: args.summary,
        agency: args.agency,
        crawledAt: args.crawledAt,
        isNew: args.isNew,
        affectedProjectIds: args.affectedProjectIds,
      });
      return existing._id;
    }

    return await ctx.db.insert("regulations", args);
  },
});
