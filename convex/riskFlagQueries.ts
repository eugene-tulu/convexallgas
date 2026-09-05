import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

const TTL_MS = 24 * 60 * 60 * 1000; // recompute at most once per day

// Look at the last 30 days of shifts for this business and return a
// one-line plain-text summary of the escalation rate, or empty string if
// there's not enough history. Uses the `by_businessId_creationTime` index
// so the query does an index range scan on the server rather than loading
// all rows into JS memory.
export const getHistoricalSummary = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<string> => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    const recent = await ctx.db
      .query("shifts")
      .withIndex("by_businessId_creationTime", (q) =>
        q.eq("businessId", args.businessId).gte("_creationTime", since)
      )
      .collect();
    if (recent.length < 3) return ""; // need a real sample
    const escalated = recent.filter(
      (s) => s.status === "escalating" || (s.confirmedAt && s.broadcastAt && s.confirmedAt - s.broadcastAt > 5 * 60 * 1000)
    ).length;
    const rate = Math.round((escalated / recent.length) * 100);
    if (rate === 0) return `${recent.length} recent shifts, all confirmed within 5 min of broadcast.`;
    return `${escalated} of last ${recent.length} shifts (${rate}%) needed backup or took longer than 5 min to confirm.`;
  },
});

export const getCached = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("riskFlags")
      .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
      .unique();
  },
});

// Public query the front-end reads instead of calling an action.
export const current = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("riskFlags")
      .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
      .unique();
    if (!row) return null;
    const stale = Date.now() - row.computedAt > TTL_MS;
    return { ...row, stale };
  },
});

export const upsert = internalMutation({
  args: {
    businessId: v.id("businesses"),
    summary: v.string(),
    historicalSummary: v.string(),
    nearbyEventTitles: v.array(v.string()),
    computedAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query("riskFlags")
      .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        summary: args.summary,
        historicalSummary: args.historicalSummary,
        nearbyEventTitles: args.nearbyEventTitles,
        computedAt: args.computedAt,
      });
      return;
    }
    await ctx.db.insert("riskFlags", args);
  },
});
