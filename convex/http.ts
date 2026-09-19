import { httpAction } from "./_generated/server";
import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { env } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";

const http = httpRouter();

type PrivateInbox = {
  ownerId: string;
  ownerEmail?: string;
  inboxId: string;
  email: string;
  access?: "private" | "demo";
  webhookId?: string;
  webhookSecret?: string;
  status: "active" | "disabled";
};

// Convex Auth owns its own HTTP endpoints; keep them registered alongside the
// integration webhooks below so the dashboard's password flow can sign in.
auth.addHttpRoutes(http);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function addressValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const addressInBrackets = value.match(/<([^<>]+)>/)?.[1];
    const normalized = (addressInBrackets ?? value).trim().toLowerCase();
    return normalized || undefined;
  }
  if (Array.isArray(value)) return addressValue(value[0]);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return addressValue(item.email ?? item.address ?? item.value);
  }
  return undefined;
}

function demoAccessIsAllowed(inbox: PrivateInbox): boolean {
  if (inbox.access !== "demo") return true;
  const allowedEmail = addressValue(env.JAMANYO_DEMO_EMAIL);
  return Boolean(allowedEmail && inbox.ownerEmail === allowedEmail);
}

function bodyMessage(body: Record<string, unknown>): Record<string, unknown> {
  return record(body.message ?? body.data ?? body);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const source = base64ToBytes(value);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyAgentMailSignature(
  request: Request,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signatures = request.headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) return false;
  if (Math.abs(Date.now() / 1000 - parsedTimestamp) > 300) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(secret.replace(/^whsec_/, "")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
      ),
    );
    return signatures.split(" ").some((entry) => {
      const [version, signature] = entry.split(",", 2);
      return (
        version === "v1" &&
        signature !== undefined &&
        constantTimeEqual(expected, base64ToBytes(signature))
      );
    });
  } catch {
    return false;
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[a-fA-F0-9]+$/.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function verifyFirecrawlSignature(
  request: Request,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const supplied = request.headers.get("x-firecrawl-signature");
  if (!supplied) return false;
  const rawSignature = supplied.replace(/^sha256=/i, "").trim();
  const received = hexToBytes(rawSignature);
  if (!received) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
    );
    return constantTimeEqual(expected, received);
  } catch {
    return false;
  }
}

