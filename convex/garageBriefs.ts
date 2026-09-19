import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { availabilityValidator, sellerTrustValidator } from "./market";

const briefStateValidator = v.union(
  v.literal("quiet"),
  v.literal("watch"),
  v.literal("act"),
);

const deliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("delivery_queued"),
  v.literal("disabled"),
  v.literal("unavailable"),
);

const briefHighlightValidator = v.object({
  candidateId: v.id("candidates"),
  sourceUrl: v.string(),
  sourceLabel: v.string(),
  imageUrl: v.optional(v.string()),
  detail: v.string(),
  confidence: v.number(),
  value: v.optional(v.string()),
  availability: v.optional(availabilityValidator),
  sellerTrust: v.optional(sellerTrustValidator),
});

const garageBriefResult = v.object({
  state: briefStateValidator,
  title: v.string(),
  lede: v.string(),
  decision: v.string(),
  lastRunAt: v.optional(v.number()),
  topLead: v.optional(briefHighlightValidator),
  nearMiss: v.optional(briefHighlightValidator),
});

export type GarageBriefHighlight = {
  candidateId: Id<"candidates">;
  sourceUrl: string;
  sourceLabel: string;
  imageUrl?: string;
  detail: string;
  confidence: number;
  value?: string;
  availability?: "available" | "unknown" | "unavailable";
  sellerTrust?: "unknown" | "reviewed" | "caution";
};

export type GarageBrief = {
  state: "quiet" | "watch" | "act";
  title: string;
  lede: string;
  decision: string;
  lastRunAt?: number;
  topLead?: GarageBriefHighlight;
  nearMiss?: GarageBriefHighlight;
};

function isVehicleMission(hunt: Doc<"hunts">): boolean {
  return hunt.category === "hypercar" || hunt.category === "salvage_flip";
}

function sourceLabel(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "Listing source";
  }
}

function publicImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname)
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function listingValue(candidate: Doc<"candidates">): string | undefined {
  const verification = candidate.verification;
  if (
    verification.listingPriceMinor !== undefined &&
    verification.listingCurrency
  ) {
    return `${verification.listingCurrency} ${(verification.listingPriceMinor / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return verification.extractedValue !== undefined
    ? verification.extractedValue.toLocaleString()
    : undefined;
}

function toHighlight(candidate: Doc<"candidates">): GarageBriefHighlight {
  const verification = candidate.verification;
  const reasons = verification.matchReasons?.slice(0, 3).join(" · ");
  const highlight: GarageBriefHighlight = {
    candidateId: candidate._id,
    sourceUrl: candidate.sourceUrl,
    sourceLabel: sourceLabel(candidate.sourceUrl),
    detail:
      verification.matchDetail?.slice(0, 320) ??
      reasons ??
      "Open the source to inspect the listing details.",
    confidence: verification.confidence,
  };
  const imageUrl = publicImageUrl(verification.listingImageUrl);
  const value = listingValue(candidate);
  if (imageUrl) highlight.imageUrl = imageUrl;
  if (value) highlight.value = value;
  if (verification.availability) highlight.availability = verification.availability;
  if (verification.sellerTrust) highlight.sellerTrust = verification.sellerTrust;
  return highlight;
}

function highestConfidence(
  candidates: Doc<"candidates">[],
): Doc<"candidates"> | undefined {
  return candidates.reduce<Doc<"candidates"> | undefined>(
    (best, candidate) =>
      !best || candidate.verification.confidence > best.verification.confidence
        ? candidate
        : best,
    undefined,
  );
}

async function buildGarageBrief(
  ctx: QueryCtx,
  hunt: Doc<"hunts">,
): Promise<GarageBrief> {
  const [clearedCandidates, assessedCandidates] = await Promise.all([
    ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) =>
        q.eq("huntId", hunt._id).eq("clearsThreshold", true),
      )
      .order("desc")
      .take(20),
    ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) =>
        q.eq("huntId", hunt._id).eq("clearsThreshold", false),
      )
      .order("desc")
      .take(20),
  ]);
  // Only a new, explicitly actioned assessment can drive the Garage Brief.
  // Legacy `clearsThreshold` values and sources a user cannot open are useful
  // research, but not grounds for a recommendation.
  const topCandidate = highestConfidence(
    clearedCandidates.filter(
      (candidate) => candidate.disposition === "potential_lead",
    ),
  );
  const nearMissCandidate = highestConfidence(
    assessedCandidates.filter(
      (candidate) =>
        candidate.disposition === "research" &&
        candidate.sourceInspection === "inspected" &&
        candidate.verification.listingKind === "specific_listing",
    ),
  );
  const topLead = topCandidate ? toHighlight(topCandidate) : undefined;
  const nearMiss =
    nearMissCandidate && nearMissCandidate.verification.confidence >= 0.55
      ? toHighlight(nearMissCandidate)
      : undefined;
  const collector = hunt.experienceProfile === "collector";
  const dealRadar = hunt.experienceProfile === "deal_radar";

  if (topLead) {
    if (dealRadar) {
      return {
        state: "act",
        title: "Deal Radar call",
        lede: "One assessed lead has earned a quick decision.",
        decision:
          "Open it now, check the condition flags and availability, then decide whether to act or walk away.",
        lastRunAt: hunt.lastRunAt,
        topLead,
        nearMiss,
      };
    }
    if (collector) {
      return {
        state: "watch",
        title: "This week’s Garage Brief",
        lede: "One contender deserves time with the evidence, not a rushed verdict.",
        decision:
          "Compare its specification, condition, and ownership story against your brief before taking the next step.",
        lastRunAt: hunt.lastRunAt,
        topLead,
        nearMiss,
      };
    }
    return {
      state: "watch",
      title: "Scout’s Garage Brief",
      lede: "An assessed lead is ready for a closer look.",
      decision: "Open the listing and decide whether it belongs on your shortlist.",
      lastRunAt: hunt.lastRunAt,
      topLead,
      nearMiss,
    };
  }

  if (nearMiss) {
    if (dealRadar) {
      return {
        state: "watch",
        title: "Deal Radar is holding its nerve",
        lede: "There is no clean bargain yet, but one source is worth a quick second look.",
        decision: "Hold off on action unless the condition and price trade-off becomes clearer.",
        lastRunAt: hunt.lastRunAt,
        nearMiss,
      };
    }
    if (collector) {
      return {
        state: "watch",
        title: "This week’s Garage Brief",
        lede: "Nothing has cleared the brief, though one near-miss has a useful angle.",
        decision: "Keep the standard high; use the near-miss to refine what truly matters.",
        lastRunAt: hunt.lastRunAt,
        nearMiss,
      };
    }
    return {
      state: "watch",
      title: "Scout’s Garage Brief",
      lede: "No full match yet, but one source is close enough to learn from.",
      decision: "Use it to refine the brief or wait for a cleaner fit.",
      lastRunAt: hunt.lastRunAt,
      nearMiss,
    };
  }

  if (dealRadar) {
    return {
      state: "quiet",
      title: "Deal Radar is quiet",
      lede: "Nothing is worth interrupting you for right now.",
      decision: "Keep the brief live. The next alert should earn your attention.",
      lastRunAt: hunt.lastRunAt,
    };
  }
  if (collector) {
    return {
      state: "quiet",
      title: "This week’s Garage Brief",
      lede: "The market is quiet, and that is useful: nothing has earned a place on the shortlist yet.",
      decision: "Your brief is protecting you from weak choices while the scout keeps watch.",
      lastRunAt: hunt.lastRunAt,
    };
  }
  return {
    state: "quiet",
    title: "Scout’s Garage Brief",
    lede: "Nothing has earned an interruption yet.",
    decision: "The scout is still watching for a stronger fit.",
    lastRunAt: hunt.lastRunAt,
  };
}

export const getForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.union(garageBriefResult, v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    return isVehicleMission(hunt) ? await buildGarageBrief(ctx, hunt) : null;
  },
});

export const getForHuntInternal = internalQuery({
  args: { huntId: v.id("hunts") },
  returns: v.union(garageBriefResult, v.null()),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    return hunt && isVehicleMission(hunt) ? await buildGarageBrief(ctx, hunt) : null;
  },
});

function localMondaySchedule(
  now: number,
  timeZone: string,
): { weekKey: string; dueAtNine: boolean } | undefined {
  const fallback = () => {
    const date = new Date(now);
    if (date.getUTCDay() !== 1) return undefined;
    const weekKey = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
      .map((part) => String(part).padStart(2, "0"))
      .join("-");
    return { weekKey, dueAtNine: date.getUTCHours() === 9 };
  };

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
    const part = (name: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === name)?.value;
    if (part("weekday") !== "Mon") return undefined;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day
      ? { weekKey: `${year}-${month}-${day}`, dueAtNine: Number(part("hour")) === 9 }
      : fallback();
  } catch {
    return fallback();
  }
}

export const claimDueBatch = internalMutation({
  args: { cursor: v.optional(v.string()), now: v.number() },
  returns: v.object({
    briefIds: v.array(v.id("garageBriefs")),
    continueCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const activeHunts = await ctx.db
      .query("hunts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ numItems: 50, cursor: args.cursor ?? null });
    const briefIds: Id<"garageBriefs">[] = [];

    for (const hunt of activeHunts.page) {
      if (!isVehicleMission(hunt)) continue;
      if (hunt.monitorPurpose === "auction") continue;
      if (hunt.weeklyGarageBrief !== true) continue;
      if (!hunt.sourceMessageId && hunt.notifyByEmail === false) continue;
      const schedule = localMondaySchedule(args.now, hunt.timeZone ?? "UTC");
      if (!schedule) continue;
      const existing = await ctx.db
        .query("garageBriefs")
        .withIndex("by_hunt_week", (q) =>
          q.eq("huntId", hunt._id).eq("weekKey", schedule.weekKey),
        )
        .unique();
      if (existing) {
        if (existing.status === "queued") briefIds.push(existing._id);
        continue;
      }
      if (!schedule.dueAtNine) continue;

      const briefId = await ctx.db.insert("garageBriefs", {
        huntId: hunt._id,
        ownerId: hunt.ownerId,
        weekKey: schedule.weekKey,
        status: "queued",
        createdAt: args.now,
      });
      briefIds.push(briefId);
    }

    return {
      briefIds,
      continueCursor: activeHunts.isDone
        ? undefined
        : activeHunts.continueCursor,
    };
  },
});

export const claimDelivery = internalMutation({
  args: { briefId: v.id("garageBriefs") },
  returns: v.union(schema.doc("garageBriefs"), v.null()),
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief || brief.status !== "queued") return null;
    await ctx.db.patch(brief._id, { status: "sending" });
    return brief;
  },
});

export const markDelivery = internalMutation({
  args: {
    briefId: v.id("garageBriefs"),
    status: deliveryStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const brief = await ctx.db.get(args.briefId);
    if (!brief) return null;
    await ctx.db.patch(
      brief._id,
      args.status === "sent"
        ? { status: args.status, sentAt: Date.now() }
        : { status: args.status },
    );
    return null;
  },
});
