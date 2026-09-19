(# Build prompt for the AI builder — Jamanyo (revision 4, final)

Paste everything below the line into your coding agent in the same repo
that currently holds the Proxy build. This is revision 4 — the buildable
version, with every gap from revisions 1–3 closed.

---

## Step 0 — Verify ground truth before writing anything

`hackathon.md` is a prior session's build log. Several entries describe
features as "built and verified" that do not exist in committed code.
Before trusting anything it claims, read the actual files and confirm:

| File | Expected reality | If different, flag before building |
|---|---|---|
| `convex/schema.ts` | 6 tables: `businesses`, `workers`, `shifts`, `responses`, `magicTokens`, `events`. No `tenants`, `users`, `riskFlags`, `localEvents`. | If tables exist that shouldn't, note before deleting. |
| `convex/convex.config.ts` | `defineApp({ env: {...} })` only. No `app.use(...)` for any component. | If rate-limiter or auth is already mounted, adjust. |
| `convex/firecrawl.ts` | 3 actions: `scrape`, `search`, `crawl`. | If `map` or `interact` already exist, skip adding them. |
| `convex/llm.ts` | Uses `openai@^7.8.0`, `chat.completions.create`, pointed at NVIDIA NIM (`https://integrate.api.nvidia.com/v1`). | If `responses.create` is used, skip the SDK rewrite. |
| `convex/mail.ts` | `getOrCreateInbox` falls back to `listInboxes()[0]` on 403. `sendEmail` and `listMessages` are public actions. Webhook auth is shared-secret header. | If AgentMail webhook uses real HMAC, skip the rewrite. |
| `package.json` | `@convex-dev/auth` and `@convex-dev/rate-limiter` are deps but not imported anywhere. | If either is already mounted, skip the install. |

---

## What we're building — Jamanyo

A two-directional "hunt" agent for scarce, verifiable goods:

- **Floor mode** (`direction: "above"`) — screen IN only what clears a
  numeric threshold. Rare cars, authenticated collectibles.
- **Ceiling mode** (`direction: "below"`) — screen for what's UNDER a
  numeric budget. Salvage/flip finds.
- **Match mode** (`direction: "match"`) — a non-numeric condition (e.g.
  "is a reservation available that meets these criteria?"). No price.

Same loop for all: **Hunt** (Firecrawl) → **Verify** (OpenAI Structured
Outputs) → **Notify + act** (Convex writes the match live; AgentMail
handles outreach; webhook closes the reply loop). Pass/fail is always a
server-side Convex query condition.

Production build. No seed data required — zero hunts and zero matches is
the primary state.

---

## Data model (single source of truth, no duplication)

```ts
hunts: defineTable({
  // ownerId is Convex Auth's tokenIdentifier (a string), NOT an Id<"users">.
  // Convex Auth stores users in its own table; we don't hand-roll one.
  // We store the tokenIdentifier string here so we can query by_owner.
  ownerId: v.string(),
  category: v.union(
    v.literal("hypercar"),
    v.literal("watch"),
    v.literal("reservation"),
    v.literal("salvage_flip"),
  ),
  direction: v.union(v.literal("above"), v.literal("below"), v.literal("match")),
  threshold: v.optional(v.number()),  // required iff direction != "match"; undefined for "match"
  spec: v.object({
    // Category-specific descriptive fields only. NO price/threshold here —
    // that lives on the hunt. The top-level `category` is the single
    // source of truth; spec does NOT repeat it. Validation in createHunt
    // enforces that spec fields are valid for the given category.
    make: v.optional(v.string()),               // hypercar, watch, salvage_flip
    minYear: v.optional(v.number()),            // hypercar
    brand: v.optional(v.string()),              // watch
    venueName: v.optional(v.string()),           // reservation
    city: v.optional(v.string()),               // reservation
    dateRangeStart: v.optional(v.number()),     // reservation
    dateRangeEnd: v.optional(v.number()),       // reservation
    partySize: v.optional(v.number()),          // reservation
    salvageOnly: v.optional(v.boolean()),       // salvage_flip
  }),
  // inboxId is optional — set when inbox creation succeeds. If
  // AgentMail inbox_create is blocked (the likely v1 case), this stays
  // null and outreach uses the shared inbox via a fallback in mail.ts.
  inboxId: v.optional(v.string()),
  inboxEmail: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
  createdAt: v.number(),
}).index("by_owner", ["ownerId"]),

candidates: defineTable({
  huntId: v.id("hunts"),
  sourceUrl: v.string(),
  rawContent: v.string(),
  verification: v.object({
    passed: v.boolean(),               // the actual pass/fail — mirrors clearsThreshold
    confidence: v.number(),
    flags: v.array(v.string()),        // e.g. ["price_discrepancy", "no_service_history"]
    // contactEmail is a STRING, not null. If no email is found, the
    // verify action returns "" (empty string), not null. This avoids
    // the v.optional(v.string()) vs null type mismatch that revision 5
    // would have caused. Empty string passes through cleanly and the
    // UI treats "" as "no email found."
    contactEmail: v.string(),          // extracted during verification, "" if absent
    extractedValue: v.optional(v.number()),  // "above"/"below" only; absent for "match"
    matchDetail: v.optional(v.string()),     // "match" only
  }),
  clearsThreshold: v.boolean(),       // = verification.passed, stored as its own indexed column
  discoveredAt: v.number(),
  fetchedFrom: v.union(
    v.literal("search"),
    v.literal("scrape"),
    v.literal("crawl"),
    v.literal("interact"),
  ),
}).index("by_hunt_cleared", ["huntId", "clearsThreshold"])
  .index("by_hunt_sourceUrl", ["huntId", "sourceUrl"]),  // dedupe

outreach: defineTable({
  huntId: v.id("hunts"),
  candidateId: v.id("candidates"),
  subject: v.string(),               // contains [hunt:<id>:candidate:<id>] plus a human subject line
  draftBody: v.string(),
  recipientEmail: v.optional(v.string()),       // from verification.contactEmail, or user-entered
  recipientEmailSource: v.optional(v.union(
    v.literal("scraped"), v.literal("manual")
  )),
  inboxId: v.optional(v.string()),   // resolved at send time if null (falls back to shared inbox)
  sentAt: v.optional(v.number()),
  threadId: v.optional(v.string()),
  status: v.union(
    v.literal("drafted"),
    v.literal("sending"),
    v.literal("sent"),
    v.literal("replied"),
    v.literal("closed"),
  ),
}).index("by_hunt", ["huntId"])
  .index("by_candidate", ["candidateId"]),
```

The existing `events` table stays as-is (`table`, `rowId: v.string()`,
`action`, `summary`, `timestamp`). Add `events.forHunt` (mirrors
`events.forShift`, filtering `table: "hunts"`). Do **not** attempt a
`v.union` retype on the events table — it likely doesn't compile on this
Convex version (Step 0). Accept the string-cast pattern already in use
(`repliesQueries.approveCandidate` line 64 does the same thing).

---

## Convex functions — complete, all defined

### `hunts.ts` (queries + mutations, V8 runtime)

```ts
export const createHunt = mutation({
  args: {
    category: v.union(/* 4 literals */),
    direction: v.union(v.literal("above"), v.literal("below"), v.literal("match")),
    threshold: v.optional(v.number()),
    spec: v.object({ /* all optional fields above */ }),
  },
  handler: async (ctx, args) => {
    const identity = ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Enforce threshold/direction consistency the type system can't.
    if (args.direction === "match" && args.threshold !== undefined)
      throw new Error("direction=match cannot have a threshold");
    if (args.direction !== "match" && args.threshold === undefined)
      throw new Error("direction=above|below requires a numeric threshold");

    // Verify spec fields are valid for this category (runtime check).
    if (!validateSpec(args.spec, args.category))
      throw new Error(`Invalid spec fields for category ${args.category}`);

    // Attach shared inbox if available (see AgentMail section).
    // inboxId is optional on the schema — null is acceptable for v1.
    const inbox = await ctx.runAction(api.mail.getOrCreateInbox, {
      username: `jamanyo-${Date.now().toString(36)}`,
      displayName: `Jamanyo: ${args.category}`,
    }).catch((e) => {
      // inbox_create blocked — log and continue without an inbox.
      console.warn("Inbox creation failed, using shared inbox:", e.message);
      return { inboxId: undefined, email: undefined };
    });

    const huntId = await ctx.db.insert("hunts", {
      ownerId: identity.tokenIdentifier,
      category: args.category,
      direction: args.direction,
      threshold: args.threshold,
      spec: args.spec,
      inboxId: inbox?.inboxId,
      inboxEmail: inbox?.email,
      status: "active",
      createdAt: Date.now(),
    });

    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "hunts", rowId: huntId as string,
      action: "hunt_created",
      summary: `Created ${args.direction} hunt for ${args.category}`,
    });
    return huntId;
  },
});

export const listForUser = query({
  args: {},  // NO ownerId argument — derived from auth context.
  handler: async (ctx) => {
    const identity = ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.db
      .query("hunts")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.tokenIdentifier))
      .order("desc")
      .take(50);
  },
});

export const listCleared = query({
  args: { huntId: v.id("hunts") },
  handler: async (ctx, args) => {
    const identity = ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) throw new Error("Hunt not found");
    if (hunt.ownerId !== identity.tokenIdentifier) throw new Error("Not authorized");
    // clearsThreshold is a real indexed column — this IS the floor/ceiling
    // enforcement, server-side, not a frontend filter.
    return await ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) =>
        q.eq("huntId", args.huntId).eq("clearsThreshold", true))
      .order("desc")
      .take(50);
  },
});

// Internal — called by runHunt (an action, which can't read the DB).
// Returns ALL fields the action needs, including inboxId.
export const getByIdInternal = internalQuery({
  args: { huntId: v.id("hunts") },
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) return null;
    return {
      _id: hunt._id,
      ownerId: hunt.ownerId,
      category: hunt.category,
      direction: hunt.direction,
      threshold: hunt.threshold,
      spec: hunt.spec,
      inboxId: hunt.inboxId,     // <-- included so sendOutreach can use it
      inboxEmail: hunt.inboxEmail,
    };
  },
});

// Internal — called by the cron wrapper.
export const listActiveInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("hunts")
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(50);  // bounded — Convex guideline says never return all
  },
});
```

### `verify.ts` (action, Node runtime)

```ts
const VERIFICATION_PROMPTS: Record<string, string> = {
  hypercar: "You verify whether this listing is a real hypercar for sale above a price threshold...",
  watch: "You verify whether this is a genuine luxury watch listing...",
  reservation: "You verify whether this reservation opportunity matches the requested criteria...",
  salvage_title_flip: "You verify whether this is a salvage-title vehicle below the budget...",
};

// Note: contactEmail is returned as a string (empty when not found), NOT null.
// This matches the schema's v.string() and avoids the null-vs-undefined
// mismatch.
export const verifyCandidate = action({
  args: {
    category: v.string(),
    direction: v.string(),
    threshold: v.optional(v.number()),
    spec: v.object({ make: v.optional(v.string()), /* ...all spec fields... */ }),
    rawContent: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const prompt = VERIFICATION_PROMPTS[args.category];
    if (!prompt) throw new Error(`No verification prompt for category ${args.category}`);

    // Structured Outputs — json_schema response_format.
    // Confirm in Step 0: does the NVIDIA NIM endpoint support this?
    // If not, switch to official OpenAI endpoint (needs OpenAI key).
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL ?? "gpt-4o-2024-08-06",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "verification_result",
          schema: {
            type: "object",
            properties: {
              passed: { type: "boolean" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              flags: { type: "array", items: { type: "string" } },
              contactEmail: { type: "string" },       // "" when not found — NOT null
              extractedValue: { type: ["number", "null"] },
              matchDetail: { type: ["string", "null"] },
            },
            required: ["passed", "confidence", "flags", "contactEmail"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Content:\n${args.rawContent.slice(0, 4000)}\n\nDirection: ${args.direction}\nThreshold: ${args.threshold ?? "N/A"}\nSource: ${args.sourceUrl}`,
        },
      ],
    });

    // With Structured Outputs, content IS the parsed object. No safeJsonParse.
    // If schema validation fails, the API throws — surface it visibly.
    return JSON.parse(response.choices[0].message.content ?? "{}");
  },
});
```

### `candidates.ts` (internal mutation + query)

```ts
export const insertVerified = internalMutation({
  args: {
    huntId: v.id("hunts"),
    sourceUrl: v.string(),
    rawContent: v.string(),
    verification: v.object({
      passed: v.boolean(),
      confidence: v.number(),
      flags: v.array(v.string()),
      contactEmail: v.string(),
      extractedValue: v.optional(v.number()),
      matchDetail: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) {
    // Dedupe by (huntId, sourceUrl) — same pattern as Proxy's
    // responses table (by_shiftId_sourceUrl).
    const existing = await ctx.db
      .query("candidates")
      .withIndex("by_hunt_sourceUrl", (q) =>
        q.eq("huntId", args.huntId).eq("sourceUrl", args.sourceUrl))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { verification: args.verification, clearsThreshold: args.verification.passed });
      return existing._id;
    }
    const id = await ctx.db.insert("candidates", {
      huntId: args.huntId,
      sourceUrl: args.sourceUrl,
      rawContent: args.rawContent,
      verification: args.verification,
      clearsThreshold: args.verification.passed,  // computed at WRITE time
      discoveredAt: Date.now(),
      fetchedFrom: "search",
    });
    return id;
  },
});
```

### `hunt.ts` (action) — the run loop

```ts
export const runHunt = action({
  args: { huntId: v.id("hunts") },
  handler: async (ctx, args) => {
    // Actions can't read the DB — fetch the hunt first via internal query.
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: args.huntId,
    }) as HuntDoc | null;
    if (!hunt) return;

    await logActivity(ctx, args.huntId, "hunt_started",
      `${hunt.direction} hunt for ${hunt.category}`);

    const results = await ctx.runAction(api.firecrawl.search, {
      query: buildSearchQuery(hunt),
      limit: 20,
    });
    await logActivity(ctx, args.huntId, "source_checked",
      `Firecrawl returned ${results.length} results`);

    for (const result of results) {
      await logActivity(ctx, args.huntId, "candidate_found", result.url);

      // Rate limit per-candidate, not once before the loop.
      await ctx.runMutation(internal.rateLimit.consumeOpenai, { ownerId: hunt.ownerId });

      const verification = await ctx.runAction(api.verify.verifyCandidate, {
        category: hunt.category,
        direction: hunt.direction,
        threshold: hunt.threshold,
        spec: hunt.spec,
        rawContent: result.description ?? result.title ?? "",
        sourceUrl: result.url,
      });
      await logActivity(ctx, args.huntId, "verification_run",
        `passed=${verification.passed} confidence=${verification.confidence}`);

      try {
        const candidateId = await ctx.runMutation(internal.candidates.insertVerified, {
          huntId: args.huntId,
          sourceUrl: result.url,
          rawContent: result.description ?? result.title ?? "",
          verification,
        });

        if (verification.passed) {
          await logActivity(ctx, args.huntId, "candidate_cleared",
            `Match found: ${result.url}`);
          // Draft outreach for cleared matches.
          await ctx.runAction(api.outreach.draftOutreach, {
            huntId: args.huntId,
            candidateId,
            contactEmail: verification.contactEmail,
            sourceUrl: result.url,
            draftBody: await draftOutreachBody(ctx, hunt, verification, result),
          });
        }
      } catch (e) {
        // Log the insert failure separately — do NOT retry verification.
        await logActivity(ctx, args.huntId, "candidate_insert_failed",
          `Failed to insert ${result.url}: ${(e as Error).message}`);
        continue;
      }
    }

    await logActivity(ctx, args.huntId, "hunt_completed",
      `Processed ${results.length} candidates`);
  },
});

