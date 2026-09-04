import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getBusiness = internalQuery({
  args: { id: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
