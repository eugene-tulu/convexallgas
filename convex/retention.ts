import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

const DAY = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

const retention = {
  messages: 30 * DAY,
  webhooks: 30 * DAY,
  notificationKeys: 30 * DAY,
  notifications: 90 * DAY,
  runs: 90 * DAY,
  monitorChecks: 90 * DAY,
  activity: 90 * DAY,
  candidatesAndOutreach: 90 * DAY,
} as const;

const purgeResult = v.object({
  deleted: v.number(),
  more: v.boolean(),
});

// Keep durable mission records, but remove the operational detail that can
// contain email bodies, seller contact information, or provider errors once it
// no longer helps the product operate.
export const purgeExpiredData = internalMutation({
  args: {},
  returns: purgeResult,
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;
    let more = false;

    const messages = await ctx.db
      .query("agentMessages")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", now - retention.messages))
      .take(BATCH_SIZE);
    for (const message of messages) {
      await ctx.db.delete(message._id);
      deleted++;
    }
    more ||= messages.length === BATCH_SIZE;

    const webhooks = await ctx.db
      .query("webhookEvents")
      .withIndex("by_receivedAt", (q) => q.lt("receivedAt", now - retention.webhooks))
      .take(BATCH_SIZE);
    for (const webhook of webhooks) {
      await ctx.db.delete(webhook._id);
      deleted++;
    }
    more ||= webhooks.length === BATCH_SIZE;

    const notificationKeys = await ctx.db
      .query("notificationKeys")
      .withIndex("by_createdAt", (q) =>
        q.lt("createdAt", now - retention.notificationKeys),
      )
      .take(BATCH_SIZE);
    for (const key of notificationKeys) {
      await ctx.db.delete(key._id);
      deleted++;
    }
    more ||= notificationKeys.length === BATCH_SIZE;

    const notifications = await ctx.db
      .query("notificationQueue")
      .withIndex("by_createdAt", (q) =>
        q.lt("createdAt", now - retention.notifications),
      )
      .take(BATCH_SIZE);
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
      deleted++;
    }
    more ||= notifications.length === BATCH_SIZE;

    const runs = await ctx.db
      .query("huntRuns")
      .withIndex("by_finishedAt", (q) => q.lt("finishedAt", now - retention.runs))
      .take(BATCH_SIZE);
    for (const run of runs) {
      await ctx.db.delete(run._id);
      deleted++;
    }
    more ||= runs.length === BATCH_SIZE;

    const monitorChecks = await ctx.db
      .query("monitorChecks")
      .withIndex("by_createdAt", (q) =>
        q.lt("createdAt", now - retention.monitorChecks),
      )
      .take(BATCH_SIZE);
    for (const check of monitorChecks) {
      await ctx.db.delete(check._id);
      deleted++;
    }
    more ||= monitorChecks.length === BATCH_SIZE;

    const activity = await ctx.db
      .query("events")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", now - retention.activity))
      .take(BATCH_SIZE);
    for (const event of activity) {
      await ctx.db.delete(event._id);
      deleted++;
    }
    more ||= activity.length === BATCH_SIZE;

    const candidates = await ctx.db
      .query("candidates")
      .withIndex("by_discoveredAt", (q) =>
        q.lt("discoveredAt", now - retention.candidatesAndOutreach),
      )
      .take(BATCH_SIZE);
    for (const candidate of candidates) {
      const feedback = await ctx.db
        .query("huntFeedback")
        .withIndex("by_candidate", (q) => q.eq("candidateId", candidate._id))
        .take(BATCH_SIZE);
      const outreach = await ctx.db
        .query("outreach")
        .withIndex("by_candidate", (q) => q.eq("candidateId", candidate._id))
        .take(BATCH_SIZE);
      for (const item of feedback) {
        await ctx.db.delete(item._id);
        deleted++;
      }
      for (const item of outreach) {
        await ctx.db.delete(item._id);
        deleted++;
      }
      if (feedback.length === BATCH_SIZE || outreach.length === BATCH_SIZE) {
        more = true;
        continue;
      }
      await ctx.db.delete(candidate._id);
      deleted++;
    }
    more ||= candidates.length === BATCH_SIZE;

    const standaloneOutreach = await ctx.db
      .query("outreach")
      .withIndex("by_createdAt", (q) =>
        q.lt("createdAt", now - retention.candidatesAndOutreach),
      )
      .take(BATCH_SIZE);
    for (const item of standaloneOutreach) {
      await ctx.db.delete(item._id);
      deleted++;
    }
    more ||= standaloneOutreach.length === BATCH_SIZE;

    return { deleted, more };
  },
});

export const runPurge = internalAction({
  args: {},
  returns: purgeResult,
  handler: async (ctx): Promise<{ deleted: number; more: boolean }> => {
    const result: { deleted: number; more: boolean } = await ctx.runMutation(
      internal.retention.purgeExpiredData,
      {},
    );
    if (result.more) {
      await ctx.scheduler.runAfter(0, internal.retention.runPurge, {});
    }
    return result;
  },
});
