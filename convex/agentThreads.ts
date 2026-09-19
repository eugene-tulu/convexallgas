import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

const threadRecord = v.object({
  ownerId: v.string(),
  inboxId: v.string(),
  threadId: v.string(),
  subject: v.optional(v.string()),
  huntId: v.optional(v.id("hunts")),
  lastMessageAt: v.number(),
  status: v.union(v.literal("active"), v.literal("closed")),
});

export const getByThread = internalQuery({
  args: { threadId: v.string() },
  returns: v.union(threadRecord, v.null()),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (!thread) return null;
    return {
      ownerId: thread.ownerId,
      inboxId: thread.inboxId,
      threadId: thread.threadId,
      subject: thread.subject,
      huntId: thread.huntId,
      lastMessageAt: thread.lastMessageAt,
      status: thread.status,
    };
  },
});

export const upsert = internalMutation({
  args: {
    ownerId: v.string(),
    inboxId: v.string(),
    threadId: v.string(),
    subject: v.optional(v.string()),
    huntId: v.optional(v.id("hunts")),
    lastMessageAt: v.number(),
  },
  returns: threadRecord,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        subject: args.subject ?? existing.subject,
        huntId: args.huntId ?? existing.huntId,
        lastMessageAt: args.lastMessageAt,
        status: "active",
      });
    } else {
      await ctx.db.insert("agentThreads", {
        ownerId: args.ownerId,
        inboxId: args.inboxId,
        threadId: args.threadId,
        subject: args.subject,
        huntId: args.huntId,
        lastMessageAt: args.lastMessageAt,
        status: "active",
      });
    }

    return {
      ownerId: args.ownerId,
      inboxId: args.inboxId,
      threadId: args.threadId,
      subject: args.subject,
      huntId: args.huntId,
      lastMessageAt: args.lastMessageAt,
      status: "active" as const,
    };
  },
});

export const linkHunt = internalMutation({
  args: { threadId: v.string(), huntId: v.id("hunts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (thread) await ctx.db.patch(thread._id, { huntId: args.huntId });
    return null;
  },
});

export const recordInbound = internalMutation({
  args: {
    ownerId: v.string(),
    inboxId: v.string(),
    messageId: v.string(),
    threadId: v.string(),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    text: v.string(),
    receivedAt: v.number(),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentMessages")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) return { duplicate: true };

    await ctx.db.insert("agentMessages", {
      ownerId: args.ownerId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      threadId: args.threadId,
      direction: "inbound",
      from: args.from,
      to: args.to,
      subject: args.subject,
      text: args.text.slice(0, 20000),
      receivedAt: args.receivedAt,
      processingStatus: "pending",
    });

    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (thread) {
      await ctx.db.patch(thread._id, { lastMessageAt: args.receivedAt });
    } else {
      await ctx.db.insert("agentThreads", {
        ownerId: args.ownerId,
        inboxId: args.inboxId,
        threadId: args.threadId,
        subject: args.subject,
        lastMessageAt: args.receivedAt,
        status: "active",
      });
    }

    return { duplicate: false };
  },
});

export const recordOutbound = internalMutation({
  args: {
    ownerId: v.string(),
    inboxId: v.string(),
    messageId: v.string(),
    threadId: v.string(),
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    text: v.string(),
    sentAt: v.number(),
    huntId: v.optional(v.id("hunts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentMessages")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) {
      if (args.huntId && !existing.huntId) {
        await ctx.db.patch(existing._id, { huntId: args.huntId });
      }
      return null;
    }

    await ctx.db.insert("agentMessages", {
      ownerId: args.ownerId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      threadId: args.threadId,
      direction: "outbound",
      to: args.to,
      subject: args.subject,
      text: args.text.slice(0, 20000),
      receivedAt: args.sentAt,
      processedAt: args.sentAt,
      processingStatus: "processed",
      huntId: args.huntId,
    });
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    if (thread) {
      await ctx.db.patch(thread._id, {
        lastMessageAt: args.sentAt,
        huntId: args.huntId ?? thread.huntId,
      });
    } else {
      await ctx.db.insert("agentThreads", {
        ownerId: args.ownerId,
        inboxId: args.inboxId,
        threadId: args.threadId,
        subject: args.subject,
        huntId: args.huntId,
        lastMessageAt: args.sentAt,
        status: "active",
      });
    }
    return null;
  },
});

export const markProcessed = internalMutation({
  args: {
    messageId: v.string(),
    status: v.union(v.literal("processed"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("agentMessages")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (message) {
      await ctx.db.patch(message._id, {
        processingStatus: args.status,
        processedAt: Date.now(),
      });
    }
    return null;
  },
});

// AgentMail can send a compact webhook without the message body. Record the
// event promptly, then let the background worker fetch the body and patch it
// into the short-lived operational trail before it is processed.
export const updateInboundContent = internalMutation({
  args: {
    messageId: v.string(),
    text: v.string(),
    subject: v.optional(v.string()),
    from: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("agentMessages")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!message || message.direction !== "inbound") return null;
    await ctx.db.patch(message._id, {
      text: args.text.slice(0, 20_000),
      subject: args.subject ?? message.subject,
      from: args.from ?? message.from,
    });
    return null;
  },
});

export const linkMessageHunt = internalMutation({
  args: { messageId: v.string(), huntId: v.id("hunts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db
      .query("agentMessages")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (message) await ctx.db.patch(message._id, { huntId: args.huntId });
    return null;
  },
});

export const listForUser = query({
  args: {},
  returns: v.array(threadRecord),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const threads = await ctx.db
      .query("agentThreads")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .order("desc")
      .take(50);
    return threads.map((thread) => ({
      ownerId: thread.ownerId,
      inboxId: thread.inboxId,
      threadId: thread.threadId,
      subject: thread.subject,
      huntId: thread.huntId,
      lastMessageAt: thread.lastMessageAt,
      status: thread.status,
    }));
  },
});
