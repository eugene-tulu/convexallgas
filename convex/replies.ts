"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const SHIFT_TAG_RE = /\[shift:([a-zA-Z0-9_-]+)\]/;

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const processBroadcastReply = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    text: v.string(),
    html: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const subjectTag = args.subject.match(SHIFT_TAG_RE);
    const textTag = (args.text ?? "").match(SHIFT_TAG_RE);
    const htmlTag = (args.html ?? "").match(SHIFT_TAG_RE);
    const tagMatch = subjectTag ?? textTag ?? htmlTag;
    if (!tagMatch) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "webhook",
        rowId: args.messageId,
        action: "unrouted_reply",
        summary: `Reply from ${args.from} had no [shift:<id>] tag. subject="${args.subject.slice(0, 80)}"`,
      });
      return { processed: false, reason: "no shift tag" };
    }
    const shiftId = tagMatch[1] as string;
    const shift = await ctx.runQuery(internal.shiftsBridge.getShift, {
      shiftId: shiftId as never,
    });
    if (!shift) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "webhook",
        rowId: args.messageId,
        action: "orphan_reply",
        summary: `Reply from ${args.from} referenced missing shift ${shiftId}`,
      });
      return { processed: false, reason: "shift not found" };
    }

    const business = await ctx.runQuery(internal.businessesBridge.getBusiness, {
      id: shift.businessId,
    });
    if (!business) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "webhook",
        rowId: args.messageId,
        action: "orphan_reply",
        summary: `Shift ${shiftId} has no business`,
      });
      return { processed: false, reason: "business not found" };
    }

    const worker = await ctx.runMutation(
      internal.workersBridge.findOrCreateWorkerForContact,
      {
        businessId: shift.businessId,
        contact: args.from,
        displayName: args.from.split("@")[0],
      }
    );

    let text = args.text ?? "";
    if (!text.trim() && args.html) text = htmlToText(args.html);
    if (!text.trim()) {
      try {
        const m = await ctx.runAction(internal.mailBridge.fetchMessageAction, {
          inboxId: args.inboxId,
          messageId: args.messageId,
        });
        text = (m as { text: string }).text ?? "";
      } catch (e) {
        console.error("refetch failed", e);
      }
    }

    const inserted = await ctx.runMutation(internal.repliesBridge.insertResponse, {
      shiftId: shift._id,
      workerId: worker.workerId as never,
      rawReplyText: text.slice(0, 4000),
      agentmailMessageId: args.messageId,
      source: "internal",
    });

    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "responses",
      rowId: inserted.responseId as string,
      action: "reply_received",
      summary: `Reply from ${args.from} on shift ${shift._id} (round ${shift.broadcastRound})`,
    });

    const parsed = (await ctx.runAction(internal.llmTasks.parseReply, {
      rawReplyText: text,
      role: shift.role,
      startTime: shift.startTime,
      shiftId: shift._id,
    })) as
      | { available: boolean; constraints: string; confidence: number; reasons: string }
      | null;

    if (parsed) {
      await ctx.runMutation(internal.repliesBridge.patchResponseParsed, {
        id: inserted.responseId,
        parsedAvailability: parsed,
      });
    }

    await ctx.runMutation(internal.repliesBridge.rankShiftResponses, {
      shiftId: shift._id,
    });

    if (shift.status === "broadcasting") {
      const availableCount = await ctx.runQuery(
        internal.repliesBridge.countAvailableSince,
        {
          shiftId: shift._id,
          sinceBroadcastAt: shift.broadcastAt ?? shift._creationTime,
        }
      );
      if (availableCount > 0) {
        await ctx.runMutation(internal.shiftsBridge.patchShift, {
          id: shift._id,
          patch: { status: "shortlist_ready" },
        });
        await ctx.runMutation(internal.eventsLog.logEvent, {
          table: "shifts",
          rowId: shift._id,
          action: "shortlist_ready",
          summary: `${availableCount} available candidate(s) on the shortlist`,
        });
      }
    }

    await ctx.scheduler.runAfter(0, internal.repliesBridge.sendOptInInvite, {
      shiftId: shift._id,
      workerId: worker.workerId as never,
      email: args.from,
      businessName: business.name,
    });

    return { processed: true, responseId: inserted.responseId };
  },
});
