import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Look at the last N shifts for this business (regardless of role — the
// historical signal is per-location, not per-role, because most of these
// businesses have one or two roles and the sample size is too small to
// slice finer). Return a one-line plain-text summary of the escalation
// rate, or empty string if there's not enough history.
export const getHistoricalSummary = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<string> => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const shifts = await ctx.db
      .query("shifts")
      .withIndex("by_businessId_status", (q) => q.eq("businessId", args.businessId))
      .collect();
    const recent = shifts.filter((s) => s._creationTime >= since);
    if (recent.length < 3) return ""; // need a real sample
    const escalated = recent.filter(
      (s) => s.status === "escalating" || (s.confirmedAt && s.broadcastAt && s.confirmedAt - s.broadcastAt > 5 * 60 * 1000)
    ).length;
    const rate = Math.round((escalated / recent.length) * 100);
    if (rate === 0) return `${recent.length} recent shifts, all confirmed within 5 min of broadcast.`;
    return `${escalated} of last ${recent.length} shifts (${rate}%) needed backup or took longer than 5 min to confirm.`;
  },
});
