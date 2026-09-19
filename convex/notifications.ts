import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const notificationStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("disabled"),
  v.literal("unavailable"),
);

const retryResult = v.object({
  scheduled: v.boolean(),
  delayMs: v.optional(v.number()),
});

const MAX_ATTEMPTS = 3;
const STALE_SENDING_MS = 10 * 60 * 1000;

export const enqueue = internalMutation({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    text: v.string(),
    idempotencyKey: v.string(),
    coalesceKey: v.string(),
    scheduledAt: v.number(),
  },
  returns: v.object({ notificationId: v.id("notificationQueue"), shouldSchedule: v.boolean() }),
  handler: async (ctx, args) => {
    const existingKey = await ctx.db
      .query("notificationKeys")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existingKey) {
      return { notificationId: existingKey.notificationId, shouldSchedule: false };
    }

    const coalesced = await ctx.db
      .query("notificationQueue")
      .withIndex("by_coalesce", (q) => q.eq("coalesceKey", args.coalesceKey))
      .first();
    if (coalesced && coalesced.status === "queued") {
      await ctx.db.patch(coalesced._id, {
        text: `${coalesced.text}\n\n${args.text}`.slice(0, 12000),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("notificationKeys", {
        idempotencyKey: args.idempotencyKey,
        notificationId: coalesced._id,
        createdAt: Date.now(),
      });
      return { notificationId: coalesced._id, shouldSchedule: false };
    }

    const notificationId = await ctx.db.insert("notificationQueue", {
      huntId: args.huntId,
      ownerId: args.ownerId,
      text: args.text.slice(0, 12000),
      idempotencyKey: args.idempotencyKey,
      coalesceKey: args.coalesceKey,
      scheduledAt: args.scheduledAt,
      status: "queued",
      createdAt: Date.now(),
      attempt: 0,
      nextAttemptAt: args.scheduledAt,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("notificationKeys", {
      idempotencyKey: args.idempotencyKey,
      notificationId,
      createdAt: Date.now(),
    });
    return { notificationId, shouldSchedule: true };
  },
});

export const claim = internalMutation({
  args: { notificationId: v.id("notificationQueue") },
  returns: v.union(schema.doc("notificationQueue"), v.null()),
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.status !== "queued") return null;
    if (notification.nextAttemptAt && notification.nextAttemptAt > Date.now()) return null;
    await ctx.db.patch(notification._id, {
      status: "sending",
      attempt: (notification.attempt ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return notification;
  },
});

export const markStatus = internalMutation({
  args: {
    notificationId: v.id("notificationQueue"),
    status: notificationStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;
    if (args.status === "sent") {
      await ctx.db.patch(notification._id, {
        status: args.status,
        sentAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.operationalIssues.resolve, {
        fingerprint: `outbound-email:${notification._id}`,
      });
    } else {
      await ctx.db.patch(notification._id, { status: args.status, updatedAt: Date.now() });
    }
    return null;
  },
});

export const rescheduleAfterFailure = internalMutation({
  args: {
    notificationId: v.id("notificationQueue"),
    error: v.string(),
  },
  returns: retryResult,
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.status !== "sending") {
      return { scheduled: false };
    }

    const attempt = notification.attempt ?? 1;
    if (attempt >= MAX_ATTEMPTS) {
      await ctx.db.patch(notification._id, {
        status: "unavailable",
        lastError: args.error.slice(0, 500),
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.operationalIssues.report, {
        ownerId: notification.ownerId,
        huntId: notification.huntId,
        source: "notification",
        severity: "error",
        fingerprint: `outbound-email:${notification._id}`,
        summary:
          "A mission update could not be delivered after retries. The update remains in your dashboard.",
      });
      return { scheduled: false };
    }

    const delayMs = Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** (attempt - 1));
    const retryAt = Date.now() + delayMs;
    await ctx.db.patch(notification._id, {
      status: "queued",
      nextAttemptAt: retryAt,
      lastError: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { scheduled: true, delayMs };
  },
});

export const requeueStale = internalMutation({
  args: {},
  returns: v.array(v.id("notificationQueue")),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("notificationQueue")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", "sending").lt("updatedAt", Date.now() - STALE_SENDING_MS),
      )
      .take(25);
    const ids: Id<"notificationQueue">[] = [];
    for (const notification of stale) {
      await ctx.db.patch(notification._id, {
        status: "queued",
        nextAttemptAt: Date.now(),
        updatedAt: Date.now(),
      });
      ids.push(notification._id);
    }
    return ids;
  },
});

export const listDue = internalQuery({
  // The recovery action supplies the clock. Reading Date.now() inside a query
  // makes its result needlessly non-reactive and can leave a newly-due retry
  // invisible to a cached caller.
  args: { now: v.number() },
  returns: v.array(v.id("notificationQueue")),
  handler: async (ctx, args) => {
    const due = await ctx.db
      .query("notificationQueue")
      .withIndex("by_status_nextAttemptAt", (q) =>
        q.eq("status", "queued").lte("nextAttemptAt", args.now),
      )
      .take(25);
    return due.map((notification) => notification._id);
  },
});

export const get = internalQuery({
  args: { notificationId: v.id("notificationQueue") },
  returns: v.union(schema.doc("notificationQueue"), v.null()),
  handler: async (ctx, args) => await ctx.db.get(args.notificationId),
});
