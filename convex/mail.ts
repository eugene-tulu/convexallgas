"use node";

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { AgentMailClient } from "agentmail";
import { toAgentMailIdempotencyKey } from "./agentmailIdempotency";

const inboxResult = v.object({
  inboxId: v.string(),
  email: v.string(),
});

const inboxAccess = v.union(v.literal("private"), v.literal("demo"));

const inboxSetupResult = v.union(
  v.object({
    kind: v.literal("ready"),
    inboxId: v.string(),
    email: v.string(),
    access: inboxAccess,
  }),
  v.object({
    kind: v.union(
      v.literal("waitlist"),
      v.literal("verification_required"),
      v.literal("retry"),
    ),
    message: v.string(),
  }),
);

const messageResult = v.object({
  messageId: v.string(),
  threadId: v.string(),
});

function getClient() {
  return new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY });
}

type AgentMailErrorDetails = {
  status?: number;
  name?: string;
  code?: string;
};

type InboxMapping = {
  ownerId: string;
  ownerEmail?: string;
  inboxId: string;
  email: string;
  access?: "private" | "demo";
  webhookId?: string;
  webhookSecret?: string;
  status: "active" | "disabled";
};

type InboxSetupResponse =
  | { kind: "ready"; inboxId: string; email: string; access: "private" | "demo" }
  | {
      kind: "waitlist" | "verification_required" | "retry";
      message: string;
    };

function safeProviderField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const safeValue = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 100);
  return safeValue || undefined;
}

function agentMailErrorDetails(error: unknown): AgentMailErrorDetails {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  const body =
    record.body && typeof record.body === "object" && !Array.isArray(record.body)
      ? (record.body as Record<string, unknown>)
      : undefined;
  return {
    status: typeof record.statusCode === "number" ? record.statusCode : undefined,
    name: safeProviderField(body?.name) ?? safeProviderField(record.name),
    code: safeProviderField(body?.code) ?? safeProviderField(record.code),
  };
}

function privateInboxProvisioningIsUnavailable(error: unknown): boolean {
  const details = agentMailErrorDetails(error);
  const code = details.code?.toLowerCase() ?? "";
  return (
    details.status === 401 ||
    details.status === 403 ||
    details.status === 429 ||
    code === "missing_permission" ||
    /limit|quota/.test(code)
  );
}

async function verifiedOwnerEmail(ctx: ActionCtx): Promise<string | undefined> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return undefined;
  return (
    (await ctx.runQuery(internal.inbox.getVerifiedUserEmail, { userId })) ?? undefined
  );
}

function ownerUsername(ownerId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < ownerId.length; index++) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `jamanyo-${(hash >>> 0).toString(16)}`;
}

function normalizedEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function demoInboxConfiguration(): { inboxId: string; email: string } | undefined {
  const inboxId = env.AUTH_EMAIL_INBOX_ID?.trim();
  const from = env.AUTH_EMAIL_FROM;
  const addressInBrackets = from?.match(/<([^<>]+)>/)?.[1];
  const email = normalizedEmail(addressInBrackets ?? from);
  return inboxId && email ? { inboxId, email } : undefined;
}

function isDemoOwner(ownerEmail: string): boolean {
  const allowedEmail = normalizedEmail(env.JAMANYO_DEMO_EMAIL);
  return Boolean(allowedEmail && ownerEmail === allowedEmail);
}

function demoAccessIsAllowed(inbox: Pick<InboxMapping, "access" | "ownerEmail">): boolean {
  return inbox.access !== "demo" || isDemoOwner(inbox.ownerEmail ?? "");
}

function privateInboxProvisioningIsEnabled(): boolean {
  return env.JAMANYO_PRIVATE_INBOXES_ENABLED?.trim().toLowerCase() === "true";
}

async function findInboxByUsername(client: AgentMailClient, username: string) {
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await client.inboxes.list({ limit: 100, pageToken });
    const found = (result.inboxes ?? []).find(
      (item) => String(item.email ?? "").split("@")[0] === username,
    );
    if (found) return found;
    if (!result.nextPageToken) return undefined;
    pageToken = result.nextPageToken;
  }
  return undefined;
}

