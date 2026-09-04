"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { AgentMailClient } from "agentmail";

function getClient() {
  return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY! });
}

export const listMessages = action({
  args: { inboxId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.messages.list(args.inboxId, {
      limit: args.limit ?? 20,
    });
    return (result.messages ?? []).map((m: Record<string, unknown>) => ({
      messageId: String(m.messageId ?? ""),
      from: m.from ? String(m.from) : undefined,
      to: m.to ? String(m.to) : undefined,
      subject: m.subject ? String(m.subject) : undefined,
      preview: m.preview ? String(m.preview) : undefined,
    }));
  },
});

export const getOrCreateInbox = action({
  args: {
    username: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    let inbox: { inboxId: string; email: string };
    try {
      const created = await client.inboxes.create({
        username: args.username,
        displayName: args.displayName ?? args.username,
      });
      inbox = { inboxId: String(created.inboxId), email: String(created.email) };
    } catch (e) {
      // Fall back to listing inboxes and finding one we can use.
      const result = await client.inboxes.list();
      const all = (result.inboxes ?? []) as Array<Record<string, unknown>>;
      const found = all.find(
        (i) => String(i.email ?? "").startsWith(args.username + "@") || String(i.email ?? "") === `${args.username}@agentmail.to`
      );
      if (!found) throw e;
      inbox = { inboxId: String(found.inboxId), email: String(found.email) };
    }

    const siteUrl = env.CONVEX_SITE_URL;
    if (siteUrl) {
      try {
        const existing = await client.inboxes.webhooks.list(inbox.inboxId);
        const alreadyRegistered = (existing.webhooks ?? []).some(
          (w) => w.url === `${siteUrl}/webhooks/agentmail`
        );
        if (!alreadyRegistered) {
          await client.inboxes.webhooks.create(inbox.inboxId, {
            url: `${siteUrl}/webhooks/agentmail`,
            eventTypes: ["message.received"],
          });
        }
      } catch (e) {
        console.error("Failed to register webhook:", e);
      }
    }

    return {
      inboxId: inbox.inboxId,
      email: inbox.email,
    };
  },
});

export const listInboxes = action({
  args: {},
  handler: async (ctx) => {
    const client = getClient();
    const result = await client.inboxes.list();
    return (result.inboxes ?? []).map((i: Record<string, unknown>) => ({
      inboxId: String(i.inboxId ?? ""),
      email: String(i.email ?? ""),
      displayName: i.displayName ? String(i.displayName) : undefined,
    }));
  },
});

export const sendEmail = action({
  args: {
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    await client.inboxes.messages.send(args.inboxId, {
      to: args.to,
      subject: args.subject,
      text: args.text,
    });
    return { success: true };
  },
});

export const fetchMessage = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const message = await client.inboxes.messages.get(args.inboxId, args.messageId);
    return {
      text: message.text ?? "",
      subject: message.subject ?? "",
      from: message.from ?? "",
      to: message.to ?? [],
    };
  },
});
