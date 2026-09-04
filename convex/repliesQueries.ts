import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";


const SHIFT_TAG_RE = /\[shift:([a-zA-Z0-9_-]+)\]/;

export const shortlist = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_shiftId_receivedAt", (q) => q.eq("shiftId", args.shiftId))
      .order("asc")
      .collect();
    const out = [];
    for (const r of responses) {
      let worker: { name: string; contact: string; reliabilityScore: number } | null = null;
      if (r.workerId) {
        const w = await ctx.db.get(r.workerId);
        if (w) {
          worker = {
            name: w.name,
            contact: w.contact,
            reliabilityScore: w.reliabilityScore,
          };
        }
      }
      out.push({ ...r, worker });
    }
    return out.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  },
});

export const approveCandidate = mutation({
  args: {
    shiftId: v.id("shifts"),
    responseId: v.id("responses"),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    if (shift.status !== "broadcasting" && shift.status !== "shortlist_ready") {
      // Don't throw — log the race-loss and return so the events row actually commits.
      // The caller can detect this via `confirmed: false`.
      await ctx.db.insert("events", {
        table: "shifts",
        rowId: shift._id,
        action: "approval_lost_race",
        timestamp: Date.now(),
        summary: `Approval attempt for response ${args.responseId} lost the race - shift already in status "${shift.status}"`,
      });
      return { confirmed: false, reason: "lost_race", currentStatus: shift.status };
    }
    const response = await ctx.db.get(args.responseId);
    if (!response) throw new Error("Response not found");
    if (response.shiftId !== shift._id) throw new Error("Response is for a different shift");
    if (response.source !== "internal" || !response.workerId) {
      throw new Error("External candidates need a separate flow");
    }

    const now = Date.now();
    await ctx.db.patch(shift._id, {
      status: "confirmed",
      confirmedAt: now,
      confirmedByResponseId: args.responseId,
    });
    await ctx.db.insert("events", {
      table: "shifts",
      rowId: shift._id,
      action: "shift_confirmed",
      timestamp: now,
      summary: `Confirmed by response ${args.responseId} (elapsed ${Math.round(
        (now - (shift.broadcastAt ?? now)) / 1000
      )}s from broadcast)`,
    });

    await ctx.scheduler.runAfter(0, internal.repliesBridge.sendConfirmAndRejects, {
      shiftId: shift._id,
      winningResponseId: args.responseId,
    });
    return { confirmed: true, confirmedAt: now };
  },
});
