import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const source = v.union(
  v.literal("agentmail"),
  v.literal("firecrawl"),
  v.literal("hunt"),
  v.literal("notification"),
  v.literal("privacy"),
);

const severity = v.union(v.literal("warning"), v.literal("error"));

const issueForUser = v.object({
  huntId: v.optional(v.id("hunts")),
  source,
  severity,
  summary: v.string(),
  count: v.number(),
  lastSeenAt: v.number(),
});

// Provider messages and raw exception text can contain sensitive information.
// Callers supply a stable opaque fingerprint plus a product-language summary;
// this module intentionally never accepts an arbitrary raw error payload.
export const report = internalMutation({
  args: {
    ownerId: v.optional(v.string()),
    huntId: v.optional(v.id("hunts")),
    source,
    severity,
    fingerprint: v.string(),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fingerprint = args.fingerprint.slice(0, 300);
    const summary = args.summary.slice(0, 500);
    const existing = await ctx.db
      .query("operationalIssues")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerId: args.ownerId ?? existing.ownerId,
        huntId: args.huntId ?? existing.huntId,
        source: args.source,
        severity: args.severity,
        summary,
        active: true,
        count: existing.count + 1,
        lastSeenAt: now,
        resolvedAt: undefined,
      });
      return null;
    }
    await ctx.db.insert("operationalIssues", {
      ownerId: args.ownerId,
      huntId: args.huntId,
      source: args.source,
      severity: args.severity,
      fingerprint,
      summary,
      count: 1,
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    return null;
  },
});

export const resolve = internalMutation({
  args: { fingerprint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("operationalIssues")
      .withIndex("by_fingerprint", (q) =>
        q.eq("fingerprint", args.fingerprint.slice(0, 300)),
      )
      .first();
    if (issue?.active) {
      await ctx.db.patch(issue._id, {
        active: false,
        resolvedAt: Date.now(),
      });
    }
    return null;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(issueForUser),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const issues = await ctx.db
      .query("operationalIssues")
      .withIndex("by_owner_active_lastSeenAt", (q) =>
        q.eq("ownerId", identity.tokenIdentifier).eq("active", true),
      )
      .order("desc")
      .take(5);
    return issues.map((issue) => ({
      huntId: issue.huntId as Id<"hunts"> | undefined,
      source: issue.source,
      severity: issue.severity,
      summary: issue.summary,
      count: issue.count,
      lastSeenAt: issue.lastSeenAt,
    }));
  },
});
