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
  }
  return inbox;
}

export const sendReminderEmail = internalAction({
  args: {
    projectName: v.string(),
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
    const subject = daysOverdue > 0
      ? `OVERDUE: ${args.obligationText}`
      : `Reminder: ${args.obligationText}`;
    const body = `Project: ${args.projectName}

Obligation: ${args.obligationText}
Deadline: ${deadlineStr}
${daysOverdue > 0 ? `Status: ${daysOverdue} day(s) overdue` : "Status: Due now"}

This is an automated reminder from the EIA Compliance Copilot. Please take action to complete or update this obligation.

Reply to this email with "done" to mark it complete, or visit the dashboard for more options.`;

    await client.inboxes.messages.send(inbox.inboxId, {
      to: args.recipient,
      subject,
      text: body,
    });

    return { success: true, inbox: inbox.email, recipient: args.recipient };
  },
});
