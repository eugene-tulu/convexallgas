"use node";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { geocodeLocation } from "./geocode";

const LOCAL_EVENTS_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const fetchLocalEvents = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<{ inserted: number; updated: number; geocoded: number; skipped: number }> => {
    const business = await ctx.runQuery(internal.localEventsBridge.getBusinessForEvents, {
      id: args.businessId,
    });
    if (!business) return { inserted: 0, updated: 0, geocoded: 0, skipped: 0 };

    const query = `events near ${business.location} this week`;
    let results: Array<{ title: string; url: string; description: string }> = [];
    try {
      results = (await ctx.runAction(api.firecrawl.search, {
        query,
        limit: 8,
      })) as Array<{ title: string; url: string; description: string }>;
    } catch (e) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "localEvents",
        rowId: args.businessId,
        action: "fetch_failed",
        summary: `Firecrawl search failed for "${query}": ${(e as Error).message}`,
      });
      return { inserted: 0, updated: 0, geocoded: 0, skipped: 0 };
    }

    let inserted = 0;
    let updated = 0;
    let geocoded = 0;
    let skipped = 0;
    const now = Date.now();
    for (const r of results) {
      // Ask the LLM for a venue/date extraction. If it returns null fields,
      // we still insert the row — the event still counts for the text
      // risk flag, it just won't plot on the map.
      let venueText: string | null = null;
      let eventDate: number | null = null;
      try {
        const extracted = (await ctx.runAction(api.llmTasks.extractEventVenue, {
          title: r.title,
          description: r.description,
        })) as { venueText: string | null; eventDate: number | null } | null;
        if (extracted) {
          venueText = extracted.venueText ?? null;
          eventDate = extracted.eventDate ?? null;
        }
      } catch (e) {
        // Non-fatal — keep going with no extracted fields.
        await ctx.runMutation(internal.eventsLog.logEvent, {
          table: "localEvents",
          rowId: r.url,
          action: "extract_failed",
          summary: `extractEventVenue failed: ${(e as Error).message}`,
        });
      }

      let lat: number | null = null;
      let lng: number | null = null;
      if (venueText) {
        const geo = await geocodeLocation(venueText);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
          geocoded++;
        }
      } else {
        skipped++;
      }

      const upserted = await ctx.runMutation(internal.localEventsBridge.upsertLocalEvent, {
        businessId: args.businessId,
        title: r.title,
        description: r.description,
        sourceUrl: r.url,
        venueText: venueText ?? undefined,
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        eventDate: eventDate ?? undefined,
        fetchedAt: now,
      });
      if (upserted.created) inserted++;
      else updated++;
    }

    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "localEvents",
      rowId: args.businessId,
      action: "fetched",
      summary: `Local-events fetch for "${business.location}": ${inserted} inserted, ${updated} updated, ${geocoded} geocoded, ${skipped} skipped (no venue)`,
    });
    return { inserted, updated, geocoded, skipped };
  },
});

export const fetchAllLocalEvents = internalAction({
  args: {},
  handler: async (ctx): Promise<{ businesses: number; inserted: number; recomputed: number }> => {
    const ids = await ctx.runQuery(internal.localEventsBridge.listActiveBusinessIds, {});
    let totalInserted = 0;
    let recomputed = 0;
    for (const id of ids) {
      // Space calls out to be polite to Nominatim (1 req/sec guideline).
      // We do this serially rather than in parallel.
      if (totalInserted > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
      const r = await ctx.runAction(internal.localEvents.fetchLocalEvents, { businessId: id });
      totalInserted += r.inserted;
      // Recompute the cached risk flag for this business so the
      // front-end sees fresh data without burning an LLM call per render.
      try {
        await ctx.runAction(internal.riskFlag.composeRiskFlag, { businessId: id });
        recomputed++;
      } catch (e) {
        // Non-fatal — the local-events fetch result is the primary
        // outcome; the risk flag will recompute on the next daily pass.
        console.error(`risk flag recompute failed for ${id}: ${(e as Error).message}`);
      }
    }
    return { businesses: ids.length, inserted: totalInserted, recomputed };
  },
});
