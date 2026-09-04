import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const parsedAvailability = v.object({
  available: v.boolean(),
  constraints: v.string(),
  confidence: v.number(),
  reasons: v.string(),
});

export default defineSchema({
  businesses: defineTable({
    name: v.string(),
    category: v.string(),
    hoursJson: v.optional(v.string()),
    sizeSignal: v.optional(v.string()),
    location: v.string(),
    sourceUrl: v.optional(v.string()),
    ownerUserId: v.optional(v.id("users")),
    inboxId: v.string(),
    inboxEmail: v.string(),
    createdAt: v.number(),
  }).index("by_inboxId", ["inboxId"]),

  users: defineTable({
    name: v.string(),
    email: v.string(),
  }).index("by_email", ["email"]),

  workers: defineTable({
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    contact: v.string(),
    roles: v.array(v.string()),
    location: v.optional(v.string()),
    consent: v.boolean(),
    consentedAt: v.optional(v.number()),
    reliabilityScore: v.number(),
    credentialCheck: v.optional(v.string()),
  })
    .index("by_businessId_consent", ["businessId", "consent"])
    .index("by_contact", ["contact"]),

  shifts: defineTable({
    businessId: v.id("businesses"),
    role: v.string(),
    startTime: v.number(),
    urgency: v.union(
      v.literal("critical"),
      v.literal("urgent"),
      v.literal("normal"),
      v.literal("low")
    ),
    status: v.union(
      v.literal("broadcasting"),
      v.literal("shortlist_ready"),
      v.literal("escalating"),
      v.literal("confirmed"),
      v.literal("cancelled")
    ),
    timeoutAt: v.number(),
    displayRate: v.number(),
    displayRateLabel: v.string(),
    broadcastAt: v.optional(v.number()),
    broadcastRound: v.number(),
    confirmedAt: v.optional(v.number()),
    confirmedByResponseId: v.optional(v.id("responses")),
    parentShiftId: v.optional(v.id("shifts")),
  })
    .index("by_businessId_status", ["businessId", "status"])
    .index("by_timeoutAt_status", ["timeoutAt", "status"]),

  responses: defineTable({
    shiftId: v.id("shifts"),
    workerId: v.optional(v.id("workers")),
    externalCandidateRef: v.optional(v.string()),
    externalSourceUrl: v.optional(v.string()),
    rawReplyText: v.string(),
    parsedAvailability: v.optional(parsedAvailability),
    rankScore: v.optional(v.number()),
    source: v.union(v.literal("internal"), v.literal("external")),
    receivedAt: v.number(),
    agentmailMessageId: v.string(),
  })
    .index("by_shiftId", ["shiftId"])
    .index("by_shiftId_receivedAt", ["shiftId", "receivedAt"]),

  backupPool: defineTable({
    location: v.string(),
    role: v.string(),
    candidateContact: v.string(),
    candidateName: v.optional(v.string()),
    sourceUrl: v.string(),
    crawledAt: v.number(),
  }).index("by_location_role_crawledAt", ["location", "role", "crawledAt"]),

  magicTokens: defineTable({
    token: v.string(),
    shiftId: v.id("shifts"),
    workerId: v.optional(v.id("workers")),
    email: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_email", ["email"]),

  events: defineTable({
    table: v.string(),
    rowId: v.string(),
    action: v.string(),
    timestamp: v.number(),
    summary: v.string(),
  })
    .index("by_table_rowId", ["table", "rowId"])
    .index("by_timestamp", ["timestamp"]),
});
