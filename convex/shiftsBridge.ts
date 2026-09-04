import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getShift = internalQuery({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.shiftId);
  },
});

export const patchShift = internalMutation({
  args: {
    id: v.id("shifts"),
    patch: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.patch as Record<string, unknown>);
  },
});