// Internal — called by the cron wrapper. Runs all active hunts.
// Uses Promise.allSettled so one slow/failing hunt doesn't block others.
// Caveat: parallel hunts for the SAME owner will share the per-owner
// rate-limit bucket — the rate limiter will reject the excess calls.
export const runActiveHunts = internalAction({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.runQuery(internal.hunts.listActiveInternal, {});
    const results = await Promise.allSettled(
      active.map((h) => ctx.runAction(internal.hunt.runHunt, { huntId: h._id }))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) console.error(`${failed}/${active.length} hunts failed`);
    return { processed: active.length, failed };
  },
});
```

### `outreach.ts` (mutations + query)

```ts
export const draftOutreach = action({
  args: {
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    contactEmail: v.optional(v.string()),
    sourceUrl: v.string(),
    draftBody: v.string(),  // pre-written by runHunt; or generated inline via OpenAI
  },
  handler: async (ctx, args) => {
    const subject = `[hunt:${args.huntId}:candidate:${args.candidateId}] Listing inquiry`;
    await ctx.runMutation(internal.outreachBridge.insertDraft, {
      huntId: args.huntId,
      candidateId: args.candidateId,
      subject,
      draftBody: args.draftBody,
      recipientEmail: args.contactEmail && args.contactEmail.length > 0
        ? args.contactEmail : undefined,
      recipientEmailSource: args.contactEmail && args.contactEmail.length > 0
        ? "scraped" : undefined,
    });
  },
});