async function registerWebhook(
  client: AgentMailClient,
  inboxId: string,
): Promise<{ webhookId?: string; webhookSecret?: string }> {
  // Each customer inbox keeps its own signing secret. An app-wide webhook can
  // coexist during a migration, but must never prevent this inbox from having
  // a delivery path of its own.
  const siteUrl = env.CONVEX_SITE_URL;
  if (!siteUrl) throw new Error("Convex site URL is required for AgentMail webhooks");
  const url = `${siteUrl}/webhooks/agentmail`;
  const existing = await client.inboxes.webhooks.list(inboxId);
  const alreadyRegistered = (existing.webhooks ?? []).find((webhook) => webhook.url === url);
  if (alreadyRegistered) {
    const webhook = alreadyRegistered.secret
      ? alreadyRegistered
      : await client.inboxes.webhooks.get(inboxId, alreadyRegistered.webhookId);
    if (!webhook.secret) throw new Error("AgentMail webhook did not return a signing secret");
    return {
      webhookId: String(webhook.webhookId),
      webhookSecret: String(webhook.secret),
    };
  }
  const created = await client.inboxes.webhooks.create(inboxId, {
    url,
    eventTypes: ["message.received"],
  });
  return {
    webhookId: String(created.webhookId),
    webhookSecret: String(created.secret),
  };
}

async function ensureInboxForOwnerImpl(
  ctx: ActionCtx,
  ownerId: string,
  ownerEmail?: string,
): Promise<{ inboxId: string; email: string; access: "private" }> {
  let existing: InboxMapping | null = await ctx.runQuery(internal.inbox.getByOwner, {
    ownerId,
  });
  if (existing?.access === "demo") {
    await ctx.runMutation(internal.inbox.disableDemoInboxForOwner, { ownerId });
    existing = null;
  }
  if (existing?.status === "active") {
    const mappings = await ctx.runQuery(internal.inbox.getByInbox, {
      inboxId: existing.inboxId,
    });
    if (mappings.length === 1 && mappings[0].ownerId === ownerId) {
      const client = getClient();
      const webhook = !existing.webhookSecret
        ? await registerWebhook(client, existing.inboxId)
        : undefined;
      if (webhook || (ownerEmail && ownerEmail !== existing.ownerEmail)) {
        await ctx.runMutation(internal.inbox.save, {
          ownerId,
          ownerEmail,
          inboxId: existing.inboxId,
          email: existing.email,
          access: "private",
          webhookId: webhook?.webhookId ?? existing.webhookId,
          webhookSecret: webhook?.webhookSecret ?? existing.webhookSecret,
        });
      }
      return { inboxId: existing.inboxId, email: existing.email, access: "private" };
    }

    // Never reuse a legacy shared mapping. Disable it locally, then create or
    // recover this owner's deterministic private inbox below.
    await ctx.runMutation(internal.inbox.disableAmbiguousInboxForOwner, {
      ownerId,
    });
  }

  if (!ownerEmail) {
    throw new Error("A verified account email is required before creating an agent inbox");
  }

  // Only an explicit user request can reach the provider. This avoids an
  // accidental dashboard visit creating a billable, shared-looking inbox.
  await ctx.runMutation(internal.rateLimit.consumeInboxProvision, { ownerId });

  const username = ownerUsername(ownerId);
  let inboxId = "";
  let email = "";
  const client = getClient();

  try {
    const created = await client.inboxes.create({
      username,
      displayName: "Jamanyo agent",
    });
    inboxId = String(created.inboxId);
    email = String(created.email);
  } catch (error: unknown) {
    const details = agentMailErrorDetails(error);
    const isConflict = details.status === 409 || details.name === "ConflictError";
    if (isConflict) {
      const found = await findInboxByUsername(client, username);
      if (!found) {
        throw new Error("We couldn't recover this private agent inbox. Please try again.");
      }
      inboxId = String(found.inboxId);
      email = String(found.email);
    } else {
      console.error(
        "AgentMail private inbox creation failed",
        JSON.stringify(details),
      );
      throw error;
    }
  }

  const webhook = await registerWebhook(client, inboxId);
  await ctx.runMutation(internal.inbox.save, {
    ownerId,
    ownerEmail,
    inboxId,
    email,
    access: "private",
    webhookId: webhook.webhookId,
    webhookSecret: webhook.webhookSecret,
  });
  return { inboxId, email, access: "private" };
}

