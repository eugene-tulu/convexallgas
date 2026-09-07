import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const getWorker = internalQuery({
  args: { id: v.id("workers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Batch-load workers by id list. One DB round-trip regardless of list
// size, mirroring the q.or(...) pattern already used in
// `repliesQueries.shortlist`. Filters out (and silently drops) any
// rows that don't exist — callers validate the business/consent match
// against the returned rows.
export const getWorkersBatch = internalQuery({
  args: { ids: v.array(v.id("workers")) },
  handler: async (ctx, args) => {
    if (args.ids.length === 0) return [];
    const unique = Array.from(new Set(args.ids));
    const rows = await ctx.db
      .query("workers")
      .filter((q) => q.or(...unique.map((id) => q.eq(q.field("_id"), id))))
      .collect();
    return rows;
  },
});

export const listConsentedForBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("workers")
      .withIndex("by_businessId_consent", (q) =>
        q.eq("businessId", args.businessId).eq("consent", true)
      )
      .collect();
    return rows.map((w) => ({ _id: w._id, name: w.name, contact: w.contact }));
  },
});

export const findOrCreateWorkerForContact = internalMutation({
  args: {
    businessId: v.id("businesses"),
    contact: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workers")
      .withIndex("by_contact", (q) => q.eq("contact", args.contact))
      .unique();
    if (existing) {
      if (!existing.businessId) {
        await ctx.db.patch(existing._id, { businessId: args.businessId });
      }
      return { workerId: existing._id, created: false };
    }
    const id = await ctx.db.insert("workers", {
      businessId: args.businessId,
      name: args.displayName ?? args.contact.split("@")[0],
      contact: args.contact,
      roles: [],
      location: "",
      consent: false,
      reliabilityScore: 0.5,
    });
    return { workerId: id, created: true };
  },
});

export const setConsentInternal = internalMutation({
  args: { workerId: v.id("workers"), consent: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workerId, {
      consent: args.consent,
      consentedAt: args.consent ? Date.now() : undefined,
    });
  },
});
