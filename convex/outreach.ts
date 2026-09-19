import { v } from "convex/values";
import { internalAction, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

export const draftOutreach = internalAction({
  args: {
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    contactEmail: v.optional(v.string()),
    sourceUrl: v.string(),
    draftBody: v.string(),
  },
  returns: v.id("outreach"),
  handler: async (ctx, args): Promise<Id<"outreach">> => {
    const subject = `[hunt:${args.huntId}:candidate:${args.candidateId}] Listing inquiry`;
    const draftId: Id<"outreach"> = await ctx.runMutation(
      internal.outreachBridge.insertDraft,
      {
      huntId: args.huntId,
      candidateId: args.candidateId,
      subject,
      draftBody: args.draftBody,
      recipientEmail:
        args.contactEmail && args.contactEmail.length > 0
          ? args.contactEmail
          : undefined,
      recipientEmailSource:
        args.contactEmail && args.contactEmail.length > 0 ? "scraped" : undefined,
      kind: "initial",
      },
    );
    return draftId;
  },
});

export const confirmSend = mutation({
  args: { outreachId: v.id("outreach") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const row = await ctx.db.get(args.outreachId);
    if (!row) throw new Error("Outreach not found");
    const hunt = await ctx.db.get(row.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    if (hunt.contactPolicy === "alerts_only") {
      throw new Error(
        "This mission is alert-only. Change its contact policy before drafting outreach.",
      );
    }
    if (!row.recipientEmail || !/\S+@\S+\.\S+/.test(row.recipientEmail))
      throw new Error("A valid recipient email is required before sending");
    if (row.status !== "drafted") return { scheduled: false };
    await ctx.db.patch(args.outreachId, {
      status: "sending",
      sendAttempts: (row.sendAttempts ?? 0) + 1,
    });
    await ctx.scheduler.runAfter(0, internal.outreachActions.sendOutreach, {
      outreachId: args.outreachId,
    });
    return { scheduled: true };
  },
});

export const listForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(schema.doc("outreach")),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    return await ctx.db
      .query("outreach")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(50);
  },
});

export const draftFollowUp = internalAction({
  args: {
    outreachId: v.id("outreach"),
    replyMessageId: v.string(),
    replyText: v.string(),
  },
  returns: v.union(v.id("outreach"), v.null()),
  handler: async (ctx, args): Promise<Id<"outreach"> | null> => {
    const outreach: Doc<"outreach"> | null = (await ctx.runQuery(
      internal.outreachBridge.getById,
      { id: args.outreachId },
    )) as Doc<"outreach"> | null;
    if (!outreach) throw new Error("No prior outreach for candidate");
    if (!outreach.threadId || !outreach.recipientEmail)
      throw new Error("A sent outreach thread is required for a follow-up");
    if (!outreach.ownerId) throw new Error("Outreach owner is missing");
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: outreach.huntId,
    });
    if (!hunt) throw new Error("Hunt not found");
    if (hunt.contactPolicy === "alerts_only") return null;

    const existing: Doc<"outreach"> | null = (await ctx.runQuery(
      internal.outreachBridge.findFollowUp,
      {
        parentOutreachId: outreach._id,
        replyToMessageId: args.replyMessageId,
      },
    )) as Doc<"outreach"> | null;
    if (existing) return existing._id;

    await ctx.runMutation(internal.rateLimit.consumeOpenai, {
      ownerId: outreach.ownerId,
    });
    const draft: string = await ctx.runAction(internal.llm.runLlmTask, {
      prompt:
        `Draft a concise, professional follow-up email response to this reply:\n\n"${args.replyText}"\n\nKeep it warm and on-topic.`,
      systemPrompt:
        "You are a helpful assistant drafting a follow-up email response. Be concise and professional.",
      temperature: 0.3,
    });

    const draftId: Id<"outreach"> = await ctx.runMutation(
      internal.outreachBridge.insertDraft,
      {
      huntId: outreach.huntId,
      candidateId: outreach.candidateId,
      subject: outreach.subject,
      draftBody: draft,
      recipientEmail: outreach.recipientEmail,
      recipientEmailSource: outreach.recipientEmailSource,
      kind: "follow_up",
      parentOutreachId: outreach._id,
      replyToMessageId: args.replyMessageId,
      threadId: outreach.threadId,
      },
    );
    return draftId;
  },
});
