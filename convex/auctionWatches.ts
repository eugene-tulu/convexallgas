import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import schema from "./schema";

const listingState = v.union(
  v.literal("live"),
  v.literal("ending"),
  v.literal("sold"),
  v.literal("withdrawn"),
  v.literal("closed"),
  v.literal("unknown"),
);

const reserveStatus = v.union(
  v.literal("met"),
  v.literal("not_met"),
  v.literal("not_applicable"),
  v.literal("unknown"),
);

const availability = v.union(
  v.literal("available"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

type AuctionState =
  | "live"
  | "ending"
  | "sold"
  | "withdrawn"
  | "closed"
  | "unknown";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function budgetForHunt(hunt: {
  direction: "above" | "below" | "match";
  threshold?: number;
  money?: { amountMinor?: number };
}): number | undefined {
  if (hunt.direction !== "below") return undefined;
  if (hunt.money?.amountMinor !== undefined) return hunt.money.amountMinor;
  return hunt.threshold === undefined ? undefined : Math.round(hunt.threshold * 100);
}

function observedPrice(watch: {
  currentBidMinor?: number;
  askingPriceMinor?: number;
}): number | undefined {
  return watch.currentBidMinor ?? watch.askingPriceMinor;
}

function isTerminal(state: AuctionState): boolean {
  return state === "sold" || state === "withdrawn" || state === "closed";
}

function nextAlertAt(
  endsAt: number | undefined,
  now: number,
  notified: string[],
  state: AuctionState,
): number | undefined {
  if (!endsAt || isTerminal(state)) return undefined;
  const milestones = [
    { key: "24h", at: endsAt - 24 * HOUR },
    { key: "1h", at: endsAt - HOUR },
    { key: "15m", at: endsAt - 15 * MINUTE },
  ];
  return milestones.find((item) => item.at > now && !notified.includes(item.key))?.at;
}

function priceMovedMeaningfully(
  previous: number | undefined,
  current: number | undefined,
  endsAt: number | undefined,
  now: number,
): boolean {
  if (previous === undefined || current === undefined || previous === current) {
    return false;
  }
  // A small bid increment near the closing window is useful. Earlier in an
  // auction we only interrupt for a meaningful move, avoiding bid-by-bid noise.
  if (endsAt !== undefined && endsAt - now <= HOUR) return true;
  return Math.abs(current - previous) >= Math.max(10_000, Math.round(previous * 0.03));
}

function summaryForChange(input: {
  bidMoved: boolean;
  askingChanged: boolean;
  budgetCrossed: boolean;
  stateChanged: boolean;
  reserveChanged: boolean;
  availabilityChanged: boolean;
  listingState: AuctionState;
}): string {
  if (input.listingState === "sold") return "The listing now appears sold.";
  if (input.listingState === "withdrawn") return "The listing now appears withdrawn.";
  if (input.listingState === "closed") return "The listing now appears closed.";
  if (input.budgetCrossed) return "The observable price moved beyond the saved ceiling.";
  if (input.reserveChanged) return "The visible reserve status changed.";
  if (input.availabilityChanged) return "The listing availability changed.";
  if (input.askingChanged) return "The visible asking price changed.";
  if (input.bidMoved) return "The current bid moved materially.";
  if (input.stateChanged) return "The auction state changed.";
  return "The listing changed.";
}

export const upsertSnapshot = internalMutation({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    monitorId: v.string(),
    checkId: v.string(),
    sourceUrl: v.string(),
    title: v.optional(v.string()),
    currentBidMinor: v.optional(v.number()),
    askingPriceMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    endsAt: v.optional(v.number()),
    listingState,
    reserveStatus,
    availability,
    evidence: v.optional(v.string()),
    observedAt: v.number(),
  },
  returns: v.object({
    stored: v.boolean(),
    material: v.boolean(),
    summary: v.string(),
    watchId: v.id("auctionWatches"),
  }),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Not authorized");

    const existing = await ctx.db
      .query("auctionWatches")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .first();
    if (existing?.lastCheckId === args.checkId) {
      return {
        stored: false,
        material: false,
        summary: "This auction check was already recorded.",
        watchId: existing._id,
      };
    }

    const priorPrice = existing ? observedPrice(existing) : undefined;
    const currentPrice = observedPrice(args);
    const ceiling = budgetForHunt(hunt);
    const bidMoved = priceMovedMeaningfully(
      existing?.currentBidMinor,
      args.currentBidMinor,
      args.endsAt,
      args.observedAt,
    );
    const askingChanged =
      existing?.askingPriceMinor !== undefined &&
      args.askingPriceMinor !== undefined &&
      existing.askingPriceMinor !== args.askingPriceMinor;
    const budgetCrossed =
      ceiling !== undefined &&
      currentPrice !== undefined &&
      currentPrice > ceiling &&
      (priorPrice === undefined || priorPrice <= ceiling);
    const stateChanged = Boolean(existing && existing.listingState !== args.listingState);
    const reserveChanged = Boolean(existing && existing.reserveStatus !== args.reserveStatus);
    const availabilityChanged = Boolean(existing && existing.availability !== args.availability);
    const initial = !existing;
    const material =
      !initial &&
      (bidMoved ||
        askingChanged ||
        budgetCrossed ||
        stateChanged ||
        reserveChanged ||
        availabilityChanged);
    const notifiedMilestones = existing?.notifiedMilestones ?? [];
    const patch = {
      sourceUrl: args.sourceUrl.slice(0, 2048),
      monitorId: args.monitorId,
      title: args.title?.slice(0, 240),
      currentBidMinor: args.currentBidMinor,
      askingPriceMinor: args.askingPriceMinor,
      currency: args.currency?.slice(0, 3).toUpperCase(),
      endsAt: args.endsAt,
      listingState: args.listingState,
      reserveStatus: args.reserveStatus,
      availability: args.availability,
      evidence: args.evidence?.slice(0, 800),
      lastCheckId: args.checkId,
      lastObservedAt: args.observedAt,
      ...(material ? { lastMeaningfulChangeAt: args.observedAt } : {}),
      nextAlertAt: nextAlertAt(
        args.endsAt,
        args.observedAt,
        notifiedMilestones,
        args.listingState,
      ),
      notifiedMilestones,
    };
    const watchId = existing
      ? existing._id
      : await ctx.db.insert("auctionWatches", {
          huntId: args.huntId,
          ownerId: args.ownerId,
          ...patch,
        });
    if (existing) await ctx.db.patch(existing._id, patch);

    return {
      stored: true,
      material,
      summary: initial
        ? "Initial auction facts recorded; alerts will begin when something material changes."
        : summaryForChange({
            bidMoved,
            askingChanged,
            budgetCrossed,
            stateChanged,
            reserveChanged,
            availabilityChanged,
            listingState: args.listingState,
          }),
      watchId,
    };
  },
});

