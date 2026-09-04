"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export const createBusiness = action({
  args: {
    name: v.string(),
    category: v.string(),
    hoursJson: v.optional(v.string()),
    sizeSignal: v.optional(v.string()),
    location: v.string(),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug =
      args.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "biz";
    const username = `${slug}-${Date.now().toString(36).slice(-6)}`;
    const inbox = (await ctx.runAction(internal.mailBridge.createInboxAction, {
      username,
      displayName: args.name,
    })) as { inboxId: string; email: string };
    const businessId = await ctx.runMutation(internal.businessesBridge.insertBusiness, {
      name: args.name,
      category: args.category,
      hoursJson: args.hoursJson ?? "",
      sizeSignal: args.sizeSignal ?? "",
      location: args.location,
      sourceUrl: args.sourceUrl ?? "",
      inboxId: inbox.inboxId,
      inboxEmail: inbox.email,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "businesses",
      rowId: businessId,
      action: "business_created",
      summary: `Created business "${args.name}" with inbox ${inbox.email}`,
    });
    return { businessId, inboxId: inbox.inboxId, inboxEmail: inbox.email };
  },
});
