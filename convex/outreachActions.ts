import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const sendOutreach = internalAction({
  args: { outreachId: v.id("outreach") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.outreachBridge.getById, {
      id: args.outreachId,
    });
    if (!row || row.status !== "sending") return null;

    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: row.huntId,
    });
    const inboxId = row.inboxId ?? hunt?.inboxId;
    if (!inboxId) throw new Error("No inbox available for outreach");
    if (!hunt) throw new Error("Hunt not found");

    const recipient = row.recipientEmail;
    if (!recipient || !/\S+@\S+\.\S+/.test(recipient))
      throw new Error("Invalid recipient email");

    await ctx.runMutation(internal.rateLimit.consumeEmail, {
      ownerId: hunt.ownerId,
    });

    try {
      const sent = row.replyToMessageId
        ? await ctx.runAction(internal.mail.replyToMessage, {
            ownerId: hunt.ownerId,
            inboxId,
            messageId: row.replyToMessageId,
            text: row.draftBody,
            idempotencyKey: `outreach:${args.outreachId}`,
          })
        : await ctx.runAction(internal.mail.sendEmail, {
            ownerId: hunt.ownerId,
            inboxId,
            to: recipient,
            subject: row.subject,
            text: row.draftBody,
            idempotencyKey: `outreach:${args.outreachId}`,
          });

      await ctx.runMutation(internal.outreachBridge.markSent, {
        id: args.outreachId,
        providerMessageId: sent.messageId,
        threadId: sent.threadId,
      });
      await ctx.runMutation(internal.agentThreads.recordOutbound, {
        ownerId: hunt.ownerId,
        inboxId,
        messageId: sent.messageId,
        threadId: sent.threadId,
        to: recipient,
        subject: row.subject,
        text: row.draftBody,
        sentAt: Date.now(),
      });
    } catch (error: unknown) {
      await ctx.runMutation(internal.outreachBridge.markSendFailed, {
        id: args.outreachId,
        error: "The approved seller message could not be delivered",
      });
      throw new Error("We couldn't send the approved seller message. Please try again.");
    }
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: hunt.ownerId,
      table: "outreach",
      rowId: args.outreachId as unknown as string,
      action: "outreach_sent",
      summary: `Sent to ${recipient} for candidate ${row.candidateId}`,
    });
    return null;
  },
});

export const handleReply = internalAction({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    ownerId: v.string(),
    inboxId: v.string(),
    from: v.string(),
    text: v.string(),
    subject: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const outreach = await ctx.runQuery(internal.outreachBridge.findByThread, {
      threadId: args.threadId,
    });
    if (!outreach) return null;
    if (
      outreach.ownerId !== args.ownerId ||
      outreach.inboxId !== args.inboxId ||
      (outreach.status !== "sent" && outreach.status !== "replied")
    ) {
      throw new Error("Outreach reply does not belong to this inbox");
    }

    if (outreach.lastInboundMessageId !== args.messageId) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        ownerId: args.ownerId,
        table: "outreach",
        rowId: outreach._id as unknown as string,
        action: "reply_received",
        summary: "Received a reply from a seller",
      });
    }

    await ctx.runMutation(internal.outreachBridge.patchStatus, {
      id: outreach._id,
      status: "replied",
      lastInboundMessageId: args.messageId,
    });

    await ctx.runAction(internal.outreach.draftFollowUp, {
      outreachId: outreach._id,
      replyMessageId: args.messageId,
      replyText: args.text,
    });
    return null;
  },
});
