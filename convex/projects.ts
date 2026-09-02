import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("projects")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
  },
});

export const updateContactEmail = mutation({
  args: {
    id: v.id("projects"),
    contactEmail: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { contactEmail: args.contactEmail });
    return { success: true };
  },
});
