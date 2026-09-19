import { v } from "convex/values";
import { env, internalMutation, internalQuery, mutation, query } from "./_generated/server";

const inboxAccessValidator = v.union(v.literal("private"), v.literal("demo"));

function normalizedEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function demoAccessIsAllowed(ownerEmail: string | undefined): boolean {
  const allowedEmail = normalizedEmail(env.JAMANYO_DEMO_EMAIL);
  return Boolean(allowedEmail && normalizedEmail(ownerEmail) === allowedEmail);
}

const inboxRecord = v.object({
  ownerId: v.string(),
  ownerEmail: v.optional(v.string()),
  inboxId: v.string(),
  email: v.string(),
  access: v.optional(inboxAccessValidator),
  webhookConnected: v.boolean(),
  status: v.union(v.literal("active"), v.literal("disabled")),
});

const privateInboxRecord = v.object({
  ownerId: v.string(),
  ownerEmail: v.optional(v.string()),
  inboxId: v.string(),
  email: v.string(),
  access: v.optional(inboxAccessValidator),
  webhookId: v.optional(v.string()),
  webhookSecret: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("disabled")),
});

export const getForUser = query({
  args: {},
  returns: v.union(inboxRecord, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const inbox = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .first();
    if (!inbox || inbox.status !== "active") return null;
    if (inbox.access === "demo" && !demoAccessIsAllowed(inbox.ownerEmail)) {
      return null;
    }
    const mappings = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", inbox.inboxId))
      .take(2);
    if (mappings.length !== 1 || mappings[0].ownerId !== identity.tokenIdentifier) {
      return null;
    }
    return {
      ownerId: inbox.ownerId,
      ownerEmail: inbox.ownerEmail,
      inboxId: inbox.inboxId,
      email: inbox.email,
      access: inbox.access,
      webhookConnected: Boolean(inbox.webhookSecret),
      status: inbox.status,
    };
  },
});

export const getWaitlistStatus = query({
  args: {},
  returns: v.object({ joined: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const entry = await ctx.db
      .query("inboxWaitlist")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .first();
    return { joined: Boolean(entry) };
  },
});

export const joinWaitlist = mutation({
  args: {},
  returns: v.object({ joined: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("inboxWaitlist")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .first();
    if (!existing) {
      await ctx.db.insert("inboxWaitlist", {
        ownerId: identity.tokenIdentifier,
        joinedAt: Date.now(),
      });
    }
    return { joined: true };
  },
});

export const getByOwner = internalQuery({
  args: { ownerId: v.string() },
  returns: v.union(privateInboxRecord, v.null()),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();
    if (!inbox) return null;
    return {
      ownerId: inbox.ownerId,
      ownerEmail: inbox.ownerEmail,
      inboxId: inbox.inboxId,
      email: inbox.email,
      access: inbox.access,
      webhookId: inbox.webhookId,
      webhookSecret: inbox.webhookSecret,
      status: inbox.status,
    };
  },
});

export const getVerifiedUserEmail = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.emailVerificationTime === undefined || !user.email) return null;
    const email = user.email.trim().toLowerCase();
    return email || null;
  },
});

export const getByInbox = internalQuery({
  args: { inboxId: v.string() },
  returns: v.array(privateInboxRecord),
  handler: async (ctx, args) => {
    const inboxes = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
      .take(2);
    return inboxes.map((inbox) => ({
      ownerId: inbox.ownerId,
      ownerEmail: inbox.ownerEmail,
      inboxId: inbox.inboxId,
      email: inbox.email,
      access: inbox.access,
      webhookId: inbox.webhookId,
      webhookSecret: inbox.webhookSecret,
      status: inbox.status,
    }));
  },
});

export const getByOwnerEmail = internalQuery({
  args: { ownerEmail: v.string() },
  returns: v.union(privateInboxRecord, v.null()),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner_email", (q) => q.eq("ownerEmail", args.ownerEmail))
      .first();
    if (!inbox) return null;
    return {
      ownerId: inbox.ownerId,
      ownerEmail: inbox.ownerEmail,
      inboxId: inbox.inboxId,
      email: inbox.email,
      access: inbox.access,
      webhookId: inbox.webhookId,
      webhookSecret: inbox.webhookSecret,
      status: inbox.status,
    };
  },
});

