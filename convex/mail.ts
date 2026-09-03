"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { AgentMailClient } from "agentmail";

function getClient() {
  return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY! });
}

export const getOrCreateInbox = action({
  args: {
    username: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const inbox = await client.inboxes.create({
      username: args.username,
      displayName: args.displayName ?? args.username,
    });

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
    return result.inboxes ?? [];
  },
});

export const getInbox = action({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    const client = getClient();
    const inbox = await client.inboxes.get(args.inboxId);
    return inbox;
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

export const listMessages = action({
  args: {
    inboxId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.messages.list(args.inboxId, {
      limit: args.limit ?? 50,
    });
    return result.messages ?? [];
  },
});

export const searchMessages = action({
  args: {
    inboxId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.messages.search(args.inboxId, {
      q: args.query,
      limit: args.limit ?? 50,
    });
    return result.messages ?? [];
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
    const labels = message.labels ?? [];
    return {
      text: message.text ?? "",
      subject: message.subject ?? "",
      from: message.from ?? "",
      to: message.to ?? [],
      labels: labels,
      unread: labels.includes("unread"),
    };
  },
});

export const markMessageRead = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    await client.inboxes.messages.update(args.inboxId, args.messageId, {
      addLabels: ["read"],
      removeLabels: ["unread"],
    });
    return { success: true };
  },
});

export const fetchAttachment = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    attachmentId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.messages.getAttachment(
      args.inboxId,
      args.messageId,
      args.attachmentId
    );
    return {
      downloadUrl: result.downloadUrl ?? "",
      contentType: result.contentType ?? "",
      filename: result.filename ?? "",
      size: result.size ?? 0,
      expiresAt: result.expiresAt.toISOString(),
    };
  },
});

export const fetchRawMessage = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.messages.getRaw(args.inboxId, args.messageId);
    return {
      downloadUrl: result.downloadUrl ?? "",
      size: result.size ?? 0,
      expiresAt: result.expiresAt ?? "",
    };
  },
});

export const registerWebhook = internalAction({
  args: {
    inboxId: v.string(),
    webhookUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    await client.inboxes.webhooks.create(args.inboxId, {
      url: args.webhookUrl,
      eventTypes: ["message.received"],
    });
    return { success: true };
  },
});

export const listWebhooks = internalAction({
  args: { inboxId: v.string() },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.inboxes.webhooks.list(args.inboxId);
    return result.webhooks ?? [];
  },
});

export const deleteWebhook = internalAction({
  args: {
    inboxId: v.string(),
    webhookId: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    await client.inboxes.webhooks.delete(args.inboxId, args.webhookId);
    return { success: true };
  },
});
