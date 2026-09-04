"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// All test helpers are internal — they were exposed during initial verification
// but must not be callable from the client. Use the Convex dashboard to invoke.
export const simulateReply = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.replies.processBroadcastReply, {
      inboxId: args.inboxId,
      messageId: args.messageId,
      subject: args.subject,
      from: args.from,
      text: args.text,
      html: undefined,
    });
  },
});

export const triggerEscalation = internalAction({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.escalationBridge.runEscalationSearch, {
      shiftId: args.shiftId,
    });
  },
});

export const triggerEscalationCron = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.escalation.checkEscalations, {});
  },
});

export const raceApprove = internalAction({
  args: { shiftId: v.id("shifts"), responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        ctx.runMutation(api.repliesQueries.approveCandidate, {
          shiftId: args.shiftId,
          responseId: args.responseId,
        }).catch((e: Error) => ({ error: e.message }))
      );
    }
    return await Promise.all(promises);
  },
});

export const testConsentFilter = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const consented = await ctx.runQuery(internal.workersBridge.listConsentedForBusiness, {
      businessId: args.businessId,
    });
    const all = await ctx.runQuery(api.workers.list, { businessId: args.businessId });
    return {
      total: all.length,
      consented: consented.length,
      consentedContacts: consented.map((c: { contact: string }) => c.contact),
      nonConsented: all
        .filter((w: { consent: boolean }) => !w.consent)
        .map((w: { contact: string }) => w.contact),
    };
  },
});

export const testBackupPoolTtl = internalAction({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const staleId: string = await ctx.runMutation(
      internal.escalationBridge.insertPoolEntry,
      {
        location: "Merced, CA",
        role: "barista",
        candidateContact: "stale@example.com",
        candidateName: "Stale Entry",
        sourceUrl: "https://example.com/stale",
        crawledAt: Date.now() - 25 * 60 * 60 * 1000,
      }
    );
    const freshId: string = await ctx.runMutation(
      internal.escalationBridge.insertPoolEntry,
      {
        location: "Merced, CA",
        role: "barista",
        candidateContact: "fresh@example.com",
        candidateName: "Fresh Entry",
        sourceUrl: "https://example.com/fresh",
        crawledAt: Date.now(),
      }
    );
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const visible = await ctx.runQuery(internal.escalationBridge.findWarmCandidates, {
      location: "Merced, CA",
      role: "barista",
      since,
    });
    return {
      staleInserted: staleId,
      freshInserted: freshId,
      visibleCount: visible.length,
      visibleContact: visible[0]?.candidateContact,
    };
  },
});
