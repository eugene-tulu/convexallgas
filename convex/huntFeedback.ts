import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { feedbackKindValidator } from "./market";
import schema from "./schema";

export const record = mutation({
  args: {
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    kind: feedbackKindValidator,
    note: v.optional(v.string()),
  },
  returns: v.id("huntFeedback"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    const candidate = await ctx.db.get(args.candidateId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier || candidate?.huntId !== hunt._id) {
      throw new Error("Not authorized");
    }
    const feedbackId = await ctx.db.insert("huntFeedback", {
      huntId: hunt._id,
      candidateId: candidate._id,
      ownerId: identity.tokenIdentifier,
      kind: args.kind,
      note: args.note?.trim().slice(0, 500) || undefined,
      createdAt: Date.now(),
    });
    await ctx.db.insert("events", {
      ownerId: identity.tokenIdentifier,
      table: "hunts",
      rowId: hunt._id as unknown as string,
      action: "scout_feedback_recorded",
      summary: `Recorded ${args.kind.replace(/_/g, " ")} feedback for a candidate`,
      timestamp: Date.now(),
    });
    return feedbackId;
  },
});

export const listForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(schema.doc("huntFeedback")),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) throw new Error("Not authorized");
    return await ctx.db
      .query("huntFeedback")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(50);
  },
});

export const listRecentInternal = internalQuery({
  args: { huntId: v.id("hunts") },
  returns: v.array(schema.doc("huntFeedback")),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("huntFeedback")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(12);
  },
});
