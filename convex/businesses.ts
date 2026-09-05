"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { geocodeLocation } from "./geocode";
import { Id } from "./_generated/dataModel";

export const createBusiness = action({
  args: {
    name: v.string(),
    category: v.string(),
    hoursJson: v.optional(v.string()),
    sizeSignal: v.optional(v.string()),
    location: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ businessId: string; inboxId: string; inboxEmail: string }> => {
    const slug =
      args.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "biz";
    const username = `${slug}-${Date.now().toString(36).slice(-6)}`;
    const inbox = (await ctx.runAction(internal.mailBridge.createInboxAction, {
      username,
      displayName: args.name,
    })) as { inboxId: string; email: string };

    // If a source URL was provided, scrape + extract a profile. The user
    // still reviews/edits before saving (in the form), so the extraction
    // is purely advisory — we keep the form's input as the source of truth
    // and only fall back to the LLM's category/hours/size when the user
    // didn't supply them.
    let category = args.category;
    let hoursJson = args.hoursJson ?? "";
    let sizeSignal = args.sizeSignal ?? "";
    if (args.sourceUrl) {
      try {
        const scraped = (await ctx.runAction(api.firecrawl.scrape, {
          url: args.sourceUrl,
        })) as { markdown: string };
        if (scraped.markdown) {
          const profile = (await ctx.runAction(api.llmTasks.extractBusinessProfile, {
            markdown: scraped.markdown,
            businessName: args.name,
            city: args.location,
          })) as
            | { name: string; category: string; hoursJson: string; sizeSignal: string; location: string }
            | null;
          if (profile) {
            category = category || profile.category;
            hoursJson = hoursJson || profile.hoursJson;
            sizeSignal = sizeSignal || profile.sizeSignal;
          }
        }
      } catch (e) {
        // Scrape/extract failure is non-fatal — the form values still go in.
        await ctx.runMutation(internal.eventsLog.logEvent, {
          table: "businesses",
          rowId: "scrape",
          action: "scrape_failed",
          summary: `Scrape/extract for ${args.sourceUrl} failed: ${(e as Error).message}`,
        });
      }
    }

    const businessId = await ctx.runMutation(internal.businessesBridge.insertBusiness, {
      name: args.name,
      category,
      hoursJson,
      sizeSignal,
      location: args.location,
      sourceUrl: args.sourceUrl ?? "",
      inboxId: inbox.inboxId,
      inboxEmail: inbox.email,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "businesses",
      rowId: businessId,
      action: "business_created",
      summary: `Created business "${args.name}" (${category}) with inbox ${inbox.email}`,
    });

    // Geocode the location string. Non-fatal: log and continue without
    // coordinates if Nominatim is unreachable, returns 0 results, or the
    // query is unparseable. The risk-flag map just won't render for this
    // business.
    try {
      const geo = await geocodeLocation(args.location);
      if (geo) {
        await ctx.runMutation(internal.businessesBridge.patchBusinessGeocode, {
          id: businessId as Id<"businesses">,
          lat: geo.lat,
          lng: geo.lng,
        });
        await ctx.runMutation(internal.eventsLog.logEvent, {
          table: "businesses",
          rowId: businessId,
          action: "geocoded",
          summary: `Geocoded "${args.location}" to (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}) — ${geo.displayName}`,
        });
      } else {
        await ctx.runMutation(internal.eventsLog.logEvent, {
          table: "businesses",
          rowId: businessId,
          action: "geocode_failed",
          summary: `Geocode returned no results for "${args.location}"`,
        });
      }
    } catch (e) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "businesses",
        rowId: businessId,
        action: "geocode_failed",
        summary: `Geocode threw for "${args.location}": ${(e as Error).message}`,
      });
    }

    return { businessId, inboxId: inbox.inboxId, inboxEmail: inbox.email };
  },
});
