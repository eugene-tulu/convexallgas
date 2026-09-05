"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";

export const composeRiskFlag = action({
  args: {
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<string> => {
    const [historical, nearby] = await Promise.all([
      ctx.runQuery(internal.riskFlagQueries.getHistoricalSummary, { businessId: args.businessId }),
      ctx.runQuery(api.localEventsQueries.recentForBusiness, { businessId: args.businessId }),
    ]);
    const eventsForPrompt = (nearby ?? []).map((e: { title: string; eventDate?: number }) => ({
      title: e.title,
      eventDate: e.eventDate,
    }));
    const text = (await ctx.runAction(api.llmTasks.draftRiskFlag, {
      historicalSummary: historical,
      nearbyEvents: eventsForPrompt,
    })) as string;
    return text;
  },
});
