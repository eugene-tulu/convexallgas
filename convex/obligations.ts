import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const listObligations = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("obligations").collect();
  },
});

export const listObligationsByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("obligations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getObligation = query({
  args: { id: v.id("obligations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listDueObligations = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("obligations")
      .withIndex("by_nextCheckAt", (q) => q.lte("nextCheckAt", args.now))
      .filter((q) => q.neq(q.field("status"), "completed"))
      .collect();
  },
});

function parseRecurrence(recurrence: string): number {
  const match = recurrence.match(/^(\d+)([dwmy])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };
  return value * (multipliers[unit] ?? 0);
}

export const markObligationCompleted = mutation({
  args: { id: v.id("obligations") },
  handler: async (ctx, args) => {
    const obligation = await ctx.db.get(args.id);
    if (!obligation) return null;

    const now = Date.now();
    const recurrenceMs = parseRecurrence(obligation.recurrence);
    const newNextCheckAt = now + recurrenceMs;

    await ctx.db.patch(args.id, {
      lastCompletedAt: now,
      nextCheckAt: newNextCheckAt,
      status: "pending",
    });

    await ctx.runMutation(internal.eventLog.logEvent, {
      table: "obligations",
      rowId: args.id,
      action: "completed",
      summary: `Obligation "${obligation.commitmentText}" completed, next due ${new Date(newNextCheckAt).toISOString()}`,
    });

    return { success: true, newNextCheckAt };
  },
});

export const snoozeObligation = mutation({
  args: { id: v.id("obligations"), snoozeMs: v.number() },
  handler: async (ctx, args) => {
    const obligation = await ctx.db.get(args.id);
    if (!obligation) return null;

    const newNextCheckAt = Date.now() + args.snoozeMs;

    await ctx.db.patch(args.id, {
      nextCheckAt: newNextCheckAt,
    });

    await ctx.runMutation(internal.eventLog.logEvent, {
      table: "obligations",
      rowId: args.id,
      action: "snoozed",
      summary: `Obligation "${obligation.commitmentText}" snoozed`,
    });

    return { success: true, newNextCheckAt };
  },
});

export const markObligationCompletedById = internalMutation({
  args: {
    obligationId: v.id("obligations"),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const obligation = await ctx.db.get(args.obligationId);
    if (!obligation) return { success: false, reason: "not found" };

    const now = Date.now();
    const recurrenceMs = parseRecurrence(obligation.recurrence);
    const newNextCheckAt = now + recurrenceMs;

    await ctx.db.patch(args.obligationId, {
      lastCompletedAt: now,
      nextCheckAt: newNextCheckAt,
      status: "pending",
    });

    await ctx.runMutation(internal.eventLog.logEvent, {
      table: "obligations",
      rowId: args.obligationId,
      action: "completed",
      summary: `Obligation "${obligation.commitmentText}" completed (source: ${args.source}), next due ${new Date(newNextCheckAt).toISOString()}`,
    });

    return { success: true, newNextCheckAt };
  },
});

export const snoozeObligationById = internalMutation({
  args: {
    obligationId: v.id("obligations"),
    snoozeMs: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const obligation = await ctx.db.get(args.obligationId);
    if (!obligation) return { success: false, reason: "not found" };

    const newNextCheckAt = Date.now() + args.snoozeMs;
    await ctx.db.patch(args.obligationId, {
      nextCheckAt: newNextCheckAt,
    });

    await ctx.runMutation(internal.eventLog.logEvent, {
      table: "obligations",
      rowId: args.obligationId,
      action: "snoozed",
      summary: `Obligation "${obligation.commitmentText}" snoozed (source: ${args.source})`,
    });

    return { success: true, newNextCheckAt };
  },
});


