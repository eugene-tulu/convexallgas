import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import schema from "./schema";

export const getById = internalQuery({
  args: { id: v.id("outreach") },
  returns: v.union(schema.doc("outreach"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const findByCandidate = internalQuery({
  args: { candidateId: v.id("candidates") },
  returns: v.union(schema.doc("outreach"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outreach")
      .withIndex("by_candidate", (q) => q.eq("candidateId", args.candidateId))
      .order("desc")
      .first();
  },
});

export const findByThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(schema.doc("outreach"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("outreach")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();
  },
});

export const findFollowUp = internalQuery({
  args: {
    parentOutreachId: v.id("outreach"),
    replyToMessageId: v.string(),
  },
  returns: v.union(schema.doc("outreach"), v.null()),
  handler: async (ctx, args) => {
    const drafts = await ctx.db
      .query("outreach")
      .withIndex("by_parent", (q) =>
        q.eq("parentOutreachId", args.parentOutreachId),
      )
      .take(20);
    return (
      drafts.find(
        (draft) => draft.replyToMessageId === args.replyToMessageId,
      ) ?? null
    );
  },
});

export const insertDraft = internalMutation({
  args: {
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    subject: v.string(),
    draftBody: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientEmailSource: v.optional(
      v.union(v.literal("scraped"), v.literal("manual")),
    ),
    kind: v.union(v.literal("initial"), v.literal("follow_up")),
    parentOutreachId: v.optional(v.id("outreach")),
    replyToMessageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
  },
  returns: v.id("outreach"),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) throw new Error("Hunt not found");
    if (args.kind === "initial") {
      const existing = await ctx.db
        .query("outreach")
        .withIndex("by_candidate_kind", (q) =>
          q.eq("candidateId", args.candidateId).eq("kind", "initial"),
        )
        .first();
      if (existing) return existing._id;
    } else if (args.parentOutreachId && args.replyToMessageId) {
      const existing = await ctx.db
        .query("outreach")
        .withIndex("by_parent", (q) =>
          q.eq("parentOutreachId", args.parentOutreachId),
        )
        .take(20);
      const matchingDraft = existing.find(
        (draft) => draft.replyToMessageId === args.replyToMessageId,
      );
      if (matchingDraft) return matchingDraft._id;
    }
    return await ctx.db.insert("outreach", {
      huntId: args.huntId,
      candidateId: args.candidateId,
      ownerId: hunt.ownerId,
      subject: args.subject,
      draftBody: args.draftBody,
      recipientEmail: args.recipientEmail,
      recipientEmailSource: args.recipientEmailSource,
      kind: args.kind,
      parentOutreachId: args.parentOutreachId,
      replyToMessageId: args.replyToMessageId,
      inboxId: hunt.inboxId,
      threadId: args.threadId,
      status: "drafted",
      createdAt: Date.now(),
    });
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("outreach"),
    providerMessageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      sentAt: Date.now(),
      providerMessageId: args.providerMessageId,
      threadId: args.threadId,
    });
    return null;
  },
});

export const markSendFailed = internalMutation({
  args: { id: v.id("outreach"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "drafted",
      lastError: args.error.slice(0, 1000),
    });
    return null;
  },
});

export const patchStatus = internalMutation({
  args: {
    id: v.id("outreach"),
    status: v.union(
      v.literal("drafted"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("replied"),
      v.literal("closed"),
    ),
    lastInboundMessageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      ...(args.lastInboundMessageId
        ? { lastInboundMessageId: args.lastInboundMessageId }
        : {}),
    });
    return null;
  },
});