export const getForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.union(schema.doc("auctionWatches"), v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    return await ctx.db
      .query("auctionWatches")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .first();
  },
});

export const getForHuntInternal = internalQuery({
  args: { huntId: v.id("hunts"), ownerId: v.string() },
  returns: v.union(schema.doc("auctionWatches"), v.null()),
  handler: async (ctx, args) => {
    const watch = await ctx.db
      .query("auctionWatches")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .first();
    return watch?.ownerId === args.ownerId ? watch : null;
  },
});

export const due = internalQuery({
  args: { now: v.number() },
  returns: v.array(schema.doc("auctionWatches")),
  handler: async (ctx, args) => {
    const watches = await ctx.db
      .query("auctionWatches")
      .withIndex("by_nextAlertAt", (q) => q.lte("nextAlertAt", args.now))
      .take(50);
    return watches.filter((watch) => watch.nextAlertAt !== undefined);
  },
});

export const claimDueAlert = internalMutation({
  args: { watchId: v.id("auctionWatches"), now: v.number() },
  returns: v.union(
    v.object({ watch: schema.doc("auctionWatches"), milestone: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const watch = await ctx.db.get(args.watchId);
    if (!watch || watch.nextAlertAt === undefined || watch.nextAlertAt > args.now) {
      return null;
    }
    const hunt = await ctx.db.get(watch.huntId);
    if (!hunt || hunt.ownerId !== watch.ownerId || hunt.status !== "active") return null;
    if (!watch.endsAt || isTerminal(watch.listingState)) {
      await ctx.db.patch(watch._id, { nextAlertAt: undefined });
      return null;
    }

    const milestones = [
      { key: "24h", at: watch.endsAt - 24 * HOUR, label: "Less than 24 hours remain" },
      { key: "1h", at: watch.endsAt - HOUR, label: "About one hour remains" },
      { key: "15m", at: watch.endsAt - 15 * MINUTE, label: "About 15 minutes remain" },
    ];
    const due = milestones.find(
      (item) => item.at <= args.now && !watch.notifiedMilestones.includes(item.key),
    );
    const milestone = due ?? {
      key: "scheduled_end",
      at: watch.endsAt,
      label: "The scheduled end time has passed; confirm the listing outcome",
    };
    const notifiedMilestones = [...watch.notifiedMilestones, milestone.key];
    const next = nextAlertAt(watch.endsAt, args.now, notifiedMilestones, watch.listingState);
    await ctx.db.patch(watch._id, {
      notifiedMilestones,
      nextAlertAt: next,
    });
    const updated = await ctx.db.get(watch._id);
    return updated ? { watch: updated, milestone: milestone.label } : null;
  },
});