async function ensureDemoInboxForOwner(
  ctx: ActionCtx,
  ownerId: string,
  ownerEmail: string,
): Promise<{ inboxId: string; email: string; access: "demo" | "private" }> {
  const configuredDemoInbox = demoInboxConfiguration();
  if (!configuredDemoInbox) {
    throw new Error("The demo email inbox is not configured");
  }

  const existing: InboxMapping | null = await ctx.runQuery(internal.inbox.getByOwner, {
    ownerId,
  });
  if (existing?.status === "active" && existing.access !== "demo") {
    return {
      inboxId: existing.inboxId,
      email: existing.email,
      access: "private",
    };
  }
  if (
    existing?.status === "active" &&
    existing.access === "demo" &&
    existing.inboxId === configuredDemoInbox.inboxId
  ) {
    const client = getClient();
    const webhook = !existing.webhookSecret
      ? await registerWebhook(client, existing.inboxId)
      : undefined;
    if (webhook) {
      await ctx.runMutation(internal.inbox.save, {
        ownerId,
        ownerEmail,
        inboxId: existing.inboxId,
        email: existing.email,
        access: "demo",
        webhookId: webhook.webhookId,
        webhookSecret: webhook.webhookSecret,
      });
    }
    return { inboxId: existing.inboxId, email: existing.email, access: "demo" };
  }

  const mappings: InboxMapping[] = await ctx.runQuery(internal.inbox.getByInbox, {
    inboxId: configuredDemoInbox.inboxId,
  });
  const previousDemoMapping = mappings.find((mapping) => mapping.ownerId !== ownerId);
  if (previousDemoMapping) {
    // Convex Auth identities can be rebuilt during controlled development.
    // The one demo address may move only to a new account that proves the
    // very same configured, verified email. Private inboxes and every other
    // address stay strictly one-owner-one-inbox.
    if (
      previousDemoMapping.access === "demo" &&
      normalizedEmail(previousDemoMapping.ownerEmail) === ownerEmail &&
      isDemoOwner(ownerEmail)
    ) {
      await ctx.runMutation(internal.inbox.reclaimDemoInboxForOwner, {
        previousOwnerId: previousDemoMapping.ownerId,
        ownerId,
        ownerEmail,
        inboxId: configuredDemoInbox.inboxId,
        email: configuredDemoInbox.email,
      });
      return {
        inboxId: configuredDemoInbox.inboxId,
        email: configuredDemoInbox.email,
        access: "demo",
      };
    }
    throw new Error("The demo email inbox is already assigned");
  }

  const client = getClient();
  const webhook = await registerWebhook(client, configuredDemoInbox.inboxId);
  await ctx.runMutation(internal.inbox.save, {
    ownerId,
    ownerEmail,
    inboxId: configuredDemoInbox.inboxId,
    email: configuredDemoInbox.email,
    access: "demo",
    webhookId: webhook.webhookId,
    webhookSecret: webhook.webhookSecret,
  });
  return {
    inboxId: configuredDemoInbox.inboxId,
    email: configuredDemoInbox.email,
    access: "demo",
  };
}

export const getOrCreateInbox = action({
  args: { confirmed: v.literal(true) },
  returns: inboxSetupResult,
  handler: async (ctx): Promise<InboxSetupResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const ownerEmail = await verifiedOwnerEmail(ctx);
    if (!ownerEmail) {
      return {
        kind: "verification_required" as const,
        message: "Confirm your account email first, then you can set up your agent inbox.",
      };
    }

    if (isDemoOwner(ownerEmail)) {
      try {
        const inbox = await ensureDemoInboxForOwner(
          ctx,
          identity.tokenIdentifier,
          ownerEmail,
        );
        return { kind: "ready", ...inbox };
      } catch (error: unknown) {
        console.error(
          "Jamanyo demo inbox setup failed",
          JSON.stringify(agentMailErrorDetails(error)),
        );
        return {
          kind: "retry" as const,
          message:
            "The Jamanyo email demo is being prepared. Your dashboard is ready in the meantime—please try again shortly.",
        };
      }
    }

    const existing: InboxMapping | null = await ctx.runQuery(internal.inbox.getByOwner, {
      ownerId: identity.tokenIdentifier,
    });
    if (existing?.access === "demo") {
      await ctx.runMutation(internal.inbox.disableDemoInboxForOwner, {
        ownerId: identity.tokenIdentifier,
      });
    } else if (existing?.status === "active") {
      return {
        kind: "ready" as const,
        inboxId: existing.inboxId,
        email: existing.email,
        access: "private" as const,
      };
    }

    if (!privateInboxProvisioningIsEnabled()) {
      return {
        kind: "waitlist" as const,
        message:
          "Private agent inboxes are opening in stages. Your dashboard works today; join the waitlist to reserve email access when it opens.",
      };
    }

    try {
      const inbox = await ensureInboxForOwnerImpl(
        ctx,
        identity.tokenIdentifier,
        ownerEmail,
      );
      return { kind: "ready", ...inbox };
    } catch (error: unknown) {
      if (privateInboxProvisioningIsUnavailable(error)) {
        return {
          kind: "waitlist" as const,
          message:
            "Private agent inboxes are opening in stages. Your dashboard works today; join the waitlist to reserve email access when it opens.",
        };
      }
      return {
        kind: "retry" as const,
        message:
          "We couldn’t finish email setup just now. Your dashboard is ready; please try again shortly.",
      };
    }
  },
});

