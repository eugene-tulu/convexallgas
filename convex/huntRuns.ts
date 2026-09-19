import { v } from "convex/values";
import { internal } from "./_generated/api";
import { rateLimiter } from "./rateLimit";
import {
  internalMutation,
  query,
} from "./_generated/server";

const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

const trigger = v.union(
  v.literal("manual"),
  v.literal("scheduled"),
  v.literal("email"),
  v.literal("monitor"),
);

const runResult = v.object({
  runId: v.id("huntRuns"),
  status: runStatus,
  scheduled: v.boolean(),
});

export const enqueueForHunt = internalMutation({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    trigger,
    idempotencyKey: v.string(),
  },
  returns: runResult,
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Hunt not found");
    if (hunt.status !== "active") throw new Error("Hunt is paused or archived");
    if (hunt.expiresAt && hunt.expiresAt <= Date.now()) {
      await ctx.db.patch(hunt._id, { status: "archived" });
      throw new Error("This mission has expired and was archived");
    }

    const existingByKey = await ctx.db
      .query("huntRuns")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existingByKey) {
      return {
        runId: existingByKey._id,
        status: existingByKey.status,
        scheduled: false,
      };
    }

    const active =
      (await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) =>
          q.eq("huntId", args.huntId).eq("status", "running"),
        )
        .first()) ??
      (await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) =>
          q.eq("huntId", args.huntId).eq("status", "queued"),
        )
        .first());

    if (active) {
      return {
        runId: active._id,
        status: active.status as "queued" | "running" | "completed" | "failed",
        scheduled: false,
      };
    }

    const perUserQuota = await rateLimiter.limit(ctx, "runHunt", {
      key: args.ownerId,
      throws: false,
    });
    const globalQuota = await rateLimiter.limit(ctx, "globalRunHunt", {
      throws: false,
    });
    if (!perUserQuota.ok || !globalQuota.ok) {
      throw new Error("Search capacity is reached for now. Please try again later.");
    }

    const runId = await ctx.db.insert("huntRuns", {
      huntId: args.huntId,
      ownerId: args.ownerId,
      trigger: args.trigger,
      status: "queued",
      idempotencyKey: args.idempotencyKey,
      scheduledAt: Date.now(),
      attempt: 1,
    });
    await ctx.scheduler.runAfter(0, internal.hunt.runHuntJob, { runId });
    return { runId, status: "queued" as const, scheduled: true };
  },
});

export const enqueueActive = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    scheduled: v.number(),
    skipped: v.number(),
    continueCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const activeHunts = await ctx.db
      .query("hunts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ numItems: 50, cursor: args.cursor ?? null });
    let scheduled = 0;
    let skipped = 0;

    for (const hunt of activeHunts.page) {
      if (hunt.expiresAt && hunt.expiresAt <= now) {
        await ctx.db.patch(hunt._id, { status: "archived" });
        await ctx.scheduler.runAfter(0, internal.hunt.expireMission, {
          huntId: hunt._id,
        });
        skipped++;
        continue;
      }
      if (hunt.mode === "monitor" || hunt.mode === "one_off") {
        skipped++;
        continue;
      }
      if (hunt.nextRunAt && hunt.nextRunAt > now) {
        skipped++;
        continue;
      }
      const running = await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) =>
          q.eq("huntId", hunt._id).eq("status", "running"),
        )
        .first();
      const queued = await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) =>
          q.eq("huntId", hunt._id).eq("status", "queued"),
        )
        .first();
      if (running || queued) {
        skipped++;
        continue;
      }

      const idempotencyKey = `scheduled:${hunt._id}:${Math.floor(now / 900000)}`;
      const alreadyScheduled = await ctx.db
        .query("huntRuns")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
        .first();
      if (alreadyScheduled) {
        skipped++;
        continue;
      }

      // Scheduled work should pause gracefully when this owner's daily beta
      // allowance is spent, without aborting unrelated missions in the cron.
      const quota = await rateLimiter.limit(ctx, "runHunt", {
        key: hunt.ownerId,
        throws: false,
      });
      if (!quota.ok) {
        await ctx.db.patch(hunt._id, {
          nextRunAt: now + Math.max(15 * 60 * 1000, quota.retryAfter),
        });
        skipped++;
        continue;
      }
      const globalQuota = await rateLimiter.limit(ctx, "globalRunHunt", {
        throws: false,
      });
      if (!globalQuota.ok) {
        // The whole beta has reached its daily allowance. Stop this page now
        // rather than burning through owner quotas while nothing can run.
        await ctx.db.patch(hunt._id, {
          nextRunAt: now + Math.max(15 * 60 * 1000, globalQuota.retryAfter),
        });
        skipped++;
        break;
      }

      const runId = await ctx.db.insert("huntRuns", {
        huntId: hunt._id,
        ownerId: hunt.ownerId,
        trigger: "scheduled",
        status: "queued",
        idempotencyKey,
        scheduledAt: now,
        attempt: 1,
      });
      await ctx.scheduler.runAfter(0, internal.hunt.runHuntJob, { runId });
      scheduled++;
    }

    return {
      scheduled,
      skipped,
      continueCursor: activeHunts.isDone
        ? undefined
        : activeHunts.continueCursor,
    };
  },
});

