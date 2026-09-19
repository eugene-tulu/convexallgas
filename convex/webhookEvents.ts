import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const provider = v.union(v.literal("agentmail"), v.literal("firecrawl"));
const status = v.union(
  v.literal("processing"),
  v.literal("processed"),
  v.literal("failed"),
);

export const claim = internalMutation({
  args: {
    provider,
    eventId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .first();
    if (existing) {
      if (
        existing.status === "failed" ||
        (existing.status === "processing" && Date.now() - existing.receivedAt > 10 * 60 * 1000)
      ) {
        await ctx.db.patch(existing._id, {
          status: "processing",
          receivedAt: Date.now(),
        });
        return true;
      }
      return false;
    }
    await ctx.db.insert("webhookEvents", {
      provider: args.provider,
      eventId: args.eventId,
      status: "processing",
      receivedAt: Date.now(),
    });
    return true;
  },
});

export const complete = internalMutation({
  args: { provider, eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .first();
    if (event) await ctx.db.patch(event._id, { status: "processed" });
    return null;
  },
});

export const fail = internalMutation({
  args: { provider, eventId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .first();
    if (event) {
      await ctx.db.patch(event._id, {
        status: "failed",
        error: args.error.slice(0, 1000),
      });
    }
    return null;
  },
});

// Keep an event in the processing state while Jamanyo-owned retries are
// scheduled. Marking it failed too early would let a duplicate provider
// delivery race the scheduled worker.
export const recordRetry = internalMutation({
  args: { provider, eventId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .first();
    if (event && event.status === "processing") {
      await ctx.db.patch(event._id, {
        error: args.error.slice(0, 1_000),
      });
    }
    return null;
  },
});
