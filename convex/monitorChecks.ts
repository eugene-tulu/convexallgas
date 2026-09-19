import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const record = internalMutation({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    monitorId: v.string(),
    checkId: v.string(),
    status: v.string(),
    changed: v.number(),
    added: v.number(),
    removed: v.number(),
    errors: v.number(),
    changedUrls: v.array(v.string()),
    diffJson: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("monitorChecks")
      .withIndex("by_check", (q) => q.eq("checkId", args.checkId))
      .first();
    if (existing) return false;
    await ctx.db.insert("monitorChecks", {
      huntId: args.huntId,
      ownerId: args.ownerId,
      monitorId: args.monitorId,
      checkId: args.checkId,
      status: args.status,
      changed: args.changed,
      added: args.added,
      removed: args.removed,
      errors: args.errors,
      changedUrls: args.changedUrls.slice(0, 50),
      diffJson: args.diffJson?.slice(0, 6000),
      createdAt: Date.now(),
    });
    return true;
  },
});

// Monitoring is only credible when the owner can see its last heartbeat and
// whether a provider check actually found anything. Keep raw provider payloads
// private; the dashboard gets a compact operational trail instead.
export const listForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(
    v.object({
      _id: v.id("monitorChecks"),
      checkId: v.string(),
      status: v.string(),
      changed: v.number(),
      added: v.number(),
      removed: v.number(),
      errors: v.number(),
      changedUrls: v.array(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    const checks = await ctx.db
      .query("monitorChecks")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(8);
    return checks.map((check) => ({
      _id: check._id,
      checkId: check.checkId,
      status: check.status,
      changed: check.changed,
      added: check.added,
      removed: check.removed,
      errors: check.errors,
      changedUrls: check.changedUrls.slice(0, 6),
      createdAt: check.createdAt,
    }));
  },
});
