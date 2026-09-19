"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { deliverHuntNotification, type HuntDoc } from "./hunt";
import type { GarageBrief, GarageBriefHighlight } from "./garageBriefs";

function highlightText(label: string, highlight: GarageBriefHighlight): string {
  const facts = [
    highlight.value,
    highlight.availability ? `availability: ${highlight.availability}` : undefined,
    highlight.sellerTrust ? `source trust: ${highlight.sellerTrust}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${label}: ${highlight.sourceLabel}${facts ? ` — ${facts}` : ""}\n${highlight.sourceUrl}\n${highlight.detail}`;
}

function weeklyBriefBody(hunt: HuntDoc, brief: GarageBrief): string {
  const profileName =
    hunt.experienceProfile === "collector"
      ? "Collector’s Desk"
      : hunt.experienceProfile === "deal_radar"
        ? "Deal Radar"
        : "Jamanyo Scout";
  const sections = [`${profileName} — weekly Garage Brief`, brief.lede];
  if (brief.topLead) sections.push(highlightText("The one to watch", brief.topLead));
  if (brief.nearMiss) {
    sections.push(highlightText("Worth a closer look", brief.nearMiss));
  }
  sections.push(brief.decision);
  sections.push("Reply to this thread to refine, pause, or resume the mission.");
  return sections.join("\n\n");
}

export const runDueBriefs = internalAction({
  args: { cursor: v.optional(v.string()), now: v.optional(v.number()) },
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const now = args.now ?? Date.now();
    const batch = await ctx.runMutation(internal.garageBriefs.claimDueBatch, {
      cursor: args.cursor,
      now,
    });
    for (const briefId of batch.briefIds) {
      await ctx.scheduler.runAfter(0, internal.garageBriefActions.sendBrief, {
        briefId,
      });
    }
    if (batch.continueCursor) {
      await ctx.scheduler.runAfter(0, internal.garageBriefActions.runDueBriefs, {
        cursor: batch.continueCursor,
        now,
      });
    }
    return { scheduled: batch.briefIds.length };
  },
});

export const sendBrief = internalAction({
  args: { briefId: v.id("garageBriefs") },
  returns: v.object({ delivered: v.boolean(), queued: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ delivered: boolean; queued: boolean }> => {
    const deliveryRecord = await ctx.runMutation(
      internal.garageBriefs.claimDelivery,
      { briefId: args.briefId },
    );
    if (!deliveryRecord) return { delivered: false, queued: false };

    let hunt: HuntDoc | null = null;
    try {
      hunt = (await ctx.runQuery(internal.hunts.getByIdInternal, {
        huntId: deliveryRecord.huntId,
      })) as HuntDoc | null;
      if (
        !hunt ||
        hunt.ownerId !== deliveryRecord.ownerId ||
        hunt.status !== "active" ||
        (hunt.expiresAt !== undefined && hunt.expiresAt <= Date.now())
      ) {
        await ctx.runMutation(internal.garageBriefs.markDelivery, {
          briefId: deliveryRecord._id,
          status: "disabled",
        });
        return { delivered: false, queued: false };
      }

      const brief = (await ctx.runQuery(
        internal.garageBriefs.getForHuntInternal,
        { huntId: hunt._id },
      )) as GarageBrief | null;
      if (!brief) {
        await ctx.runMutation(internal.garageBriefs.markDelivery, {
          briefId: deliveryRecord._id,
          status: "disabled",
        });
        return { delivered: false, queued: false };
      }

      const result = await deliverHuntNotification(ctx, hunt, {
        text: weeklyBriefBody(hunt, brief),
        idempotencyKey: `weekly-garage-brief:${deliveryRecord._id}`,
      });
      const status = result === "queued" ? "delivery_queued" : result;
      await ctx.runMutation(internal.garageBriefs.markDelivery, {
        briefId: deliveryRecord._id,
        status,
      });
      await ctx.runMutation(internal.eventsLog.logEvent, {
        ownerId: hunt.ownerId,
        table: "hunts",
        rowId: hunt._id as unknown as string,
        action: `weekly_garage_brief_${status}`,
        summary:
          result === "sent"
            ? "Sent this week’s Garage Brief through the mission’s email thread"
            : result === "queued"
              ? "Prepared this week’s Garage Brief for the configured alert window"
              : "Prepared this week’s Garage Brief in the dashboard; email delivery is unavailable or disabled",
      });
      return { delivered: result === "sent", queued: result === "queued" };
    } catch {
      await ctx.runMutation(internal.garageBriefs.markDelivery, {
        briefId: deliveryRecord._id,
        status: "unavailable",
      });
      if (hunt) {
        await ctx.runMutation(internal.eventsLog.logEvent, {
          ownerId: hunt.ownerId,
          table: "hunts",
          rowId: hunt._id as unknown as string,
          action: "weekly_garage_brief_unavailable",
          summary: "This week’s Garage Brief remains available in the dashboard; email delivery was unavailable",
        });
      }
      return { delivered: false, queued: false };
    }
  },
});
