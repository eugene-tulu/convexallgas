import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    if (args.businessId) {
      return await ctx.db
        .query("workers")
        .withIndex("by_businessId_consent", (q) =>
          q.eq("businessId", args.businessId!)
        )
        .take(100);
    }
    return await ctx.db.query("workers").take(100);
  },
});

export const listConsentedForBusinessPublic = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workers")
      .withIndex("by_businessId_consent", (q) =>
        q.eq("businessId", args.businessId).eq("consent", true)
      )
      .collect();
  },
});

export const addWorker = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    contact: v.string(),
    roles: v.array(v.string()),
    location: v.optional(v.string()),
    consent: v.boolean(),
    reliabilityScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workers")
      .withIndex("by_contact", (q) => q.eq("contact", args.contact))
      .unique();
    if (existing) {
      // Do NOT silently reassign a worker to a different business. The contact
      // uniquely identifies a person; if they belong to another business, the
      // caller's businessId must match (or be empty, i.e. an admin upsert).
      if (
        existing.businessId &&
        args.businessId &&
        existing.businessId !== args.businessId
      ) {
        throw new Error(
          `Worker ${args.contact} already belongs to a different business`
        );
      }
      await ctx.db.patch(existing._id, {
        name: args.name,
        businessId: args.businessId ?? existing.businessId,
        roles: args.roles,
        location: args.location ?? existing.location,
        consent: args.consent,
        consentedAt: args.consent ? Date.now() : existing.consentedAt,
        reliabilityScore: args.reliabilityScore ?? existing.reliabilityScore,
      });
      return existing._id;
    }
    return await ctx.db.insert("workers", {
      businessId: args.businessId,
      name: args.name,
      contact: args.contact,
      roles: args.roles,
      location: args.location ?? "",
      consent: args.consent,
      consentedAt: args.consent ? Date.now() : undefined,
      reliabilityScore: args.reliabilityScore ?? 0.5,
    });
  },
});

export const setConsent = mutation({
  args: { workerId: v.id("workers"), consent: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.workerId, {
      consent: args.consent,
      consentedAt: args.consent ? Date.now() : undefined,
    });
  },
});
