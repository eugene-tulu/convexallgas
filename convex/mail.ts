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
    return (result.messages ?? []).map((m) => {
      const r = m as { messageId?: unknown; from?: unknown; to?: unknown; subject?: unknown; preview?: unknown };
      return {
        messageId: String(r.messageId ?? ""),
        from: r.from ? String(r.from) : undefined,
        to: r.to ? String(r.to) : undefined,
        subject: r.subject ? String(r.subject) : undefined,
        preview: r.preview ? String(r.preview) : undefined,
      };
    });
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
    } catch (e: any) {
      // Only fall back to "use an existing inbox" when the API key lacks
      // inbox_create (403 ForbiddenError) or the username is already taken
      // (409 conflict). Re-throw network / 5xx errors.
      const msg: string = e?.message ?? "";
      const isPermissionDenied = /403|ForbiddenError|missing_permission/i.test(msg);
      const isAlreadyExists = /409|already.*exist/i.test(msg);
      if (!isPermissionDenied && !isAlreadyExists) throw e;
      const result = await client.inboxes.list();
      const all = (result.inboxes ?? []) as Array<{ inboxId?: unknown; email?: unknown }>;
      const wanted = args.username + "@";
      const found = all.find((i) => String(i.email ?? "").startsWith(wanted));
      if (!found) {
        throw new Error(
          `Cannot create inbox (${isPermissionDenied ? "no inbox_create permission" : "username taken"}) and no existing inbox with prefix "${wanted}"`
        );
      }
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
    return (result.inboxes ?? []).map((i) => ({
      inboxId: String((i as { inboxId?: unknown }).inboxId ?? ""),
      email: String((i as { email?: unknown }).email ?? ""),
      displayName: (i as { displayName?: unknown }).displayName
        ? String((i as { displayName?: unknown }).displayName)
        : undefined,
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