export const start = internalMutation({
  args: { runId: v.id("huntRuns") },
  returns: v.union(
    v.object({ huntId: v.id("hunts"), ownerId: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued") return null;
    await ctx.db.patch(args.runId, {
      status: "running",
      startedAt: Date.now(),
    });
    return { huntId: run.huntId, ownerId: run.ownerId };
  },
});

export const complete = internalMutation({
  args: {
    runId: v.id("huntRuns"),
    candidatesFound: v.number(),
    cleared: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(args.runId, {
      status: "completed",
      finishedAt: Date.now(),
      candidatesFound: args.candidatesFound,
      cleared: args.cleared,
    });
    await ctx.runMutation(internal.operationalIssues.resolve, {
      fingerprint: `hunt-run:${args.runId}`,
    });
    const hunt = await ctx.db.get(run.huntId);
    if (!hunt || hunt.status !== "active") return null;
    const completedAt = Date.now();
    if (hunt.mode === "one_off") {
      await ctx.db.patch(run.huntId, { lastRunAt: completedAt });
      return null;
    }
    const cadenceMinutes = Math.max(15, Math.min(10080, hunt.cadenceMinutes ?? 30));
    await ctx.db.patch(run.huntId, {
      lastRunAt: completedAt,
      nextRunAt: completedAt + cadenceMinutes * 60 * 1000,
    });
    return null;
  },
});

export const failOrRetry = internalMutation({
  args: { runId: v.id("huntRuns"), error: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return false;
    if (run.attempt < 3) {
      await ctx.db.patch(args.runId, {
        status: "queued",
        attempt: run.attempt + 1,
        scheduledAt: Date.now() + run.attempt * 60 * 1000,
        error: args.error.slice(0, 1000),
      });
      await ctx.scheduler.runAfter(
        run.attempt * 60 * 1000,
        internal.hunt.runHuntJob,
        { runId: args.runId },
      );
      return true;
    }
    await ctx.db.patch(args.runId, {
      status: "failed",
      finishedAt: Date.now(),
      error: args.error.slice(0, 1000),
    });
    await ctx.runMutation(internal.operationalIssues.report, {
      ownerId: run.ownerId,
      huntId: run.huntId,
      source: "hunt",
      severity: "error",
      fingerprint: `hunt-run:${args.runId}`,
      summary:
        "A market check could not finish after retries. Your mission is saved; try another check from its dashboard trail.",
    });
    return false;
  },
});

export const listForHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(
    v.object({
      _id: v.id("huntRuns"),
      status: runStatus,
      trigger,
      attempt: v.number(),
      scheduledAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      error: v.optional(v.string()),
      candidatesFound: v.optional(v.number()),
      cleared: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    const runs = await ctx.db
      .query("huntRuns")
      .withIndex("by_hunt_status", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(20);
    return runs.map((run) => ({
      _id: run._id,
      status: run.status,
      trigger: run.trigger,
      attempt: run.attempt,
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error,
      candidatesFound: run.candidatesFound,
      cleared: run.cleared,
    }));
  },
});
