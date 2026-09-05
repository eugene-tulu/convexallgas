"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { urgencyTimeoutMs } from "./shifts";

export const broadcastShift = internalAction({
  args: {
    shiftId: v.id("shifts"),
    workerIds: v.array(v.id("workers")),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.runQuery(internal.shiftsBridge.getShift, {
      shiftId: args.shiftId,
    });
    if (!shift) return;
    if (shift.status === "confirmed" || shift.status === "cancelled") return;

    const business = await ctx.runQuery(internal.businessesBridge.getBusiness, {
      id: shift.businessId,
    });
    if (!business) return;

    let recipients: { _id: string; name: string; contact: string }[];
    if (args.workerIds && args.workerIds.length > 0) {
      recipients = [];
      for (const wid of args.workerIds) {
        const w = await ctx.runQuery(internal.workersBridge.getWorker, { id: wid });
        if (w && w.consent && w.businessId === shift.businessId) {
          recipients.push({ _id: w._id, name: w.name, contact: w.contact });
        }
      }
    } else {
      recipients = await ctx.runQuery(
        internal.workersBridge.listConsentedForBusiness,
        { businessId: shift.businessId }
      );
    }

    const now = Date.now();
    await ctx.runMutation(internal.shiftsBridge.patchShift, {
      id: shift._id,
      patch: {
        status: "broadcasting",
        broadcastAt: now,
        timeoutAt: now + urgencyTimeoutMs(shift.urgency),
      },
    });

    const subject = `[shift:${shift._id}] ${shift.role} call-out — ${new Date(
      shift.startTime
    ).toLocaleString()}`;
    const body = (await ctx.runAction(api.llmTasks.draftBroadcastEmail, {
      role: shift.role,
      startTime: shift.startTime,
      urgency: shift.urgency,
      displayRate: shift.displayRate,
      displayRateLabel: shift.displayRateLabel,
      businessName: business.name,
      recipientCount: recipients.length,
    })) as string;

    const results = await Promise.allSettled(
      recipients.map((r) =>
        ctx.runAction(internal.mailBridge.sendEmailAction, {
          inboxId: business.inboxId,
          to: r.contact,
          subject,
          text: body,
        })
      )
    );
    let sentCount = 0;
    const errors: string[] = [];
    results.forEach((res, i) => {
      if (res.status === "fulfilled") sentCount++;
      else errors.push(`${recipients[i].contact}: ${(res.reason as Error).message}`);
    });

    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "shifts",
      rowId: shift._id,
      action: "broadcast_sent",
      summary: `Broadcast round ${shift.broadcastRound + 1} to ${sentCount} consented workers${
        errors.length ? ` (${errors.length} failed)` : ""
      }`,
    });
    if (errors.length) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "shifts",
        rowId: shift._id,
        action: "broadcast_send_errors",
        summary: errors.join("; ").slice(0, 500),
      });
    }
  },
});