export const getByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.array(privateInboxRecord),
  handler: async (ctx, args) => {
    const inboxes = await ctx.db
      .query("agentInboxes")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .take(2);
    return inboxes.map((inbox) => ({
      ownerId: inbox.ownerId,
      ownerEmail: inbox.ownerEmail,
      inboxId: inbox.inboxId,
      email: inbox.email,
      access: inbox.access,
      webhookId: inbox.webhookId,
      webhookSecret: inbox.webhookSecret,
      status: inbox.status,
    }));
  },
});

export const getWebhookSecret = internalQuery({
  args: { inboxId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const inboxes = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
      .take(2);
    // Legacy shared-inbox records are intentionally treated as ambiguous.
    // A webhook must map to exactly one active owner before it can be trusted.
    if (inboxes.length !== 1 || inboxes[0].status !== "active") return null;
    return inboxes[0].webhookSecret ?? null;
  },
});

export const save = internalMutation({
  args: {
    ownerId: v.string(),
    ownerEmail: v.optional(v.string()),
    inboxId: v.string(),
    email: v.string(),
    access: v.optional(inboxAccessValidator),
    webhookId: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),
  },
  returns: privateInboxRecord,
  handler: async (ctx, args) => {
    const mappings = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
      .take(20);
    if (mappings.some((mapping) => mapping.ownerId !== args.ownerId)) {
      throw new Error("This agent inbox is already assigned to another user");
    }
    const existing = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerEmail: args.ownerEmail ?? existing.ownerEmail,
        inboxId: args.inboxId,
        email: args.email,
        access: args.access ?? existing.access,
        ...(args.webhookId ? { webhookId: args.webhookId } : {}),
        ...(args.webhookSecret ? { webhookSecret: args.webhookSecret } : {}),
        status: "active",
      });
    } else {
      await ctx.db.insert("agentInboxes", {
        ownerId: args.ownerId,
        ownerEmail: args.ownerEmail,
        inboxId: args.inboxId,
        email: args.email,
        access: args.access,
        webhookId: args.webhookId,
        webhookSecret: args.webhookSecret,
        createdAt: Date.now(),
        status: "active",
      });
    }

    return {
      ownerId: args.ownerId,
      ownerEmail: args.ownerEmail,
      inboxId: args.inboxId,
      email: args.email,
      access: args.access ?? existing?.access,
      webhookId: args.webhookId ?? existing?.webhookId,
      webhookSecret: args.webhookSecret ?? existing?.webhookSecret,
      status: "active" as const,
    };
  },
});

export const disableDemoInboxForOwner = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();
    if (inbox?.access === "demo" && inbox.status !== "disabled") {
      await ctx.db.patch(inbox._id, { status: "disabled" });
    }
    return null;
  },
});

// A development demo can survive an auth-account reset only when the new
// account proves the exact same allowlisted email. Reuse the one physical
// inbox record rather than creating a duplicate mapping, which would make
// inbound webhook ownership ambiguous.
export const reclaimDemoInboxForOwner = internalMutation({
  args: {
    previousOwnerId: v.string(),
    ownerId: v.string(),
    ownerEmail: v.string(),
    inboxId: v.string(),
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingForNewOwner = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();
    if (existingForNewOwner) {
      throw new Error("The current account already has an agent inbox mapping");
    }

    const mappings = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
      .take(2);
    const stale = mappings[0];
    if (
      mappings.length !== 1 ||
      !stale ||
      stale.ownerId !== args.previousOwnerId ||
      stale.access !== "demo" ||
      normalizedEmail(stale.ownerEmail) !== normalizedEmail(args.ownerEmail)
    ) {
      throw new Error("The previous demo inbox mapping cannot be reclaimed");
    }

    await ctx.db.patch(stale._id, {
      ownerId: args.ownerId,
      ownerEmail: normalizedEmail(args.ownerEmail),
      email: args.email,
      status: "active",
    });
    return null;
  },
});

// When an old shared inbox is discovered, disable every mapping to that
// physical inbox before moving anyone to a private one. Otherwise, after the
// first migration, the last remaining legacy mapping could look unique and
// begin receiving messages that belonged to the former shared inbox.
export const disableAmbiguousInboxForOwner = internalMutation({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const inbox = await ctx.db
      .query("agentInboxes")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .first();
    if (!inbox) return null;

    const mappings = await ctx.db
      .query("agentInboxes")
      .withIndex("by_inbox", (q) => q.eq("inboxId", inbox.inboxId))
      .take(100);
    for (const mapping of mappings) {
      if (mapping.status !== "disabled") {
        await ctx.db.patch(mapping._id, { status: "disabled" });
      }
    }
    return null;
  },
});
