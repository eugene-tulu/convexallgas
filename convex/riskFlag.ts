"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// Computes the risk flag for a business and upserts the cache. Called by:
//   - the daily `fetch local events` cron (after fetchLocalEvents for that
//     business completes), so the cache is always fresh;
//   - the `refresh` public action wrapper, for the rare case where a
//     manager wants to force a recompute.
//
// Not called from the front-end on every render. The front-end reads the
// cached `current` query (in `riskFlagQueries.ts`), so a manager clicking
// around the UI does not burn an LLM call per click.
export const composeRiskFlag = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<string> => {
    const [historical, nearby] = await Promise.all([
      ctx.runQuery(internal.riskFlagQueries.getHistoricalSummary, { businessId: args.businessId }),
      ctx.runQuery(internal.localEventsBridge.recentForBusiness, { businessId: args.businessId }),
    ]);
    const eventsForPrompt = (nearby ?? []).map((e: { title: string; eventDate?: number }) => ({
      title: e.title,
      eventDate: e.eventDate,
    }));
    const summary = (await ctx.runAction(api.llmTasks.draftRiskFlag, {
      historicalSummary: historical,
      nearbyEvents: eventsForPrompt,
    })) as string;
    const titles = eventsForPrompt.map((e: { title: string }) => e.title);
    await ctx.runMutation(internal.riskFlagQueries.upsert, {
      businessId: args.businessId,
      summary: summary ?? "",
      historicalSummary: historical,
      nearbyEventTitles: titles,
      computedAt: Date.now(),
    });
    return summary ?? "";
  },
});

// Public wrapper so the front-end can force a refresh after a meaningful
// event (e.g. just escalated a shift, the historical signal changed).
// Not invoked on every render.
export const refresh = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runAction(internal.riskFlag.composeRiskFlag, args);
  },
});
