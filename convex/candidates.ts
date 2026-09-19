import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  candidateDispositionValidator,
  sourceInspectionValidator,
  verificationResultValidator,
} from "./market";

const candidateResult = v.object({
  candidateId: v.id("candidates"),
  shouldNotify: v.boolean(),
});

// Never return scraped page text through a browser-facing function. The
// structured verification is enough for a customer to assess a listing.
export const candidateForUser = v.object({
  _id: v.id("candidates"),
  _creationTime: v.number(),
  huntId: v.id("hunts"),
  sourceUrl: v.string(),
  verification: verificationResultValidator,
  disposition: v.optional(candidateDispositionValidator),
  sourceInspection: v.optional(sourceInspectionValidator),
  clearsThreshold: v.boolean(),
  discoveredAt: v.number(),
  notifiedAt: v.optional(v.number()),
  fetchedFrom: v.union(
    v.literal("search"),
    v.literal("scrape"),
    v.literal("crawl"),
    v.literal("interact"),
  ),
});

export function toCandidateForUser(candidate: Doc<"candidates">) {
  return {
    _id: candidate._id,
    _creationTime: candidate._creationTime,
    huntId: candidate.huntId,
    sourceUrl: candidate.sourceUrl,
    verification: candidate.verification,
    disposition: candidate.disposition,
    sourceInspection: candidate.sourceInspection,
    clearsThreshold: candidate.clearsThreshold,
    discoveredAt: candidate.discoveredAt,
    notifiedAt: candidate.notifiedAt,
    fetchedFrom: candidate.fetchedFrom,
  };
}

export const insertVerified = internalMutation({
  args: {
    huntId: v.id("hunts"),
    sourceUrl: v.string(),
    verification: verificationResultValidator,
    disposition: candidateDispositionValidator,
    sourceInspection: sourceInspectionValidator,
    fetchedFrom: v.union(
      v.literal("search"),
      v.literal("scrape"),
      v.literal("crawl"),
      v.literal("interact"),
    ),
  },
  returns: candidateResult,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("candidates")
      .withIndex("by_hunt_sourceUrl", (q) =>
        q.eq("huntId", args.huntId).eq("sourceUrl", args.sourceUrl),
      )
      .unique();

    const preserveUserUnavailable =
      existing?.sourceInspection === "user_reported_unavailable";
    const disposition = preserveUserUnavailable
      ? "source_unavailable"
      : args.disposition;
    const sourceInspection = preserveUserUnavailable
      ? "user_reported_unavailable"
      : args.sourceInspection;
    const verification = preserveUserUnavailable
      ? {
          ...args.verification,
          flags: [...new Set([
            ...args.verification.flags,
            "source_unavailable_to_user",
          ])],
        }
      : args.verification;
    const clearsThreshold = disposition === "potential_lead";

    if (existing) {
      await ctx.db.patch(existing._id, {
        rawContent: undefined,
        verification,
        disposition,
        sourceInspection,
        clearsThreshold,
        discoveredAt: Date.now(),
      });
      return {
        candidateId: existing._id,
        shouldNotify: clearsThreshold && !existing.notifiedAt,
      };
    }

    const candidateId = await ctx.db.insert("candidates", {
      huntId: args.huntId,
      sourceUrl: args.sourceUrl,
      verification,
      disposition,
      sourceInspection,
      clearsThreshold,
      discoveredAt: Date.now(),
      fetchedFrom: args.fetchedFrom,
    });
    return { candidateId, shouldNotify: clearsThreshold };
  },
});

// A browser-level 4xx or access wall is meaningful user feedback: even if an
// upstream search result looked promising, it must no longer be presented as a
// lead that this owner can act on. The report is idempotent and cannot affect
// another owner's mission.
export const reportSourceUnavailable = mutation({
  args: { candidateId: v.id("candidates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const hunt = await ctx.db.get(candidate.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    if (candidate.sourceInspection === "user_reported_unavailable") return null;

    const flags = [...new Set([
      ...candidate.verification.flags,
      "source_unavailable_to_user",
    ])];
    await ctx.db.patch(candidate._id, {
      verification: { ...candidate.verification, flags },
      disposition: "source_unavailable",
      sourceInspection: "user_reported_unavailable",
      clearsThreshold: false,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: identity.tokenIdentifier,
      table: "candidates",
      rowId: candidate._id as unknown as string,
      action: "source_reported_unavailable",
      summary: "Marked a source unavailable and removed it from potential leads",
    });
    return null;
  },
});

export const markNotified = internalMutation({
  args: { candidateIds: v.array(v.id("candidates")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const candidateId of args.candidateIds.slice(0, 20)) {
      await ctx.db.patch(candidateId, { notifiedAt: Date.now() });
    }
    return null;
  },
});

export const getById = internalQuery({
  args: { id: v.id("candidates") },
  returns: v.union(schema.doc("candidates"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listByHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(candidateForUser),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    const candidates = await ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(100);
    return candidates.map(toCandidateForUser);
  },
});
