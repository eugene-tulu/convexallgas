"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import { AgentMailClient } from "agentmail";
import { Id } from "./_generated/dataModel";

function getClient() {
  return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY! });
}

const OBLIGATION_TAG_RE = /\[obligation:([a-zA-Z0-9_-]+)\]/;

function parseCommand(text: string): { action: "done" | "snooze" | "report" | "unknown"; snoozeDays?: number; note?: string } {
  const lower = text.toLowerCase().trim();
  if (lower === "done" || lower === "complete" || lower === "✓" || lower.startsWith("done ") || lower.startsWith("complete ")) {
    return { action: "done" };
  }
  const snoozeMatch = lower.match(/^snooze\s+(\d+)/);
  if (snoozeMatch) {
    return { action: "snooze", snoozeDays: parseInt(snoozeMatch[1], 10) };
  }
  if (lower.startsWith("report") || lower.startsWith("update")) {
    const note = text.replace(/^(report|update):?\s*/i, "").trim();
    return { action: "report", note };
  }
  return { action: "unknown" };
}

export const processReply = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    subject: v.string(),
    from: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const tagMatch = args.subject.match(OBLIGATION_TAG_RE) ?? args.text.match(OBLIGATION_TAG_RE);
    if (!tagMatch) {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "webhook",
        rowId: args.messageId,
        action: "ignored",
        summary: `Reply from ${args.from} did not include an [obligation:<id>] tag - subject: "${args.subject.slice(0, 80)}"`,
      });
      return { processed: false, reason: "no obligation tag" };
    }

    const obligationId = tagMatch[1] as Id<"obligations">;
    const command = parseCommand(args.text);
    const from = args.from;

    if (command.action === "unknown") {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: obligationId,
        action: "reply-unknown",
        summary: `Reply from ${from} didn't match a known command: "${args.text.slice(0, 100)}"`,
      });
      return { processed: false, reason: "unknown command" };
    }

    if (command.action === "done") {
      await ctx.runMutation(internal.obligations.markObligationCompletedById, {
        obligationId,
        source: `email-reply from ${from}`,
      });
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: obligationId,
        action: "completed-by-reply",
        summary: `Marked complete via email reply from ${from}`,
      });
      return { processed: true, action: "done", obligationId };
    }

    if (command.action === "snooze" && command.snoozeDays) {
      const snoozeMs = command.snoozeDays * 24 * 60 * 60 * 1000;
      await ctx.runMutation(internal.obligations.snoozeObligationById, {
        obligationId,
        snoozeMs,
        source: `email-reply from ${from}`,
      });
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: obligationId,
        action: "snoozed-by-reply",
        summary: `Snoozed ${command.snoozeDays}d via email reply from ${from}`,
      });
      return { processed: true, action: "snooze", obligationId, snoozeDays: command.snoozeDays };
    }

    if (command.action === "report" && command.note) {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: obligationId,
        action: "note-from-reply",
        summary: `Note from ${from}: ${command.note.slice(0, 200)}`,
      });
      return { processed: true, action: "report", obligationId, note: command.note };
    }

    return { processed: false, reason: "unhandled command variant" };
  },
});

export const registerAllWebhooks = internalAction({
  args: {},
  handler: async (ctx) => {
    const client = getClient();
    const siteUrl = env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL not set - cannot register webhooks");
    }
    const webhookUrl = `${siteUrl}/webhooks/agentmail`;
    const inboxes = await client.inboxes.list();
    const results = [];
    for (const inbox of inboxes.inboxes ?? []) {
      const existing = await client.inboxes.webhooks.list(inbox.inboxId);
      const alreadyRegistered = (existing.webhooks ?? []).some((w) => w.url === webhookUrl);
      if (!alreadyRegistered) {
        await client.inboxes.webhooks.create(inbox.inboxId, {
          url: webhookUrl,
          eventTypes: ["message.received"],
        });
        results.push({ inboxId: inbox.inboxId, action: "registered" });
      } else {
        results.push({ inboxId: inbox.inboxId, action: "already-registered" });
      }
    }
    return results;
  },
});
