import { v } from "convex/values";
import { DAY, HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  consumeOpenai: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 50 },
  sendEmail: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 30 },
  // These are deliberately conservative beta guardrails around the operations
  // that create third-party cost. The component makes them transactional and
  // race-safe instead of relying on client-side checks.
  provisionInbox: { kind: "fixed window", rate: 2, period: HOUR },
  runHunt: { kind: "fixed window", rate: 48, period: DAY },
  globalRunHunt: { kind: "fixed window", rate: 1_500, period: DAY },
  createMonitor: { kind: "fixed window", rate: 3, period: DAY },
  globalCreateMonitor: { kind: "fixed window", rate: 250, period: DAY },
});

export const consumeOpenai = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await rateLimiter.limit(ctx, "consumeOpenai", {
      key: args.ownerId,
      throws: false,
    });
    if (!result.ok) {
      throw new Error("OpenAI rate limit exceeded");
    }
    return null;
  },
});

export const consumeEmail = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await rateLimiter.limit(ctx, "sendEmail", {
      key: args.ownerId,
      throws: false,
    });
    if (!result.ok) {
      throw new Error("Email rate limit exceeded");
    }
    return null;
  },
});

export const consumeInboxProvision = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await rateLimiter.limit(ctx, "provisionInbox", {
      key: args.ownerId,
      throws: false,
    });
    if (!result.ok) {
      throw new Error("Please wait before trying to set up another agent inbox");
    }
    return null;
  },
});

export const consumeMonitorCreation = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const perUser = await rateLimiter.limit(ctx, "createMonitor", {
      key: args.ownerId,
      throws: false,
    });
    const global = await rateLimiter.limit(ctx, "globalCreateMonitor", {
      throws: false,
    });
    if (!perUser.ok || !global.ok) {
      throw new Error("Monitoring capacity is reached for now. Please try again later.");
    }
    return null;
  },
});