export const confirmSend = mutation({
  args: { outreachId: v.id("outreach") },
  handler: async (ctx, args) => {
    const identity = ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const row = await ctx.db.get(args.outreachId);
    if (!row) throw new Error("Outreach not found");
    const hunt = await ctx.db.get(row.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    if (!row.recipientEmail || !/\S+@\S+\.\S+/.test(row.recipientEmail))
      throw new Error("A valid recipient email is required before sending");
    await ctx.db.patch(args.outreachId, { status: "sending" });
    await ctx.scheduler.runAfter(0, internal.outreachActions.sendOutreach, {
      outreachId: args.outreachId,
    });
  },
});

export const listForHunt = query({
  args: { huntId: v.id("hunts") },
  handler: async (ctx, args) => {
    const identity = ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    return await ctx.db
      .query("outreach")
      .withIndex("by_hunt", (q) => q.eq("huntId", args.huntId))
      .order("desc")
      .take(50);
  },
});
```

### `outreachActions.ts` (internal action — the actual AgentMail send)

```ts
export const sendOutreach = internalAction({
  args: { outreachId: v.id("outreach") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.outreachBridge.getById, {
      id: args.outreachId,
    }) as OutreachDoc | null;
    if (!row || row.status !== "sending") return;

    // Resolve inbox — use the hunt's inbox if set, otherwise shared.
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: row.huntId,
    }) as HuntDoc | null;
    const inboxId = row.inboxId ?? hunt?.inboxId;
    if (!inboxId) throw new Error("No inbox available for outreach");

    await ctx.runAction(api.mail.sendEmail, {
      inboxId,
      to: row.recipientEmail!,
      subject: row.subject,
      text: row.draftBody,
    });

    await ctx.runMutation(internal.outreachBridge.markSent, {
      id: args.outreachId,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "outreach", rowId: args.outreachId as string,
      action: "outreach_sent",
      summary: `Sent to ${row.recipientEmail} for candidate ${row.candidateId}`,
    });
  },
});
```

### `http.ts` — webhook with HMAC verification

```ts
http.route({
  method: "POST",
  path: "/webhooks/agentmail",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();

    // HMAC-SHA256 over (timestamp + "." + rawBody). Confirm the exact
    // header names against AgentMail's current docs — they're
    // x-agentmail-timestamp and x-agentmail-signature, but verify.
    const timestamp = request.headers.get("x-agentmail-timestamp");
    const signature = request.headers.get("x-agentmail-signature");
    if (!timestamp || !signature) return new Response("unauthorized", { status: 401 });

    const age = Math.abs(Date.now() / 1000 - parseFloat(timestamp));
    if (age > 300) return new Response("expired", { status: 401 });

    // Use Node crypto (HTTP actions run in Node runtime).
    import { createHmac, timingSafeEqual } from "crypto";
    const expected = createHmac("sha256", env.AGENTMAIL_WEBHOOK_SECRET!)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      return new Response("unauthorized", { status: 401 });

    const body = JSON.parse(rawBody);
    const subject = body.message?.subject ?? "";

    // Composite tag: [hunt:<huntId>:candidate:<candidateId>]
    const tagMatch = subject.match(
      /\[hunt:([a-z0-9_-]{1,64}):candidate:([a-z0-9_-]{1,64})\]/
    );
    if (!tagMatch) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "webhook", rowId: body.message?.messageId ?? "unknown",
        action: "unrouted_reply",
        summary: `No valid [hunt:..:candidate:..] tag in subject`,
      });
      return new Response("ignored", { status: 200 });
    }

    const [, huntIdRaw, candidateIdRaw] = tagMatch;
    // Validate both ID formats before casting — same pattern as
    // the existing shift-id validation in replies.ts:54.
    if (!/^[a-z0-9_-]{1,64}$/.test(huntIdRaw) ||
        !/^[a-z0-9_-]{1,64}$/.test(candidateIdRaw)) {
      await ctx.runMutation(internal.eventsLog.logEvent, {
        table: "webhook", rowId: body.message?.messageId ?? "unknown",
        action: "malformed_tag", summary: "ID format invalid in subject tag",
      });
      return new Response("bad tag", { status: 400 });
    }

    await ctx.runAction(internal.outreach.handleReply, {
      messageId: body.message.messageId,
      huntId: huntIdRaw as Id<"hunts">,
      candidateId: candidateIdRaw as Id<"candidates">,
      from: body.message.from,
      text: body.message.text ?? "",
      subject,
    });
    return new Response("OK", { status: 200 });
  }),
});
```

### `outreachBridge.ts` (internal helpers — mutation/query)

```ts
export const getById = internalQuery({
  args: { id: v.id("outreach") },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const insertDraft = internalMutation({
  args: {
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    subject: v.string(),
    draftBody: v.string(),
    recipientEmail: v.optional(v.string()),
    recipientEmailSource: v.optional(v.union(v.literal("scraped"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("outreach", {
      ...args,
      status: "drafted",
    });
  },
});

export const markSent = internalMutation({
  args: { id: v.id("outreach") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "sent",
      sentAt: Date.now(),
    });
  },
});
```

### `outreach.handleReply` (internal action — webhook entry point)

```ts
export const handleReply = internalAction({
  args: {
    messageId: v.string(),
    huntId: v.id("hunts"),
    candidateId: v.id("candidates"),
    from: v.string(),
    text: v.string(),
    subject: v.string(),
  },
  handler: async (ctx, args) {
    // Log the reply to events
    await ctx.runMutation(internal.eventsLog.logEvent, {
      table: "outreach", rowId: args.candidateId as string,
      action: "reply_received",
      summary: `Reply from ${args.from}: ${args.text.slice(0, 200)}`,
    });

    // Update outreach status
    const outreach = await ctx.runQuery(internal.outreachBridge.findByCandidate, {
      candidateId: args.candidateId,
    });
    if (outreach) {
      await ctx.runMutation(internal.outreachBridge.patchStatus, {
        id: outreach._id, status: "replied",
      });
    }

    // Optionally: draft a follow-up reply via OpenAI
    const draft = await ctx.runAction(api.outreach.draftFollowUp, {
      candidateId: args.candidateId,
      replyText: args.text,
    });
    // Store as a new outreach row (drafted) for user review before sending.
  },
});
```

### `crons.ts`

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("run active hunts", { minutes: 30 }, internal.hunt.runActiveHunts, {});
export default crons;
```

---

## UX — Sutherland's principles, applied

Rory Sutherland's core insight: **once you have basic functionality,
problems of reality are problems of perception.** The hunt loop's
engineering speed matters less than how the wait *feels*. Apply these
principles directly:

**1. Progress bars beat faster execution.** The existing Proxy code's
activity log already shows this — `ShiftCard` displays "Broadcasting…
Waiting for replies…" rather than a spinner. Jamanyo's empty state must
show the hunt's live activity feed (source_checked → candidate_found →
verification_run, streaming in real-time) so a 30-minute hunt feels
productive, not broken. This is the "Uber map" principle — Uber didn't
make cars faster, they made the wait less painful by showing where the
car is. The `events.forHunt` query is your progress bar.

**2. Small changes, large effects.** The match reveal animation (candidate
flipping to `clearsThreshold: true`) is the one moment worth extra craft —
Sutherland's "sweat the small stuff." A deliberate 200ms stagger on the
card fade, the status pill color shift, a subtle scale-up — these cost
nothing to engineer but signal "this is important." Don't polish the
hunt algorithm; polish the reveal.

**3. Satisficing, not maximizing.** The UI should make "claim this match"
the obvious default action, not "analyze every option." Sutherland: "humans
don't maximize; they satisfice." The match card has a prominent "Contact
seller" button (primary) and a tiny "reject / keep searching" link
(secondary). The verified match is presented as "good enough to act on,"
not "optimal."

**4. Defaults eliminate effort.** New hunts default to `status: "active"`.
The outreach draft defaults to the shared inbox. The first-run state
(defaults: no user input needed) shows the activity feed immediately —
no "create a hunt" button in the center, just a quiet "+ New hunt" in
the corner. Make the path of least resistance the path the user takes.

**5. Narrative over data.** The activity feed tells a story:
"Checking 3 sources… Found 2 candidates… Verified: 1 passed (confidence
85%)… Match found: 2018 Huracán, $215k." Not: "Firecrawl returned 20
results. 20 verifyCandidate calls completed. 1 candidate_insert."
Sutherland: "A brand is the emotional response a consumer has when they
hear the name." The activity feed is Jamanyo's brand in motion.

**6. Two emotional registers, one system.** Floor/match modes =
"serious, exclusive" (serif display, generous whitespace, muted palette,
slow motion). Ceiling mode = "hunt, game" (monospace numbers, high
information density, minimal motion). This isn't a visual skin — it's
emotional framing. Sutherland: "What they are is physics; what they mean
is psychology." The ceiling-mode "dense auction terminal" skin signals
"this is a hunt, not a museum browsing experience."

**7. Transaction utility.** Frame matches as "deals found," not
"results returned." The count at the top of the cleared list reads
"3 matches in this hunt" — not "3 verified candidates." Sutherland:
"we are often more happy with the deal we got than the actual product."
Language is the cheapest UI change with the highest emotional leverage.

**8. No fake precision.** Don't show 4-decimal confidence scores. Show
"high confidence" / "medium confidence" / "low confidence" as labels.
Sutherland: "not everything that counts can be counted." The verification
is a signal, not a guarantee — the UI should reflect that uncertainty
without drowning the user in digits.

---

## `hackathon.md` handling

Keep `Event: Convex All Gas Hackathon` exactly as-is. Add one entry at
the top:

> Code review (revision 3) found three `hackathon.md` entries
> (2026-09-02 RAG migration, 2026-09-05 riskFlags/localEvents) described
> as built and verified when they were not present in committed code.
> This pivot's log only records what is confirmed via an actual command
> run in the same session (`npx convex run`, `tsc --noEmit`,
> `npx vite build`), the same standard the accurate 2026-09-01 through
> 2026-09-04 entries held themselves to.

Replace `What it does`, `Live app`, `Components`, `Convex features`,
`AI models`, and everything under `## Log` with a fresh start for Jamanyo.
Use `/hackathon` after each meaningful chunk of progress.

---

## Process constraints

Run commands yourself; ask only for auth/login, approval, GUI-only
actions, or an unresolvable ambiguous choice. Verify every "Verified"
claim in a new log entry against the real dev deployment with an actual
command run in that session. If Step 0 reveals something unexpected, say
so and ask before improvising. Never print secrets. Confirm scope before
deploying or publishing a public URL.)
