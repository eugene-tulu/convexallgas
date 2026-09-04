"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export const runSeed = action({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.seed.seedDemo, {});
  },
});
