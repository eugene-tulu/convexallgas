import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  candidateDispositionValidator,
  contactPolicyValidator,
  discoveryBriefValidator,
  discoveryPlanValidator,
  discoverySearchBreadthValidator,
  deliveryModeValidator,
  experienceProfileValidator,
  feedbackKindValidator,
  huntSpecValidator,
  marketValidator,
  moneyValidator,
  missionIntentValidator,
  notificationCadenceValidator,
  serendipityValidator,
  sourcePreferencesValidator,
  sourceInspectionValidator,
  sourcePlanValidator,
  urgencyValidator,
  verificationResultValidator,
} from "./market";

const monitorTarget = v.union(
  v.object({
    type: v.literal("scrape"),
    urls: v.array(v.string()),
  }),
  v.object({
    type: v.literal("crawl"),
    url: v.string(),
  }),
  v.object({
    type: v.literal("search"),
    queries: v.array(v.string()),
    includeDomains: v.optional(v.array(v.string())),
    excludeDomains: v.optional(v.array(v.string())),
    maxResults: v.optional(v.number()),
  }),
);

export default defineSchema({
  ...authTables,

  hunts: defineTable({
    ownerId: v.string(),
    category: v.union(
      v.literal("hypercar"),
      v.literal("watch"),
      v.literal("reservation"),
      v.literal("salvage_flip"),
    ),
    direction: v.union(
      v.literal("above"),
      v.literal("below"),
      v.literal("match"),
    ),
    threshold: v.optional(v.number()),
    // Legacy thresholds remain for existing hunts. New missions also retain a
    // currency-aware minor-unit budget in `money`.
    money: v.optional(moneyValidator),
    market: v.optional(marketValidator),
    timeZone: v.optional(v.string()),
    notificationCadence: v.optional(notificationCadenceValidator),
    weeklyGarageBrief: v.optional(v.boolean()),
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    serendipity: v.optional(serendipityValidator),
    experienceProfile: v.optional(experienceProfileValidator),
    contactPolicy: v.optional(contactPolicyValidator),
    urgency: v.optional(urgencyValidator),
    expiresAt: v.optional(v.number()),
    sourcePreferences: v.optional(sourcePreferencesValidator),
    missionIntent: v.optional(missionIntentValidator),
    discoveryBrief: v.optional(discoveryBriefValidator),
    discoverySearchBreadth: v.optional(discoverySearchBreadthValidator),
    discoveryPlan: v.optional(discoveryPlanValidator),
    sourcePlan: v.optional(sourcePlanValidator),
    spec: huntSpecValidator,
    inboxId: v.optional(v.string()),
    inboxEmail: v.optional(v.string()),
    mode: v.optional(
      v.union(v.literal("search"), v.literal("monitor"), v.literal("one_off")),
    ),
    sourceUrls: v.optional(v.array(v.string())),
    sourceMessageId: v.optional(v.string()),
    // Dashboard hunts can opt into the same email experience as inbox-created
    // hunts. The message/thread IDs anchor future updates in one conversation.
    notifyByEmail: v.optional(v.boolean()),
    notificationMessageId: v.optional(v.string()),
    notificationThreadId: v.optional(v.string()),
    notificationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("active"),
        v.literal("unavailable"),
        v.literal("failed"),
        v.literal("disabled"),
      ),
    ),
    cadenceMinutes: v.optional(v.number()),
    monitorId: v.optional(v.string()),
    monitorStatus: v.optional(
      v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("deleted"),
        // The provider could not be started or resumed. Keeping this distinct
        // from a user pause prevents the dashboard from claiming that a watch
        // is running when it is not.
        v.literal("needs_attention"),
      ),
    ),
    // A discovery monitor watches a market query. An auction watch tracks one
    // public listing and extracts its observable auction state on each check.
    monitorPurpose: v.optional(
      v.union(v.literal("discovery"), v.literal("auction")),
    ),
    lastRunAt: v.optional(v.number()),
    nextRunAt: v.optional(v.number()),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
      // A short-lived internal state used while the deletion worker removes
      // the mission's local trail. It is deliberately excluded from the
      // owner-facing mission list.
      v.literal("deleting"),
    ),
    createdAt: v.number(),
    briefUpdatedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_status", ["status"])
    .index("by_monitor", ["monitorId"])
    .index("by_owner_monitor_status", ["ownerId", "monitorStatus"])
    .index("by_monitor_status", ["monitorStatus"])
    .index("by_owner_sourceMessage", ["ownerId", "sourceMessageId"]),

  userPreferences: defineTable({
    ownerId: v.string(),
    currency: v.string(),
    locale: v.string(),
    timeZone: v.string(),
    countryCode: v.optional(v.string()),
    locality: v.optional(v.string()),
    radiusKm: v.optional(v.number()),
    deliveryMode: deliveryModeValidator,
    allowedCountries: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    notificationCadence: notificationCadenceValidator,
    weeklyGarageBrief: v.optional(v.boolean()),
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    serendipity: serendipityValidator,
    experienceProfile: v.optional(experienceProfileValidator),
    contactPolicy: contactPolicyValidator,
    preferredDomains: v.optional(v.array(v.string())),
    blockedDomains: v.optional(v.array(v.string())),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  candidates: defineTable({
    huntId: v.id("hunts"),
    sourceUrl: v.string(),
    // Scraped pages can include seller contact details. New candidates retain
    // only the structured verification result; this optional legacy field is
    // cleared by the retention job.
    rawContent: v.optional(v.string()),
    verification: verificationResultValidator,
    // Optional during the transition so existing candidate records remain
    // readable. New assessments always write both fields.
    disposition: v.optional(candidateDispositionValidator),
    sourceInspection: v.optional(sourceInspectionValidator),
    clearsThreshold: v.boolean(),
    discoveredAt: v.number(),
    notifiedAt: v.optional(v.number()),
    fetchedFrom: v.union(
      v.literal("search"),
      v.literal("scrape"),
      v.literal("crawl"),
      v.literal("interact"),
    ),
  })
    .index("by_hunt_cleared", ["huntId", "clearsThreshold"])
    .index("by_hunt_sourceUrl", ["huntId", "sourceUrl"])
    .index("by_discoveredAt", ["discoveredAt"]),

  huntFeedback: defineTable({
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    ownerId: v.string(),
    kind: feedbackKindValidator,
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_hunt", ["huntId"])
    .index("by_candidate", ["candidateId"]),

  outreach: defineTable({
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    subject: v.string(),
    draftBody: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientEmailSource: v.optional(
      v.union(v.literal("scraped"), v.literal("manual")),
    ),
    kind: v.optional(v.union(v.literal("initial"), v.literal("follow_up"))),
    parentOutreachId: v.optional(v.id("outreach")),
    replyToMessageId: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    inboxId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    threadId: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    lastInboundMessageId: v.optional(v.string()),
    sendAttempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    status: v.union(
      v.literal("drafted"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("replied"),
      v.literal("closed"),
    ),
  })
    .index("by_hunt", ["huntId"])
    .index("by_candidate", ["candidateId"])
    .index("by_candidate_kind", ["candidateId", "kind"])
    .index("by_parent", ["parentOutreachId"])
    .index("by_thread", ["threadId"])
    .index("by_createdAt", ["createdAt"]),

  agentInboxes: defineTable({
    ownerId: v.string(),
    ownerEmail: v.optional(v.string()),
    inboxId: v.string(),
    email: v.string(),
    // A demo mapping is an explicitly allowlisted, single-user exception to
    // the normal one-private-inbox-per-account model.
    access: v.optional(v.union(v.literal("private"), v.literal("demo"))),
    webhookId: v.optional(v.string()),
    // Inbox-scoped AgentMail webhooks have distinct Svix signing secrets. This
    // field is intentionally never returned by a public function.
    webhookSecret: v.optional(v.string()),
    createdAt: v.number(),
    status: v.union(v.literal("active"), v.literal("disabled")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_inbox", ["inboxId"])
    .index("by_owner_email", ["ownerEmail"])
    .index("by_email", ["email"]),

  // The waitlist stores only the authenticated account identifier. A verified
  // email can be resolved later if private inbox access opens; no contact
  // address is duplicated in this product table.
  inboxWaitlist: defineTable({
    ownerId: v.string(),
    joinedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  agentThreads: defineTable({
    ownerId: v.string(),
    inboxId: v.string(),
    threadId: v.string(),
    subject: v.optional(v.string()),
    huntId: v.optional(v.id("hunts")),
    lastMessageAt: v.number(),
    status: v.union(v.literal("active"), v.literal("closed")),
  })
    .index("by_thread", ["threadId"])
    .index("by_owner", ["ownerId"])
    .index("by_hunt", ["huntId"]),

  agentMessages: defineTable({
    ownerId: v.string(),
    inboxId: v.string(),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    // Message bodies are retained only for the short operational window
    // needed to process a request and reconcile delivery.
    text: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    processingStatus: v.union(
      v.literal("pending"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    huntId: v.optional(v.id("hunts")),
  })
    .index("by_message", ["messageId"])
    .index("by_thread", ["threadId"])
    .index("by_hunt", ["huntId"])
    .index("by_inbox", ["inboxId"])
    .index("by_owner_receivedAt", ["ownerId", "receivedAt"])
    .index("by_receivedAt", ["receivedAt"]),

  notificationQueue: defineTable({
    huntId: v.id("hunts"),
    ownerId: v.string(),
    text: v.string(),
    idempotencyKey: v.string(),
    coalesceKey: v.string(),
    scheduledAt: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("disabled"),
      v.literal("unavailable"),
    ),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    attempt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_hunt", ["huntId"])
    .index("by_coalesce", ["coalesceKey"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_updatedAt", ["status", "updatedAt"])
    .index("by_createdAt", ["createdAt"]),

  // A notification can be folded into a quiet-hours or daily-digest message
  // while retaining an idempotency record for every source event.
  notificationKeys: defineTable({
    idempotencyKey: v.string(),
    notificationId: v.id("notificationQueue"),
    createdAt: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_notification", ["notificationId"])
    .index("by_createdAt", ["createdAt"]),

  // One durable marker per vehicle mission and local Monday. It prevents a
  // recurring Garage Brief from being duplicated when cron work overlaps or
  // retries, while the brief's live content remains derived from candidates.
  garageBriefs: defineTable({
    huntId: v.id("hunts"),
    ownerId: v.string(),
    weekKey: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("delivery_queued"),
      v.literal("disabled"),
      v.literal("unavailable"),
    ),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  }).index("by_hunt_week", ["huntId", "weekKey"]),

  webhookEvents: defineTable({
    provider: v.union(v.literal("agentmail"), v.literal("firecrawl")),
    eventId: v.string(),
    status: v.union(
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed"),
    ),
    receivedAt: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_provider_event", ["provider", "eventId"])
    .index("by_receivedAt", ["receivedAt"]),

  // A compact, redacted operational ledger. It is deliberately separate from
  // the user-facing mission record so retries and delivery failures do not
  // make the main product data hot or expose provider error details.
  operationalIssues: defineTable({
    ownerId: v.optional(v.string()),
    huntId: v.optional(v.id("hunts")),
    source: v.union(
      v.literal("agentmail"),
      v.literal("firecrawl"),
      v.literal("hunt"),
      v.literal("notification"),
      v.literal("privacy"),
    ),
    severity: v.union(v.literal("warning"), v.literal("error")),
    // This is an internal, opaque idempotency key. It is never returned to a
    // browser and must not contain email text, addresses, or provider errors.
    fingerprint: v.string(),
    summary: v.string(),
    count: v.number(),
    active: v.boolean(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_active_lastSeenAt", ["ownerId", "active", "lastSeenAt"])
    .index("by_active_lastSeenAt", ["active", "lastSeenAt"]),

  // An erasure request clears Jamanyo-owned product data in small, durable
  // batches. The separate sign-in account remains so a user can return later
  // without us reaching into Auth component tables with undocumented writes.
  dataErasureRequests: defineTable({
    ownerId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("complete"),
      v.literal("needs_attention"),
    ),
    requestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // A private in-product support route. It intentionally stores no copied
  // contact address; the authenticated account is enough for an operator to
  // locate the report in the Convex dashboard.
  supportRequests: defineTable({
    ownerId: v.string(),
    topic: v.union(v.literal("privacy"), v.literal("product")),
    message: v.string(),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  }).index("by_owner_createdAt", ["ownerId", "createdAt"]),

  huntRuns: defineTable({
    huntId: v.id("hunts"),
    ownerId: v.string(),
    trigger: v.union(
      v.literal("manual"),
      v.literal("scheduled"),
      v.literal("email"),
      v.literal("monitor"),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    idempotencyKey: v.string(),
    scheduledAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    attempt: v.number(),
    error: v.optional(v.string()),
    candidatesFound: v.optional(v.number()),
    cleared: v.optional(v.number()),
  })
    .index("by_hunt_status", ["huntId", "status"])
    .index("by_status_scheduled", ["status", "scheduledAt"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_finishedAt", ["finishedAt"]),

  monitorChecks: defineTable({
    huntId: v.id("hunts"),
    ownerId: v.string(),
    monitorId: v.string(),
    checkId: v.string(),
    status: v.string(),
    changed: v.number(),
    added: v.number(),
    removed: v.number(),
    errors: v.number(),
    changedUrls: v.array(v.string()),
    diffJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_check", ["checkId"])
    .index("by_monitor", ["monitorId"])
    .index("by_hunt", ["huntId"])
    .index("by_createdAt", ["createdAt"]),

  // This deliberately stores only structured, observable auction facts. It is
  // not a valuation, inspection, or a prediction of whether a bidder should
  // buy the vehicle.
  auctionWatches: defineTable({
    huntId: v.id("hunts"),
    ownerId: v.string(),
    sourceUrl: v.string(),
    monitorId: v.optional(v.string()),
    title: v.optional(v.string()),
    currentBidMinor: v.optional(v.number()),
    askingPriceMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    endsAt: v.optional(v.number()),
    listingState: v.union(
      v.literal("live"),
      v.literal("ending"),
      v.literal("sold"),
      v.literal("withdrawn"),
      v.literal("closed"),
      v.literal("unknown"),
    ),
    reserveStatus: v.union(
      v.literal("met"),
      v.literal("not_met"),
      v.literal("not_applicable"),
      v.literal("unknown"),
    ),
    availability: v.union(
      v.literal("available"),
      v.literal("unavailable"),
      v.literal("unknown"),
    ),
    evidence: v.optional(v.string()),
    lastCheckId: v.optional(v.string()),
    lastObservedAt: v.number(),
    lastMeaningfulChangeAt: v.optional(v.number()),
    nextAlertAt: v.optional(v.number()),
    notifiedMilestones: v.array(v.string()),
  })
    .index("by_hunt", ["huntId"])
    .index("by_owner", ["ownerId"])
    .index("by_nextAlertAt", ["nextAlertAt"]),

  events: defineTable({
    ownerId: v.optional(v.string()),
    table: v.string(),
    rowId: v.string(),
    action: v.string(),
    summary: v.string(),
    timestamp: v.number(),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_table_rowId", ["table", "rowId"])
    .index("by_owner_timestamp", ["ownerId", "timestamp"]),
});
