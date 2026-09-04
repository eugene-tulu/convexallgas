"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

export const seedDemo = internalAction({
  args: {},
  handler: async (ctx) => {
    const existingBiz = await ctx.runQuery(internal.seedBridge.findBusinessByName, {
      name: "Merced Coffee Co.",
    });
    if (existingBiz) {
      return {
        alreadySeeded: true,
        businessId: existingBiz,
      };
    }

    let inbox: { inboxId: string; email: string };
    try {
      inbox = (await ctx.runAction(internal.mailBridge.createInboxAction, {
        username: `merced-coffee-${Date.now().toString(36).slice(-5)}`,
        displayName: "Merced Coffee Co.",
      })) as { inboxId: string; email: string };
    } catch (e) {
      // The AgentMail key may not have inbox_create permission. Fall back to an
      // existing inbox the key can read.
      const list = (await ctx.runAction(api.mail.listInboxes, {})) as Array<{
        inboxId: string;
        email: string;
      }>;
      if (!list.length) throw e;
      inbox = list[0];
    }
    const businessId = await ctx.runMutation(internal.seedBridge.insertBusiness, {
      name: "Merced Coffee Co.",
      category: "cafe",
      hoursJson: JSON.stringify({
        mon: "6-17",
        tue: "6-17",
        wed: "6-17",
        thu: "6-17",
        fri: "6-19",
        sat: "7-19",
        sun: "7-15",
      }),
      sizeSignal: "small (3-8 staff)",
      location: "Merced, CA",
      sourceUrl: "https://example.com/merced-coffee",
      inboxId: inbox.inboxId,
      inboxEmail: inbox.email,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "businesses",
      rowId: businessId,
      action: "seed_business",
      summary: `Seeded demo business Merced Coffee Co. with inbox ${inbox.email}`,
    });

    const demoWorkers = [
      { name: "Avery Park", contact: "avery.park+e2e@agentmail.to", roles: ["barista", "shift lead"], reliability: 0.85 },
      { name: "Jordan Lee", contact: "jordan.lee+e2e@agentmail.to", roles: ["barista"], reliability: 0.7 },
      { name: "Sam Rivera", contact: "sam.rivera+e2e@agentmail.to", roles: ["barista", "cashier"], reliability: 0.6 },
    ];
    const workerIds: string[] = [];
    for (const w of demoWorkers) {
      const id = await ctx.runMutation(internal.seedBridge.insertWorker, {
        businessId,
        name: w.name,
        contact: w.contact,
        roles: w.roles,
        location: "Merced, CA",
        consent: true,
        reliabilityScore: w.reliability,
      });
      workerIds.push(id);
    }

    const declinerId = await ctx.runMutation(internal.seedBridge.insertWorker, {
      businessId,
      name: "Casey Tan",
      contact: "casey.tan+e2e@agentmail.to",
      roles: ["barista"],
      location: "Merced, CA",
      consent: false,
      reliabilityScore: 0.4,
    });

    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "workers",
      rowId: declinerId,
      action: "seed_worker",
      summary: "Seeded decliner worker (consent=false) for consent-filter test",
    });

    return { businessId, inboxEmail: inbox.email, workerIds, declinerId };
  },
});

export const listSeed = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.seedBridge.listSeed, {});
  },
});
