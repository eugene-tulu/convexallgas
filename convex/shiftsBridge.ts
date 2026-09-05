import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getShift = internalQuery({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.shiftId);
  },
});

// `status` is typed as a plain `v.string()` here (not the schema's literal
// union) to keep the Convex validator's generic depth shallow. The runtime
// check below enforces the same set of literals callers can pass. The schema
// itself still validates the column's data type.
const SHIFT_STATUSES = new Set([
  "broadcasting",
  "shortlist_ready",
  "escalating",
  "confirmed",
  "cancelled",
]);

const shiftPatchValidator = v.object({
  status: v.optional(v.string()),
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
    if (typeof clean.status === "string" && !SHIFT_STATUSES.has(clean.status)) {
      throw new Error(`Invalid shift status: ${clean.status}`);
    }
    await ctx.db.patch(args.id, clean);
  },
});
