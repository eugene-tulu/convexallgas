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
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string> => {
    return await ctx.db.insert("businesses", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const patchBusinessGeocode = internalMutation({
  args: {
    id: v.id("businesses"),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.id, { lat: args.lat, lng: args.lng });
  },
});
