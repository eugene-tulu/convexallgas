"use node";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { v } from "convex/values";

// All three bridges return their inner result as-is. Using `Promise<unknown>`
// (instead of letting TS infer the return through `ctx.runAction`) breaks the
// generic-depth chain that triggers TS2589 when the inner action's return type
// references the schema's union columns.
export const createInboxAction = internalAction({
  args: {
    username: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runAction(api.mail.getOrCreateInbox, args);
  },
});

export const sendEmailAction = internalAction({
  args: {
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runAction(api.mail.sendEmail, args);
  },
});

export const fetchMessageAction = internalAction({
  args: { inboxId: v.string(), messageId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    return await ctx.runAction(internal.mail.fetchMessage, args);
  },
});
