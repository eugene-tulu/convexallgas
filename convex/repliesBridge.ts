import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const parsedAvailability = v.object({
  available: v.boolean(),
  constraints: v.string(),
  confidence: v.number(),
  reasons: v.string(),
});

export const insertResponse = internalMutation({
  args: {
    shiftId: v.id("shifts"),
    workerId: v.optional(v.id("workers")),
    rawReplyText: v.string(),
    agentmailMessageId: v.string(),
    source: v.union(v.literal("internal"), v.literal("external")),
  },
  handler: async (ctx, args) => {
    const dedupe = await ctx.db
      .query("responses")
      .withIndex("by_shiftId", (q) => q.eq("shiftId", args.shiftId))
      .filter((q) => q.eq(q.field("agentmailMessageId"), args.agentmailMessageId))
      .first();
    if (dedupe) {
      return { responseId: dedupe._id, deduped: true };
    }
    const id = await ctx.db.insert("responses", {
      shiftId: args.shiftId,
      workerId: args.workerId,
      rawReplyText: args.rawReplyText,
      agentmailMessageId: args.agentmailMessageId,
      source: args.source,
      receivedAt: Date.now(),
    });
    return { responseId: id, deduped: false };
  },
});

export const patchResponseParsed = internalMutation({
  args: {
    id: v.id("responses"),
    parsedAvailability: parsedAvailability,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      parsedAvailability: args.parsedAvailability,
    });
  },
});

export const rankShiftResponses = internalMutation({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) return;
    const sinceBroadcastAt = shift.broadcastAt ?? shift._creationTime;
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_shiftId_receivedAt", (q) => q.eq("shiftId", args.shiftId))
      .collect();
    for (const r of responses) {
      if (r.source !== "internal") continue;
      if (r.receivedAt < sinceBroadcastAt) continue;
      let reliability = 0.5;
      if (r.workerId) {
        const w = await ctx.db.get(r.workerId);
        if (w) reliability = w.reliabilityScore;
      }
      const conf = r.parsedAvailability?.confidence ?? 0.5;
      const available = r.parsedAvailability?.available ? 1 : 0;
      const recencySec = Math.max(0, (Date.now() - r.receivedAt) / 1000);
      const recency = Math.max(0, 1 - recencySec / 60);
      const score = 0.5 * conf + 0.3 * reliability + 0.2 * recency;
      const finalScore = available === 1 ? score : score - 10;
      await ctx.db.patch(r._id, { rankScore: finalScore });
    }
  },
});

export const countAvailableSince = internalQuery({
  args: { shiftId: v.id("shifts"), sinceBroadcastAt: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("responses")
      .withIndex("by_shiftId_receivedAt", (q) => q.eq("shiftId", args.shiftId))
      .collect();
    let count = 0;
    for (const r of rows) {
      if (r.receivedAt < args.sinceBroadcastAt) continue;
      if (r.source !== "internal") continue;
      if (r.parsedAvailability?.available === true) count++;
    }
    return count;
  },
});

export const insertExternalResponse = internalMutation({
  args: {
    shiftId: v.id("shifts"),
    externalCandidateRef: v.string(),
    externalSourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("responses", {
      shiftId: args.shiftId,
      rawReplyText: `External candidate from ${args.externalSourceUrl}`,
      externalCandidateRef: args.externalCandidateRef,
      externalSourceUrl: args.externalSourceUrl,
      source: "external",
      receivedAt: Date.now(),
      agentmailMessageId: `external:${args.externalCandidateRef}:${Date.now()}`,
    });
    return id;
  },
});

export const sendConfirmAndRejects = internalMutation({
  args: { shiftId: v.id("shifts"), winningResponseId: v.id("responses") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_shiftId", (q) => q.eq("shiftId", args.shiftId))
      .collect();
    for (const r of responses) {
      if (r.source !== "internal" || !r.workerId) continue;
      if (r._id === args.winningResponseId) {
        await ctx.scheduler.runAfter(0, internal.repliesBridge.sendOneEmail, {
          responseId: r._id,
          kind: "confirm",
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.repliesBridge.sendOneEmail, {
          responseId: r._id,
          kind: "reject",
        });
      }
    }
  },
});

export const sendOneEmail = internalMutation({
  args: { responseId: v.id("responses"), kind: v.union(v.literal("confirm"), v.literal("reject")) },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.responseId);
    if (!r) return;
    const shift = await ctx.db.get(r.shiftId);
    if (!shift) return;
    const business = await ctx.db.get(shift.businessId);
    if (!business) return;
    await ctx.scheduler.runAfter(0, internal.repliesActions.dispatchOneEmail, {
      responseId: r._id,
      businessInboxId: business.inboxId,
      businessName: business.name,
      role: shift.role,
      startTime: shift.startTime,
      displayRate: shift.displayRate,
      displayRateLabel: shift.displayRateLabel,
      kind: args.kind,
    });
  },
});

export const getResponse = internalQuery({
  args: { id: v.id("responses") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getWorkerDoc = internalQuery({
  args: { id: v.id("workers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const sendOptInInvite = internalMutation({
  args: {
    shiftId: v.id("shifts"),
    workerId: v.id("workers"),
    email: v.string(),
    businessName: v.string(),
  },
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("magicTokens", {
      token,
      shiftId: args.shiftId,
      workerId: args.workerId,
      email: args.email,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) return;
    const business = await ctx.db.get(shift.businessId);
    if (!business) return;
    const siteUrl = process.env.CONVEX_SITE_URL ?? "https://basic-hippopotamus-995.convex.site";
    const link = `${siteUrl}/opt-in?token=${token}`;
    await ctx.scheduler.runAfter(0, internal.repliesActions.dispatchOptInInvite, {
      businessInboxId: business.inboxId,
      businessName: business.name,
      to: args.email,
      link,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "workers",
      rowId: args.workerId,
      action: "opt_in_invite_queued",
      summary: `Sent opt-in invite to ${args.email}`,
    });
  },
});
