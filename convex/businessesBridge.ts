import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getBusiness = internalQuery({
  args: { id: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const insertBusiness = internalMutation({
  args: {
    name: v.string(),
    category: v.string(),
    hoursJson: v.string(),
    sizeSignal: v.string(),
    location: v.string(),
    sourceUrl: v.string(),
    inboxId: v.string(),
    inboxEmail: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    return await ctx.db.insert("businesses", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
