"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// All test helpers are internal — they were exposed during initial verification
// but must not be callable from the client. Use the Convex dashboard to invoke.
export const simulateReply = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runAction(internal.replies.processBroadcastReply, {
      inboxId: args.inboxId,
      messageId: args.messageId,
      subject: args.subject,
      from: args.from,
      text: args.text,
      html: undefined,
    });
  },
});

export const triggerEscalation = internalAction({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runAction(internal.escalationBridge.runEscalationSearch, {
      shiftId: args.shiftId,
    });
  },
});

export const triggerEscalationCron = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    return await ctx.runAction(internal.escalation.checkEscalations, {});
  },
});

export const raceApprove = internalAction({
  args: { shiftId: v.id("shifts"), responseId: v.id("responses") },
  handler: async (ctx, args): Promise<unknown> => {
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        ctx.runMutation(api.repliesQueries.approveCandidate, {
          shiftId: args.shiftId,
          responseId: args.responseId,
        }).catch((e: Error) => ({ error: e.message }))
      );
    }
    return await Promise.all(promises);
  },
});

export const testConsentFilter = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<unknown> => {
    const consented = await ctx.runQuery(internal.workersBridge.listConsentedForBusiness, {
      businessId: args.businessId,
    });
    const all = await ctx.runQuery(api.workers.list, { businessId: args.businessId });
    return {
      total: all.length,
      consented: consented.length,
      consentedContacts: consented.map((c: { contact: string }) => c.contact),
      nonConsented: all
        .filter((w: { consent: boolean }) => !w.consent)
        .map((w: { contact: string }) => w.contact),
    };
  },
});

export const testBackupPoolTtl = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<unknown> => {
    const staleId: string = await ctx.runMutation(
      internal.escalationBridge.insertPoolEntry,
      {
        location: "Merced, CA",
        role: "barista",
        candidateContact: "stale@example.com",
        candidateName: "Stale Entry",
        sourceUrl: "https://example.com/stale",
        crawledAt: Date.now() - 25 * 60 * 60 * 1000,
      }
    );
    const freshId: string = await ctx.runMutation(
      internal.escalationBridge.insertPoolEntry,
      {
        location: "Merced, CA",
        role: "barista",
        candidateContact: "fresh@example.com",
        candidateName: "Fresh Entry",
        sourceUrl: "https://example.com/fresh",
        crawledAt: Date.now(),
      }
    );
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const visible = await ctx.runQuery(internal.escalationBridge.findWarmCandidates, {
      location: "Merced, CA",
      role: "barista",
      since,
    });
    return {
      staleInserted: staleId,
      freshInserted: freshId,
      visibleCount: visible.length,
      visibleContact: visible[0]?.candidateContact,
    };
  },
});

export const testGeocodeLocation = internalAction({
  args: { query: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    const { geocodeLocation } = await import("./geocode");
    const result = await geocodeLocation(args.query);
    return { query: args.query, result };
  },
});

export const testGeocodeSeedBusiness = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<unknown> => {
    const biz = await ctx.runQuery(internal.localEventsBridge.getBusinessForEvents, {
      id: args.businessId,
    });
    if (!biz) return { error: "business not found" };
    const { geocodeLocation } = await import("./geocode");
    const result = await geocodeLocation(biz.location);
    if (result) {
      await ctx.runMutation(internal.businessesBridge.patchBusinessGeocode, {
        id: args.businessId,
        lat: result.lat,
        lng: result.lng,
      });
    }
    return { location: biz.location, result };
  },
});

export const testLocalEventsTtl = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<unknown> => {
    // Insert one stale (>3d old) and one fresh event.
    const stale = await ctx.runMutation(internal.localEventsBridge.insertLocalEvent, {
      businessId: args.businessId,
      title: "Stale past event",
      description: "Already happened last week",
      sourceUrl: "https://example.com/stale-event",
      venueText: "Old venue",
      lat: 37.3022,
      lng: -120.4829,
      fetchedAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    });
    const fresh = await ctx.runMutation(internal.localEventsBridge.insertLocalEvent, {
      businessId: args.businessId,
      title: "Fresh upcoming concert",
      description: "Friday night at the park",
      sourceUrl: "https://example.com/fresh-event",
      venueText: "Applegate Park, Merced",
      lat: 37.31,
      lng: -120.47,
      eventDate: Date.now() + 3 * 24 * 60 * 60 * 1000,
      fetchedAt: Date.now(),
    });
    const since = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const visible = await ctx.runQuery(internal.localEventsBridge.recentForBusiness, {
      businessId: args.businessId,
      sinceFetchedAt: since,
    });
    return {
      staleInserted: stale,
      freshInserted: fresh,
      visibleCount: visible.length,
      visibleTitles: visible.map((e) => e.title),
    };
  },
});

export const testComposeRiskFlag = internalAction({
  args: {
    businessId: v.id("businesses"),
    scenario: v.union(
      v.literal("both"),
      v.literal("historical_only"),
      v.literal("events_only"),
      v.literal("neither")
    ),
  },
  handler: async (ctx, args): Promise<unknown> => {
    // For deterministic testing, we drive the LLM with a constructed input
    // rather than the real historical query. This lets us verify each
    // combination of signals in isolation.
    let historical = "";
    let events: Array<{ title: string; eventDate?: number }> = [];
    if (args.scenario === "both" || args.scenario === "historical_only") {
      historical = "2 of last 3 shifts (66%) needed backup or took longer than 5 min to confirm.";
    }
    if (args.scenario === "both" || args.scenario === "events_only") {
      events = [
        { title: "Concert at the fairgrounds", eventDate: Date.now() + 2 * 24 * 60 * 60 * 1000 },
        { title: "City marathon", eventDate: Date.now() + 3 * 24 * 60 * 60 * 1000 },
      ];
    }
    if (args.scenario === "neither") {
      historical = "";
      events = [];
    }
    const text = (await ctx.runAction(api.llmTasks.draftRiskFlag, {
      historicalSummary: historical,
      nearbyEvents: events,
    })) as string;
    return { scenario: args.scenario, historical, events, riskFlag: text };
  },
});
