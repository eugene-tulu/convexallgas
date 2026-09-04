import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const findBusinessByName = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("businesses").take(50);
    const hit = all.find((b) => b.name === args.name);
    return hit ? hit._id : null;
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
  handler: async (ctx, args) => {
    return await ctx.db.insert("businesses", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const insertWorker = internalMutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    contact: v.string(),
    roles: v.array(v.string()),
    location: v.string(),
    consent: v.boolean(),
    reliabilityScore: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workers", {
      ...args,
      consentedAt: args.consent ? Date.now() : undefined,
    });
  },
});

export const listSeed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(10);
    const workers = await ctx.db.query("workers").take(50);
    const shifts = await ctx.db.query("shifts").take(50);
    return { businesses, workers, shifts };
  },
});
