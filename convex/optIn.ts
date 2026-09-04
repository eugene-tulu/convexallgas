import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const consumeToken = internalMutation({
  args: {
    token: v.string(),
    name: v.string(),
    roles: v.array(v.string()),
    location: v.string(),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("magicTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row) return { ok: false, reason: "unknown token" };
    if (row.usedAt) return { ok: false, reason: "already used" };
    if (row.expiresAt < Date.now()) return { ok: false, reason: "expired" };
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    if (args.consent && row.workerId) {
      await ctx.db.patch(row.workerId, {
        name: args.name,
        roles: args.roles,
        location: args.location,
        consent: true,
        consentedAt: Date.now(),
      });
      await ctx.db.insert("events", {
        table: "workers",
        rowId: row.workerId,
        action: "worker_consented",
        timestamp: Date.now(),
        summary: `Worker opted in via magic link (${row.email})`,
      });
    } else if (row.workerId) {
      await ctx.db.insert("events", {
        table: "workers",
        rowId: row.workerId,
        action: "worker_declined_opt_in",
        timestamp: Date.now(),
        summary: `Worker declined opt-in (${row.email})`,
      });
    }
    return { ok: true, consented: args.consent };
  },
});
