import { v } from "convex/values";
import { mutation, action, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const URGENCY_TIMEOUTS_MS: Record<string, number> = {
  critical: 3 * 60 * 1000,
  urgent: 5 * 60 * 1000,
  normal: 10 * 60 * 1000,
  low: 20 * 60 * 1000,
};

const URGENCIES = new Set(Object.keys(URGENCY_TIMEOUTS_MS));

export function urgencyTimeoutMs(urgency: string): number {
  return URGENCY_TIMEOUTS_MS[urgency] ?? URGENCY_TIMEOUTS_MS.normal;
}

export const postShift = mutation({
  args: {
    businessId: v.id("businesses"),
    role: v.string(),
    startTime: v.number(),
    // `v.string()` (not a 4-literal union) to keep the Convex validator's
    // generic depth shallow. The runtime check below + the schema's typed
    // `shifts.urgency` column still constrain the value.
    urgency: v.string(),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    workerIds: v.optional(v.array(v.id("workers"))),
  },
  handler: async (ctx, args) => {
    if (!URGENCIES.has(args.urgency)) {
      throw new Error(`Invalid urgency: ${args.urgency}`);
    }
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new Error("Business not found");
    const timeoutAt = Date.now() + urgencyTimeoutMs(args.urgency);
    const shiftId = await ctx.db.insert("shifts", {
      businessId: args.businessId,
      role: args.role,
      startTime: args.startTime,
      urgency: args.urgency as "critical" | "urgent" | "normal" | "low",
      status: "broadcasting",
      timeoutAt,
      displayRate: args.displayRate,
      displayRateLabel: args.displayRateLabel,
      broadcastRound: 0,
    });
    await ctx.db.insert("events", {
      table: "shifts",
      rowId: shiftId,
      action: "shift_posted",
      timestamp: Date.now(),
      summary: `Posted ${args.urgency} shift "${args.role}" for ${new Date(args.startTime).toLocaleString()} at $${args.displayRate}${args.displayRateLabel}`,
    });
    await ctx.scheduler.runAfter(0, internal.shiftsActions.broadcastShift, {
      shiftId,
      workerIds: args.workerIds ?? [],
    });
    return shiftId;
  },
});

export const rebroadcastShift = mutation({
  args: {
    shiftId: v.id("shifts"),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    workerIds: v.optional(v.array(v.id("workers"))),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    if (shift.status !== "escalating" && shift.status !== "broadcasting") {
      throw new Error(`Cannot re-broadcast from status ${shift.status}`);
    }
    const newRound = shift.broadcastRound + 1;
    const now = Date.now();
    await ctx.db.patch(args.shiftId, {
      status: "broadcasting",
      broadcastRound: newRound,
      broadcastAt: now,
      timeoutAt: now + urgencyTimeoutMs(shift.urgency),
      displayRate: args.displayRate,
      displayRateLabel: args.displayRateLabel,
    });
    await ctx.db.insert("events", {
      table: "shifts",
      rowId: args.shiftId,
      action: "shift_rebroadcast",
      timestamp: now,
      summary: `Re-broadcast round ${newRound} at $${args.displayRate}${args.displayRateLabel}`,
    });
    await ctx.scheduler.runAfter(0, internal.shiftsActions.broadcastShift, {
      shiftId: args.shiftId,
      workerIds: args.workerIds ?? [],
    });
  },
});

export const list = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const q = args.businessId
      ? ctx.db.query("shifts").withIndex("by_businessId_status", (qq) =>
          qq.eq("businessId", args.businessId!)
        )
      : ctx.db.query("shifts");
    return await q.order("desc").take(50);
  },
});

export const get = query({
  args: { id: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
