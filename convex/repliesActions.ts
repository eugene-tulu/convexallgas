"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
// actions only - kept separate from mutations/queries in repliesBridge.ts so the "use node" directive is safe

export const dispatchOneEmail = internalAction({
  args: {
    responseId: v.id("responses"),
    businessInboxId: v.string(),
    businessName: v.string(),
    role: v.string(),
    startTime: v.number(),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    kind: v.union(v.literal("confirm"), v.literal("reject")),
  },
  handler: async (ctx, args) => {
    const r: Doc<"responses"> | null = await ctx.runQuery(
      internal.repliesBridge.getResponse,
      { id: args.responseId }
    );
    if (!r || !r.workerId) return;
    const w: Doc<"workers"> | null = await ctx.runQuery(
      internal.repliesBridge.getWorkerDoc,
      { id: r.workerId }
    );
    if (!w) return;
    const text =
      args.kind === "confirm"
        ? ((await ctx.runAction(internal.llmTasks.draftConfirmEmail, {
            role: args.role,
            startTime: args.startTime,
            businessName: args.businessName,
          })) as string)
        : ((await ctx.runAction(internal.llmTasks.draftRejectEmail, {
            role: args.role,
            businessName: args.businessName,
          })) as string);
    const subject = args.kind === "confirm" ? "You're on the shift" : "Shift's covered - thanks";
    await ctx.runAction(internal.mailBridge.sendEmailAction, {
      inboxId: args.businessInboxId,
      to: w.contact,
      subject,
      text,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "responses",
      rowId: args.responseId,
      action: args.kind === "confirm" ? "confirm_sent" : "reject_sent",
      summary: `${args.kind} email sent to ${w.contact} ($${args.displayRate}${args.displayRateLabel})`,
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
