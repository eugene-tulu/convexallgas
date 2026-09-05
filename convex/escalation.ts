"use node";
import { internalAction, internalMutation } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";
import { urgencyTimeoutMs } from "./shifts";

export const checkEscalations = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    const now = Date.now();
    const due = await ctx.runQuery(internal.escalationBridge.findDueShifts, { now });
    for (const shift of due) {
      if (shift.status === "shortlist_ready") continue;
      await ctx.runMutation(internal.escalationBridge.markEscalating, { id: shift._id });
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "shifts",
        rowId: shift._id,
        action: "escalation_started",
        summary: `Internal timeout reached (urgency=${shift.urgency}); searching external sources`,
      });
      await ctx.scheduler.runAfter(0, internal.escalationBridge.runEscalationSearch, {
        shiftId: shift._id,
      });
    }
    return { checked: due.length };
  },
});

export const findExternalCandidates = internalAction({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const shift = await ctx.runQuery(internal.shiftsBridge.getShift, {
      shiftId: args.shiftId,
    });
    if (!shift) return { inserted: 0 };
    const business = await ctx.runQuery(internal.businessesBridge.getBusiness, {
      id: shift.businessId,
    });
    if (!business) return { inserted: 0 };

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const warm = await ctx.runQuery(internal.escalationBridge.findWarmCandidates, {
      location: business.location,
      role: shift.role,
      since,
    });
    if (warm.length > 0) {
      let inserted = 0;
      for (const c of warm) {
        await ctx.runMutation(internal.repliesBridge.insertExternalResponse, {
          shiftId: shift._id,
          externalCandidateRef: c.candidateContact + "|" + c.sourceUrl,
          externalSourceUrl: c.sourceUrl,
        });
        inserted++;
      }
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "shifts",
        rowId: shift._id,
        action: "escalation_warm_hits",
        summary: `Found ${inserted} warm backup-pool candidate(s) for "${shift.role}" near ${business.location}`,
      });
      return { inserted, source: "warm" };
    }

    const query = `${shift.role} jobs near ${business.location}`;
    let results: { title: string; url: string; description: string }[] = [];
    try {
      results = (await ctx.runAction(api.firecrawl.search, {
        query,
        limit: 10,
      })) as { title: string; url: string; description: string }[];
    } catch (e) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "shifts",
        rowId: shift._id,
        action: "escalation_search_failed",
        summary: `Firecrawl search failed: ${(e as Error).message}`,
      });
      return { inserted: 0, source: "live", error: (e as Error).message };
    }
    let inserted = 0;
    for (const r of results) {
      await ctx.runMutation(internal.repliesBridge.insertExternalResponse, {
        shiftId: shift._id,
        externalCandidateRef: r.url,
        externalSourceUrl: r.url,
      });
      inserted++;
    }
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "shifts",
      rowId: shift._id,
      action: "escalation_live_search",
      summary: `Live Firecrawl search for "${query}" returned ${results.length}, inserted ${inserted}`,
    });
    return { inserted, source: "live" };
  },
});
