import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const findDueShifts = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    // Index `by_timeoutAt_status` is (timeoutAt, status) — query in that order.
    // To find shifts where timeoutAt < now AND status = "broadcasting", we
    // scan by timeoutAt first and then filter by status.
    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_timeoutAt_status", (q) => q.lt("timeoutAt", args.now))
      .collect();
    return rows.filter((s) => s.status === "broadcasting").slice(0, 50);
  },
});

export const markEscalating = internalMutation({
  args: { id: v.id("shifts") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.id);
    if (!s) return;
    if (s.status !== "broadcasting") return;
    await ctx.db.patch(args.id, { status: "escalating" });
  },
});

export const runEscalationSearch = internalAction({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.escalation.findExternalCandidates, {
      shiftId: args.shiftId,
    });
  },
});

export const findWarmCandidates = internalQuery({
  args: { location: v.string(), role: v.string(), since: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("backupPool")
      .withIndex("by_location_role_crawledAt", (q) =>
        q.eq("location", args.location).eq("role", args.role)
      )
      .collect();
    return rows.filter((r) => r.crawledAt >= args.since);
  },
});

export const warmBackupPool = internalAction({
  args: { location: v.string(), role: v.string() },
  handler: async (ctx, args) => {
    const query = `${args.role} jobs in ${args.location}`;
    const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(
      args.role
    )}&l=${encodeURIComponent(args.location)}`;
    let pages: { url: string; title: string; summary: string }[] = [];
    try {
      pages = (await ctx.runAction(internal.firecrawl.crawl, {
        url: searchUrl,
        limit: 20,
      })) as { url: string; title: string; summary: string }[];
    } catch (e) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "backupPool",
        rowId: "warmBackupPool",
        action: "warm_crawl_failed",
        summary: `Crawl failed for ${query}: ${(e as Error).message}`,
      });
      return { inserted: 0 };
    }
    const now = Date.now();
    let inserted = 0;
    for (const p of pages) {
      const id = await ctx.runMutation(internal.escalationBridge.insertPoolEntry, {
        location: args.location,
        role: args.role,
        candidateContact: p.url,
        candidateName: p.title,
        sourceUrl: p.url,
        crawledAt: now,
      });
      inserted++;
    }
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "backupPool",
      rowId: "warmBackupPool",
      action: "warm_crawl_done",
      summary: `Crawled ${pages.length} page(s) for ${query}, inserted ${inserted}`,
    });
    return { inserted };
  },
});

export const insertPoolEntry = internalMutation({
  args: {
    location: v.string(),
    role: v.string(),
    candidateContact: v.string(),
    candidateName: v.optional(v.string()),
    sourceUrl: v.string(),
    crawledAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("backupPool", args);
  },
});

export const listLocationsAndRoles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").take(50);
    const out: { location: string; role: string }[] = [];
    for (const b of businesses) {
      const shifts = await ctx.db
        .query("shifts")
        .withIndex("by_businessId_status", (q) => q.eq("businessId", b._id))
        .take(10);
      for (const s of shifts) {
        out.push({ location: b.location, role: s.role });
      }
    }
    const seen = new Set<string>();
    return out.filter((x) => {
      const k = x.location + "|" + x.role;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
});
