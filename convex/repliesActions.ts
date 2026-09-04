"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const dispatchOneEmail = internalAction({
  args: {
    responseId: v.id("responses"),
    workerContact: v.string(),
    businessInboxId: v.string(),
    businessName: v.string(),
    role: v.string(),
    startTime: v.number(),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    kind: v.union(v.literal("confirm"), v.literal("reject")),
  },
  handler: async (ctx, args) => {
    // `workerContact`, `businessInboxId`, `role`, `startTime`, etc. are all
    // resolved by the caller (`sendOneEmail`) so this action does zero DB
    // reads — straight to the LLM and the mail send.
    const text =
      args.kind === "confirm"
        ? await ctx.runAction(internal.llmTasks.draftConfirmEmail, {
            role: args.role,
            startTime: args.startTime,
            businessName: args.businessName,
          })
        : await ctx.runAction(internal.llmTasks.draftRejectEmail, {
            role: args.role,
            businessName: args.businessName,
          });
    const subject = args.kind === "confirm" ? "You're on the shift" : "Shift's covered - thanks";
    await ctx.runAction(internal.mailBridge.sendEmailAction, {
      inboxId: args.businessInboxId,
      to: args.workerContact,
      subject,
      text,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "responses",
      rowId: args.responseId,
      action: args.kind === "confirm" ? "confirm_sent" : "reject_sent",
      summary: `${args.kind} email sent to ${args.workerContact} ($${args.displayRate}${args.displayRateLabel})`,
    });
  },
});

export const dispatchOptInInvite = internalAction({
  args: {
    businessInboxId: v.string(),
    businessName: v.string(),
    to: v.string(),
    link: v.string(),
  },
  handler: async (ctx, args) => {
    const text = `Hi - thanks for responding to the ${args.businessName} call-out so fast. Want to hear about other nearby shifts before they go wide? One tap to opt in: ${args.link}\n\nIf you'd rather not, just ignore this and you won't be on future broadcasts.`;
    await ctx.runAction(internal.mailBridge.sendEmailAction, {
      inboxId: args.businessInboxId,
      to: args.to,
      subject: `Want more shifts like that one?`,
      text,
    });
  },
});