http.route({
  path: "/webhooks/agentmail",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    const body = record(parsed);
    const eventType = stringValue(body.event_type) ?? stringValue(body.eventType);
    if (eventType !== "message.received") {
      return new Response(null, { status: 204 });
    }
    const message = bodyMessage(body);
    const messageId =
      stringValue(message.messageId) ??
      stringValue(message.message_id) ??
      stringValue(body.event_id) ??
      stringValue(body.eventId) ??
      (await sha256(rawBody));
    const inboxId =
      stringValue(message.inboxId) ??
      stringValue(message.inbox_id) ??
      stringValue(body.inboxId) ??
      stringValue(body.inbox_id);
    const inboxWebhookSecret = inboxId
      ? await ctx.runQuery(internal.inbox.getWebhookSecret, { inboxId })
      : null;
    // Prefer each inbox's stored secret, but keep a valid app-wide webhook
    // working while an installation migrates to private inbox subscriptions.
    const webhookSecrets = [inboxWebhookSecret, env.AGENTMAIL_WEBHOOK_SECRET]
      .filter((secret): secret is string => Boolean(secret));
    if (webhookSecrets.length === 0)
      return new Response("unknown webhook", { status: 202 });
    let signatureMatches = false;
    for (const webhookSecret of webhookSecrets) {
      if (await verifyAgentMailSignature(request, rawBody, webhookSecret)) {
        signatureMatches = true;
        break;
      }
    }
    if (!signatureMatches)
      return new Response("invalid signature", { status: 401 });

    let from = addressValue(message.from ?? message.from_) ?? "";
    const to = addressValue(message.to);
    let subject = stringValue(message.subject) ?? "";
    let text =
      stringValue(message.extractedText) ??
      stringValue(message.extracted_text) ??
      stringValue(message.text) ??
      stringValue(message.extractedHtml) ??
      stringValue(message.extracted_html) ??
      stringValue(message.html) ??
      "";
    const threadId =
      stringValue(message.threadId) ??
      stringValue(message.thread_id) ??
      messageId;
    const eventId =
      stringValue(body.event_id) ??
      stringValue(body.eventId) ??
      request.headers.get("svix-id") ??
      messageId;

    let inboxes: PrivateInbox[] = inboxId
      ? await ctx.runQuery(internal.inbox.getByInbox, { inboxId })
      : [];
    if (inboxes.length === 0 && to) {
      inboxes = await ctx.runQuery(internal.inbox.getByEmail, { email: to });
    }
    // A physical AgentMail inbox is private to one Jamanyo account. Refuse
    // every duplicate mapping (including disabled legacy rows) rather than
    // guessing which account owns an inbound message.
    if (
      inboxes.length !== 1 ||
      inboxes[0].status !== "active" ||
      !demoAccessIsAllowed(inboxes[0])
    ) {
      return new Response("ambiguous inbox", { status: 202 });
    }
    const activeInboxes = inboxes;
    const outreach = await ctx.runQuery(internal.outreachBridge.findByThread, {
      threadId,
    });
    // This is the inbound authorization boundary, including the controlled
    // demo mapping: only the verified owner email may create or manage a
    // mission. A different sender is accepted only as a reply to that owner's
    // already-approved outreach thread.
    const ownerInbox = activeInboxes.find(
      (item) => Boolean(item.ownerEmail) && item.ownerEmail === from,
    );
    const outreachInbox = outreach
      ? activeInboxes.find(
          (item) =>
            item.inboxId === (outreach.inboxId ?? inboxId) &&
            item.ownerId === outreach.ownerId,
        )
      : undefined;
    const inbox = ownerInbox ?? outreachInbox;
    const isOwnerRequest = Boolean(inbox?.ownerEmail && inbox.ownerEmail === from);
    const isOutreachReply = Boolean(
      outreach &&
        outreachInbox &&
        inbox?.ownerId === outreachInbox.ownerId &&
        from !== inbox.ownerEmail,
    );
    if (!inbox || (!isOwnerRequest && !isOutreachReply)) {
      return new Response("unrecognized sender", { status: 202 });
    }

    const claimed = await ctx.runMutation(internal.webhookEvents.claim, {
      provider: "agentmail",
      eventId,
    });
    if (!claimed) return new Response("already processed", { status: 200 });

    try {
      await ctx.runMutation(internal.agentThreads.recordInbound, {
        ownerId: inbox.ownerId,
        inboxId: inbox.inboxId,
        messageId,
        threadId,
        from,
        to,
        subject,
        text,
        receivedAt: Date.now(),
      });
      // AgentMail's delivery path gets an acknowledgement once the verified
      // event is durable. Fetching omitted content, LLM classification, web
      // work, and any reply run in a retryable worker instead of holding this
      // provider request open.
      await ctx.scheduler.runAfter(0, internal.inboundActions.processAgentMailWebhook, {
        ownerId: inbox.ownerId,
        ownerEmail: inbox.ownerEmail,
        inboxId: inbox.inboxId,
        messageId,
        threadId,
        from,
        to,
        subject,
        text,
        eventId,
        isOutreachReply,
        attempt: 1,
      });
      return new Response("accepted", { status: 202 });
    } catch {
      await ctx.runMutation(internal.webhookEvents.fail, {
        provider: "agentmail",
        eventId,
        error: "AgentMail webhook intake could not be scheduled",
      });
      await ctx.runMutation(internal.operationalIssues.report, {
        ownerId: inbox.ownerId,
        source: "agentmail",
        severity: "error",
        fingerprint: `agentmail-intake:${eventId}`,
        summary:
          "A recent email request could not be queued. Your mission history is saved.",
      });
      return new Response("processing failed", { status: 500 });
    }
  }),
});

http.route({
  path: "/webhooks/firecrawl",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const secret = env.FIRECRAWL_WEBHOOK_SECRET;
    if (!secret || !(await verifyFirecrawlSignature(request, rawBody, secret)))
      return new Response("invalid signature", { status: 401 });
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    const body = record(parsed);
    const data = record(body.data);
    const metadata = record(body.metadata ?? data.metadata);
    const monitorId =
      stringValue(body.monitorId) ??
      stringValue(body.monitor_id) ??
      stringValue(data.monitorId) ??
      stringValue(data.monitor_id);
    const checkId =
      stringValue(body.checkId) ??
      stringValue(body.check_id) ??
      stringValue(data.checkId) ??
      stringValue(data.check_id);
    const huntId =
      stringValue(metadata.huntId) ??
      stringValue(metadata.hunt_id) ??
      stringValue(body.huntId);
    const eventId =
      checkId ?? stringValue(body.eventId) ?? stringValue(body.id) ?? (await sha256(rawBody));
    if (!monitorId || !checkId || !huntId)
      return new Response("missing monitor metadata", { status: 400 });

    const claimed = await ctx.runMutation(internal.webhookEvents.claim, {
      provider: "firecrawl",
      eventId,
    });
    if (!claimed) return new Response("already processed", { status: 200 });

    await ctx.scheduler.runAfter(0, internal.firecrawl.processWebhookCheck, {
        huntId: huntId as Id<"hunts">,
        monitorId,
        checkId,
        eventId,
        attempt: 1,
      });
    return new Response("accepted", { status: 202 });
  }),
});

// Register the static catch-all only after the application-owned HTTP routes,
// so auth and signed integration webhooks keep their root-level paths.
registerStaticRoutes(http, components.staticHosting);

export default http;
