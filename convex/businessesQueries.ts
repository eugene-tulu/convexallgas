import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("businesses").order("desc").take(50);
  },
});

export const get = query({
  args: { id: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const ensureDemoUser = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "demo@proxy.dev"))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", { name: "Demo Manager", email: "demo@proxy.dev" });
  },
});
