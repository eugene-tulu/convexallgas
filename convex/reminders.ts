"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { AgentMailClient } from "agentmail";

const COMPLIANCE_INBOX = "compliance-bot";

function getClient() {
  return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY! });
}

async function ensureInbox(client: AgentMailClient) {
  const list = await client.inboxes.list();
  let inbox = list.inboxes?.find((i) => i.email?.startsWith(`${COMPLIANCE_INBOX}@`));
  if (!inbox) {
    inbox = await client.inboxes.create({
      username: COMPLIANCE_INBOX,
      displayName: "Compliance Bot",
    });

    const siteUrl = env.CONVEX_SITE_URL;
    if (siteUrl) {
      try {
        await client.inboxes.webhooks.create(inbox.inboxId, {
          url: `${siteUrl}/webhooks/agentmail`,
          eventTypes: ["message.received"],
        });
      } catch (e) {
        console.error("Failed to register webhook on compliance inbox:", e);
      }
    }
  }
  return inbox;
}

export const sendReminderEmail = internalAction({
  args: {
    projectName: v.string(),
    obligationId: v.optional(v.string()),
    obligationText: v.string(),
    deadline: v.number(),
    recipient: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.recipient || !args.recipient.includes("@")) {
      throw new Error(
        `sendReminderEmail: no valid recipient. projectName="${args.projectName}" obligation="${args.obligationText}". Set contactEmail on the project.`
      );
    }

    const client = getClient();
    const inbox = await ensureInbox(client);

    const deadlineStr = new Date(args.deadline).toLocaleDateString();
    const daysOverdue = Math.ceil((Date.now() - args.deadline) / (1000 * 60 * 60 * 24));
    const tag = args.obligationId ? `[obligation:${args.obligationId}]` : "[obligation:unknown]";
    const subject = `${tag} ${daysOverdue > 0 ? "OVERDUE" : "Reminder"}: ${args.obligationText}`;
    const body = `Project: ${args.projectName}

Obligation: ${args.obligationText}
Deadline: ${deadlineStr}
${daysOverdue > 0 ? `Status: ${daysOverdue} day(s) overdue` : "Status: Due now"}
Tracking ID: ${tag}

This is an automated reminder from the EIA Compliance Copilot. Please take action to complete or update this obligation.

REPLY COMMANDS:
  Reply with "done" or "complete" - mark this obligation complete
  Reply with "snooze 7" or "snooze 14" - postpone by N days
  Reply with "report" or "update" - add a status update (followed by your note)

Or visit the dashboard to take action directly.`;

    await client.inboxes.messages.send(inbox.inboxId, {
      to: args.recipient,
      subject,
      text: body,
    });

    return {
      success: true,
      inbox: inbox.email,
      recipient: args.recipient,
      subject,
      tag,
    };
  },
});