export const listInboxes = action({
  args: {},
  returns: v.array(inboxResult),
  handler: async (ctx): Promise<Array<{ inboxId: string; email: string }>> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const inbox = await ctx.runQuery(
      internal.inbox.getByOwner,
      {
        ownerId: identity.tokenIdentifier,
      },
    );
    if (!inbox || inbox.status !== "active" || !demoAccessIsAllowed(inbox)) return [];
    const mappings = await ctx.runQuery(internal.inbox.getByInbox, {
      inboxId: inbox.inboxId,
    });
    return mappings.length === 1 && mappings[0].ownerId === identity.tokenIdentifier
      ? [{ inboxId: inbox.inboxId, email: inbox.email }]
      : [];
  },
});

export const sendEmail = internalAction({
  args: {
    ownerId: v.string(),
    inboxId: v.string(),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    idempotencyKey: v.string(),
  },
  returns: messageResult,
  handler: async (ctx, args) => {
    const inboxes: Array<{
      ownerId: string;
      ownerEmail?: string;
      access?: "private" | "demo";
      status: "active" | "disabled";
    }> = await ctx.runQuery(
      internal.inbox.getByInbox,
      {
      inboxId: args.inboxId,
      },
    );
    if (
      inboxes.length !== 1 ||
      inboxes[0].ownerId !== args.ownerId ||
      inboxes[0].status !== "active" ||
      !demoAccessIsAllowed(inboxes[0])
    )
      throw new Error("Inbox is not owned by this user");

    const client = getClient();
    const response = await client.inboxes.messages.send(
      args.inboxId,
      {
        to: args.to,
        subject: args.subject,
        text: args.text,
      },
      { idempotencyKey: toAgentMailIdempotencyKey(args.idempotencyKey) },
    );
    return {
      messageId: String(response.messageId),
      threadId: String(response.threadId),
    };
  },
});

export const replyToMessage = internalAction({
  args: {
    ownerId: v.string(),
    inboxId: v.string(),
    messageId: v.string(),
    text: v.string(),
    idempotencyKey: v.string(),
  },
  returns: messageResult,
  handler: async (ctx, args) => {
    const inboxes: Array<{
      ownerId: string;
      ownerEmail?: string;
      access?: "private" | "demo";
      status: "active" | "disabled";
    }> = await ctx.runQuery(
      internal.inbox.getByInbox,
      {
      inboxId: args.inboxId,
      },
    );
    if (
      inboxes.length !== 1 ||
      inboxes[0].ownerId !== args.ownerId ||
      inboxes[0].status !== "active" ||
      !demoAccessIsAllowed(inboxes[0])
    )
      throw new Error("Inbox is not owned by this user");

    const client = getClient();
    const response = await client.inboxes.messages.reply(
      args.inboxId,
      args.messageId,
      { text: args.text },
      { idempotencyKey: toAgentMailIdempotencyKey(args.idempotencyKey) },
    );
    return {
      messageId: String(response.messageId),
      threadId: String(response.threadId),
    };
  },
});

export const fetchMessage = internalAction({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
  },
  returns: v.object({
    text: v.string(),
    subject: v.string(),
    from: v.string(),
    to: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const inboxes: Array<{
      ownerEmail?: string;
      access?: "private" | "demo";
      status: "active" | "disabled";
    }> = await ctx.runQuery(
      internal.inbox.getByInbox,
      { inboxId: args.inboxId },
    );
    if (
      inboxes.length !== 1 ||
      inboxes[0].status !== "active" ||
      !demoAccessIsAllowed(inboxes[0])
    ) {
      throw new Error("Inbox is not available");
    }
    const client = getClient();
    const message = await client.inboxes.messages.get(args.inboxId, args.messageId);
    return {
      text: message.extractedText ?? message.text ?? message.html ?? "",
      subject: message.subject ?? "",
      from: String(message.from ?? ""),
      to: Array.isArray(message.to)
        ? message.to.map((address) => String(address))
        : [String(message.to ?? "")],
    };
  },
});
