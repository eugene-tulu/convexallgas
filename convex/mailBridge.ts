"use node";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

export const createInboxAction = internalAction({
  args: {
    username: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
  handler: async (ctx, args) => {
    return await ctx.runAction(api.mail.sendEmail, args);
  },
});

export const fetchMessageAction = internalAction({
  args: { inboxId: v.string(), messageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runAction(api.mail.fetchMessage, args);
  },
});
