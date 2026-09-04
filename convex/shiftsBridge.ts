import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getShift = internalQuery({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.shiftId);
  },
});

const shiftPatchValidator = v.object({
  status: v.optional(
    v.union(
      v.literal("broadcasting"),
      v.literal("shortlist_ready"),
      v.literal("escalating"),
      v.literal("confirmed"),
      v.literal("cancelled")
    )
  ),
  timeoutAt: v.optional(v.number()),
  broadcastAt: v.optional(v.number()),
  broadcastRound: v.optional(v.number()),
  displayRate: v.optional(v.number()),
  displayRateLabel: v.optional(v.string()),
  confirmedAt: v.optional(v.number()),
  confirmedByResponseId: v.optional(v.id("responses")),
});

export const patchShift = internalMutation({
  args: {
    id: v.id("shifts"),
    patch: shiftPatchValidator,
  },
  handler: async (ctx, args) => {
    // Drop undefined fields so we never overwrite a column with undefined.
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.patch)) {
      if (v !== undefined) clean[k] = v;
    }
    await ctx.db.patch(args.id, clean);
  },
});
