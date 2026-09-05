"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

// Plain `v.string()` for `kind` (rather than a 2-literal union) keeps the
// Convex validator's generic depth shallow across the `internal.*` reference
// graph. Validate at the boundary below; the schema's typed `responses.kind`
// isn't a column — `kind` only flows through this action.
const KINDS = new Set(["confirm", "reject"] as const);

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
    kind: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!KINDS.has(args.kind as "confirm" | "reject")) {
      throw new Error(`Invalid kind: ${args.kind}`);
    }
    const kind = args.kind as "confirm" | "reject";
    // `workerContact`, `businessInboxId`, `role`, `startTime`, etc. are all
    // resolved by the caller (`sendOneEmail`) so this action does zero DB
    // reads — straight to the LLM and the mail send.
    const text = ((
      kind === "confirm"
        ? await ctx.runAction(api.llmTasks.draftConfirmEmail, {
            role: args.role,
            startTime: args.startTime,
            businessName: args.businessName,
          })
        : await ctx.runAction(api.llmTasks.draftRejectEmail, {
            role: args.role,
            businessName: args.businessName,
          })
    ) ?? "") as string;
    const subject = kind === "confirm" ? "You're on the shift" : "Shift's covered - thanks";
    await ctx.runAction(internal.mailBridge.sendEmailAction, {
      inboxId: args.businessInboxId,
      to: args.workerContact,
      subject,
      text,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "responses",
      rowId: args.responseId,
      action: kind === "confirm" ? "confirm_sent" : "reject_sent",
      summary: `${kind} email sent to ${args.workerContact} ($${args.displayRate}${args.displayRateLabel})`,
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
  handler: async (ctx, args): Promise<void> => {
    const text = `Hi - thanks for responding to the ${args.businessName} call-out so fast. Want to hear about other nearby shifts before they go wide? One tap to opt in: ${args.link}\n\nIf you'd rather not, just ignore this and you won't be on future broadcasts.`;
    await ctx.runAction(internal.mailBridge.sendEmailAction, {
      inboxId: args.businessInboxId,
      to: args.to,
      subject: `Want more shifts like that one?`,
      text,
    });
  },
});
