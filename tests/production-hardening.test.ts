import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { toAgentMailIdempotencyKey } from "../convex/agentmailIdempotency";
import { fallbackDiscoveryLanes } from "../convex/discovery";
import { prepareInboundIntent } from "../convex/inboundActions";
import { DEFAULT_DISCOVERY_EXCLUDED_DOMAINS } from "../convex/market";
import { buildFallbackVehicleListingQuery } from "../convex/searchQueries";
import {
  buildVehicleSourceQuery,
  profileForUrl,
  selectVehicleSourceProfiles,
  sourceContextForUrl,
} from "../convex/sourceRegistry";
import { sourceClearlySaysListingClosed } from "../convex/listingEvidence";
import {
  canStartDashboardEmailThread,
  dashboardNotificationBody,
  dashboardNotificationSubject,
  type HuntDoc,
} from "../convex/hunt";

const modules = import.meta.glob("../convex/**/*.ts");

function testBackend() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function createDashboardHunt(
  t: ReturnType<typeof testBackend>,
  tokenIdentifier: string,
  email: string,
) {
  return await t.withIdentity({ tokenIdentifier, email }).mutation(api.hunts.createHunt, {
    category: "hypercar",
    direction: "match",
    spec: { make: "BMW E46 M3" },
    mode: "search",
    notifyByEmail: false,
  });
}

describe("production hardening", () => {
  it("selects a small car-source portfolio and keeps source price semantics explicit", () => {
    expect(selectVehicleSourceProfiles(undefined).map((profile) => profile.id)).toEqual([
      "classic",
      "bring_a_trailer",
      "hemmings",
    ]);
    expect(
      selectVehicleSourceProfiles({ includeDomains: ["classic.com"] }).map(
        (profile) => profile.id,
      ),
    ).toEqual(["classic"]);
    expect(
      selectVehicleSourceProfiles({ excludeDomains: ["bringatrailer.com"] }).map(
        (profile) => profile.id,
      ),
    ).not.toContain("bring_a_trailer");

    const classic = profileForUrl("https://www.classic.com/veh/example/");
    const bat = profileForUrl("https://bringatrailer.com/listing/example/");
    expect(sourceContextForUrl(classic, "https://www.classic.com/veh/example/")).toMatchObject({
      resultRole: "specific_listing",
      expectedPriceType: "asking_price",
    });
    expect(sourceContextForUrl(bat, "https://bringatrailer.com/listing/example/")).toMatchObject({
      resultRole: "specific_listing",
      expectedPriceType: "current_bid",
    });
    expect(
      buildVehicleSourceQuery(
        bat!,
        { make: "BMW", model: "M3", generation: "E46", transmission: "manual" },
      ),
    ).toBe("bmw m3 e46 manual live auction");
  });

  it("never treats a source-declared closed auction as a live opportunity", () => {
    expect(
      sourceClearlySaysListingClosed(
        "2006 BMW M3 Coupe - closed on July 22, 2026",
        "The auction closed after bidding reached $35,750.",
      ),
    ).toBe(true);
    expect(
      sourceClearlySaysListingClosed(
        "2006 BMW M3 Coupe 6-Speed",
        "Current bid is $35,750 and bidding remains open.",
      ),
    ).toBe(false);
  });

  it("uses a short, listing-first fallback when an exact vehicle search returns nothing", () => {
    const query = buildFallbackVehicleListingQuery(
      {
        make: "Mazda",
        model: "MX-5 Miata",
        transmission: "manual",
        bodyStyle: "either",
      },
      { locality: "", countryCode: "" },
    );

    expect(query).toBe("mazda mx 5 miata manual for sale");
    expect(query).not.toContain("asking price");
    expect(query).not.toContain("newly listed");
  });

  it("keeps a repeatedly user-inaccessible marketplace out of default discovery", () => {
    expect(DEFAULT_DISCOVERY_EXCLUDED_DOMAINS).toContain("cargurus.com");
  });

  it("encodes semantic AgentMail idempotency keys without collisions", () => {
    const encoded = toAgentMailIdempotencyKey("outreach:listing_1");

    expect(encoded).toMatch(/^[A-Za-z0-9._~-]+$/);
    expect(encoded).toBe(toAgentMailIdempotencyKey("outreach:listing_1"));
    expect(encoded).not.toBe(toAgentMailIdempotencyKey("outreach_3a_listing_1"));
    expect(encoded).toBe("outreach_3a_listing__1");
    expect(toAgentMailIdempotencyKey("")).toBe("_empty_");
  });

  it("makes the first dashboard email a mission-specific status update", () => {
    const pausedAuction = {
      category: "hypercar",
      spec: { make: "BMW", model: "M3" },
      mode: "monitor",
      monitorPurpose: "auction",
      status: "paused",
    } as HuntDoc;

    expect(dashboardNotificationSubject(pausedAuction)).toBe(
      "Jamanyo update: BMW M3 Auction Watch",
    );
    expect(dashboardNotificationBody(pausedAuction)).toContain(
      "Your BMW M3 Auction Watch is now connected",
    );
    expect(dashboardNotificationBody(pausedAuction)).toContain("It is paused right now");
    expect(canStartDashboardEmailThread(pausedAuction)).toBe(true);
    expect(canStartDashboardEmailThread({ ...pausedAuction, status: "archived" })).toBe(false);
    expect(canStartDashboardEmailThread({ ...pausedAuction, status: "deleting" })).toBe(false);
  });

  it("uses only a verified account email for private inbox ownership", async () => {
    const t = testBackend();
    const [unverifiedUserId, verifiedUserId] = await t.run(async (ctx) => {
      const unverified = await ctx.db.insert("users", { email: "unverified@example.com" });
      const verified = await ctx.db.insert("users", {
        email: "Verified@Example.com",
        emailVerificationTime: 1,
      });
      return [unverified, verified];
    });

    await expect(
      t.query(internal.inbox.getVerifiedUserEmail, { userId: unverifiedUserId }),
    ).resolves.toBeNull();
    await expect(
      t.query(internal.inbox.getVerifiedUserEmail, { userId: verifiedUserId }),
    ).resolves.toBe("verified@example.com");
  });

  it("reports email connection state without exposing a webhook secret", async () => {
    const t = testBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentInboxes", {
        ownerId: "user-a",
        ownerEmail: "a@example.com",
        inboxId: "inbox-a",
        email: "agent@example.com",
        access: "private",
        webhookSecret: "secret-that-must-stay-private",
        createdAt: 1,
        status: "active",
      });
      await ctx.db.insert("agentInboxes", {
        ownerId: "user-b",
        ownerEmail: "b@example.com",
        inboxId: "inbox-b",
        email: "agent-b@example.com",
        access: "private",
        createdAt: 1,
        status: "active",
      });
    });

    const inbox = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .query(api.inbox.getForUser, {});

    expect(inbox).toMatchObject({ webhookConnected: true });
    expect(inbox).not.toHaveProperty("webhookSecret");
    await expect(
      t
        .withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" })
        .query(api.inbox.getForUser, {}),
    ).resolves.toMatchObject({ webhookConnected: false });
  });

  it("returns authorized activity records with their Convex system fields", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });

    const huntEvents = await owner.query(api.events.forHunt, { huntId });
    expect(huntEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: expect.any(String),
          _creationTime: expect.any(Number),
          ownerId: "user-a",
          rowId: huntId,
          action: "hunt_created",
        }),
      ]),
    );

    const recentEvents = await owner.query(api.events.recent, { limit: 10 });
    expect(recentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: expect.any(String),
          _creationTime: expect.any(Number),
          rowId: huntId,
        }),
      ]),
    );
  });

  it("keeps listing data owner-scoped and excludes raw scraped text", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");

    await t.run(async (ctx) => {
      await ctx.db.insert("candidates", {
        huntId,
        sourceUrl: "https://example.com/listing",
        rawContent: "Legacy listing text with seller@example.com",
        verification: {
          passed: true,
          confidence: 0.91,
          flags: [],
          contactEmail: "seller@example.com",
          listingTitle: "2003 BMW M3",
          listingImageUrl: "https://images.example.com/e46-m3.jpg",
        },
        clearsThreshold: true,
        discoveredAt: Date.now(),
        fetchedFrom: "search",
      });
    });

    const ownerCandidates = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .query(api.candidates.listByHunt, { huntId });
    expect(ownerCandidates).toHaveLength(1);
    expect(ownerCandidates[0]).not.toHaveProperty("rawContent");
    expect(ownerCandidates[0]?.verification).toMatchObject({
      listingTitle: "2003 BMW M3",
      listingImageUrl: "https://images.example.com/e46-m3.jpg",
    });
    await expect(
      t
        .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
        .query(api.hunts.listCleared, { huntId }),
    ).resolves.toEqual([]);

    await expect(
      t
        .withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" })
        .query(api.candidates.listByHunt, { huntId }),
    ).rejects.toThrow("Not authorized");
  });

  it("keeps a vehicle mission's structured brief for the dashboard and email scout", async () => {
    const t = testBackend();
    const huntId = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .mutation(api.hunts.createHunt, {
        category: "hypercar",
        direction: "match",
        spec: {
          make: "BMW",
          model: "M3",
          generation: "E46",
          variant: "CSL",
          minYear: 2003,
          maxYear: 2004,
          bodyStyle: "coupe",
          originality: "original",
        },
        mode: "search",
        notifyByEmail: false,
      });

    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt?.spec).toMatchObject({
      make: "BMW",
      model: "M3",
      generation: "E46",
      variant: "CSL",
      minYear: 2003,
      maxYear: 2004,
      bodyStyle: "coupe",
      originality: "original",
    });
  });

  it("lets a newer enthusiast start from a human car brief instead of taxonomy", async () => {
    const t = testBackend();
    const huntId = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .mutation(api.hunts.createHunt, {
        category: "hypercar",
        direction: "below",
        threshold: 35_000,
        spec: {},
        mode: "search",
        notifyByEmail: false,
        missionIntent: "guided",
        discoveryBrief: {
          prompt: "A small, analogue car for weekend escapes that I can learn to maintain.",
          vibes: ["weekend_escape", "hands_on_project"],
          ownershipAppetite: "learn_as_i_go",
        },
      });

    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt?.missionIntent).toBe("guided");
    expect(hunt?.spec).toEqual({});
    expect(hunt?.discoveryBrief).toMatchObject({
      vibes: ["weekend_escape", "hands_on_project"],
      ownershipAppetite: "learn_as_i_go",
    });
  });

  it("turns a model-less email brief into a guided one-off mission", async () => {
    const intent = prepareInboundIntent(
      {
        action: "create_hunt",
        category: "hypercar",
        direction: "below",
        threshold: 20_000,
        currency: "USD",
        mode: "search",
        spec: { transmission: "manual", bodyStyle: "either" },
      },
      {
        subject: "Help me find my first proper weekend car",
        text:
          "I want a manual, analogue weekend car I can learn to maintain. I do not know the exact model yet.",
      },
    );

    expect(intent).toMatchObject({
      action: "create_hunt",
      category: "hypercar",
      missionIntent: "guided",
      direction: "below",
      threshold: 20_000,
      mode: "one_off",
      discoveryBrief: {
        prompt: expect.stringContaining("manual, analogue weekend car"),
      },
    });

    if (!intent?.category || !intent.direction || !intent.spec) {
      throw new Error("Expected a complete guided email intent");
    }
    const t = testBackend();
    const huntId = await t.mutation(internal.hunts.createFromEmail, {
      ownerId: "user-a",
      ownerEmail: "owner@example.com",
      inboxId: "inbox-guided",
      inboxEmail: "",
      sourceMessageId: "email-guided-brief",
      category: intent.category,
      direction: intent.direction,
      threshold: intent.threshold,
      money: { currency: "USD", amountMinor: 2_000_000, includesFees: false },
      spec: intent.spec,
      mode: intent.mode,
      monitorPurpose: intent.monitorPurpose,
      missionIntent: intent.missionIntent,
      discoveryBrief: intent.discoveryBrief,
    });

    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt).toMatchObject({
      missionIntent: "guided",
      direction: "below",
      mode: "one_off",
      discoverySearchBreadth: "starting",
      spec: { transmission: "manual", bodyStyle: "either" },
    });
  });

  it("lets a guided car brief begin without a budget or background monitoring", async () => {
    const t = testBackend();
    const huntId = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .mutation(api.hunts.createHunt, {
        category: "hypercar",
        direction: "match",
        spec: {},
        mode: "one_off",
        notifyByEmail: false,
        missionIntent: "guided",
        discoveryBrief: {
          prompt: "A small analogue weekend car that I can learn to maintain.",
          vibes: ["weekend_escape", "hands_on_project"],
          ownershipAppetite: "learn_as_i_go",
        },
      });

    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt).toMatchObject({
      missionIntent: "guided",
      direction: "match",
      mode: "one_off",
      discoverySearchBreadth: "starting",
    });
    expect(hunt?.money).toBeUndefined();
  });

  it("keeps guided-search broadening owner-scoped and explicit", async () => {
    const t = testBackend();
    const ownerA = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const ownerB = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });
    const huntId = await ownerA.mutation(api.hunts.createHunt, {
      category: "hypercar",
      direction: "match",
      spec: {},
      mode: "one_off",
      notifyByEmail: false,
      missionIntent: "guided",
      discoveryBrief: { vibes: ["first_proper_car"] },
    });

    await expect(ownerB.mutation(api.hunts.broadenGuidedDiscovery, { huntId })).rejects.toThrow(
      "Not authorized",
    );
    await expect(ownerA.mutation(api.hunts.broadenGuidedDiscovery, { huntId })).resolves.toEqual({
      breadth: "wide",
      changed: true,
    });
    await expect(ownerA.mutation(api.hunts.broadenGuidedDiscovery, { huntId })).resolves.toEqual({
      breadth: "wide",
      changed: false,
    });

    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt?.discoverySearchBreadth).toBe("wide");
  });

  it("updates an owned mission without silently running a new hunt", async () => {
    const t = testBackend();
    const ownerA = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const ownerB = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");

    await t.mutation(internal.hunts.saveDiscoveryPlan, {
      huntId,
      plan: {
        breadth: "starting",
        searchedAt: 1,
        sourceCount: 3,
        lanes: [{
          label: "Analog weekend car",
          rationale: "Original route",
          searchTerms: "BMW E46 M3",
          resultCount: 3,
          status: "sources_found",
        }],
      },
    });

    const update = {
      huntId,
      direction: "below" as const,
      threshold: 45_000,
      money: { currency: "usd", amountMinor: 4_500_000, includesFees: false },
      spec: { make: "BMW", model: "M3", generation: "E46", transmission: "manual" as const },
      mode: "search" as const,
      cadenceMinutes: 60,
      market: { countryCode: "KE", locality: "Nairobi", deliveryMode: "either" as const },
      timeZone: "UTC",
      notificationCadence: "instant" as const,
      weeklyGarageBrief: false,
      serendipity: "smart" as const,
      experienceProfile: "deal_radar" as const,
      contactPolicy: "draft_for_review" as const,
      urgency: "soon" as const,
      sourcePreferences: { excludeDomains: ["example.org"] },
    };

    await expect(ownerB.action(api.hunts.updateMission, update)).rejects.toThrow("Not authorized");
    await expect(ownerA.action(api.hunts.updateMission, update)).resolves.toEqual({
      restartedMonitor: false,
      fallbackToSearch: false,
    });

    const updated = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(updated).toMatchObject({
      direction: "below",
      threshold: 45_000,
      money: { currency: "USD", amountMinor: 4_500_000 },
      spec: { make: "BMW", generation: "E46", transmission: "manual" },
      market: { countryCode: "KE", locality: "Nairobi" },
      briefUpdatedAt: expect.any(Number),
    });
    expect(updated?.discoveryPlan).toBeUndefined();
    const runs = await t.run(async (ctx) =>
      await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) => q.eq("huntId", huntId))
        .take(5),
    );
    expect(runs).toEqual([]);
    const events = await ownerA.query(api.events.forHunt, { huntId });
    expect(events.some((event) => event.action === "hunt_updated")).toBe(true);
  });

  it("removes only the owner's mission and its local research trail", async () => {
    const t = testBackend();
    const ownerA = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const ownerB = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    const otherHuntId = await createDashboardHunt(t, "user-b", "b@example.com");
    const [candidateId, eventId] = await t.run(async (ctx) => {
      const candidate = await ctx.db.insert("candidates", {
        huntId,
        sourceUrl: "https://market.example.com/listing/e46",
        verification: {
          passed: true,
          confidence: 0.92,
          flags: [],
          contactEmail: "",
          listingKind: "specific_listing",
          listingPriceMinor: 4_000_000,
          listingCurrency: "USD",
          availability: "available",
          sellerTrust: "unknown",
        },
        clearsThreshold: true,
        discoveredAt: Date.now(),
        fetchedFrom: "search",
      });
      const event = await ctx.db.insert("events", {
        ownerId: "user-a",
        table: "hunts",
        rowId: huntId,
        action: "hunt_tested",
        summary: "Test activity",
        timestamp: Date.now(),
      });
      return [candidate, event];
    });

    await expect(ownerB.action(api.hunts.deleteMission, { huntId })).rejects.toThrow("Not authorized");
    await expect(ownerA.action(api.hunts.deleteMission, { huntId })).resolves.toEqual({
      removalStarted: true,
    });
    expect(await ownerA.query(api.hunts.listForUser, {})).toEqual([]);

    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await t.mutation(internal.hunts.deleteMissionBatch, {
        huntId,
        ownerId: "user-a",
      });
      if (result.complete) break;
    }

    expect(await t.query(internal.hunts.getByIdInternal, { huntId })).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(candidateId))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(eventId))).toBeNull();
    expect(await ownerB.query(api.hunts.listForUser, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: otherHuntId })]),
    );
  });

  it("waits for an in-flight hunt before clearing a deleting mission", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("huntRuns", {
        huntId,
        ownerId: "user-a",
        trigger: "manual",
        status: "running",
        idempotencyKey: "running-delete-test",
        scheduledAt: Date.now(),
        startedAt: Date.now(),
        attempt: 1,
      });
    });

    await t.mutation(internal.hunts.beginDeletion, { huntId, ownerId: "user-a" });
    await expect(
      t.mutation(internal.hunts.deleteMissionBatch, { huntId, ownerId: "user-a" }),
    ).resolves.toEqual({ complete: false, deleted: 0 });
    expect(await t.query(internal.hunts.getByIdInternal, { huntId })).toMatchObject({
      status: "deleting",
    });
  });

  it("does not schedule a one-off guided mission in the recurring hunt sweep", async () => {
    const t = testBackend();
    const huntId = await t
      .withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" })
      .mutation(api.hunts.createHunt, {
        category: "hypercar",
        direction: "match",
        spec: {},
        mode: "one_off",
        notifyByEmail: false,
        missionIntent: "guided",
        discoveryBrief: { vibes: ["occasion_car"] },
      });

    await expect(t.mutation(internal.huntRuns.enqueueActive, {})).resolves.toMatchObject({
      scheduled: 0,
      skipped: 1,
    });
    const runs = await t.run(async (ctx) =>
      await ctx.db
        .query("huntRuns")
        .withIndex("by_hunt_status", (q) => q.eq("huntId", huntId).eq("status", "queued"))
        .take(5),
    );
    expect(runs).toEqual([]);
  });

  it("keeps an offline discovery fallback diverse, bounded, and free of listing operators", () => {
    const lanes = fallbackDiscoveryLanes(
      {
        vibes: ["weekend_escape", "hands_on_project", "understated_fast"],
        ownershipAppetite: "learn_as_i_go",
      },
      "wide",
    );

    expect(lanes).toHaveLength(3);
    expect(new Set(lanes.map((lane) => lane.searchTerms)).size).toBe(3);
    expect(lanes.every((lane) => lane.searchTerms.length > 0 && lane.searchTerms.length <= 140)).toBe(true);
    expect(lanes.some((lane) => /for sale|site:/i.test(lane.searchTerms))).toBe(false);
  });

  it("requires a public link when a user asks for a listing check", async () => {
    const t = testBackend();
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });

    await expect(
      owner.mutation(api.hunts.createHunt, {
        category: "hypercar",
        direction: "match",
        spec: {},
        mode: "search",
        notifyByEmail: false,
        missionIntent: "listing_review",
      }),
    ).rejects.toThrow("Invalid spec fields");

    const huntId = await owner.mutation(api.hunts.createHunt, {
      category: "hypercar",
      direction: "match",
      spec: {},
      mode: "search",
      notifyByEmail: false,
      missionIntent: "listing_review",
      sourceUrls: ["https://market.example.com/listing/e46"],
    });
    const hunt = await t.query(internal.hunts.getByIdInternal, { huntId });
    expect(hunt?.missionIntent).toBe("listing_review");
    expect(hunt?.sourceUrls).toEqual(["https://market.example.com/listing/e46"]);
  });

  it("removes a user-inaccessible source from leads and keeps it demoted", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    const insertArgs = {
      huntId,
      sourceUrl: "https://market.example.com/listing/e36",
      verification: {
        passed: true,
        confidence: 0.94,
        flags: [],
        contactEmail: "",
        listingKind: "specific_listing" as const,
        listingPriceMinor: 699_500,
        listingCurrency: "USD",
        availability: "available" as const,
        sellerTrust: "unknown" as const,
      },
      disposition: "potential_lead" as const,
      sourceInspection: "inspected" as const,
      fetchedFrom: "scrape" as const,
    };
    const inserted = await t.mutation(internal.candidates.insertVerified, insertArgs);
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });

    await expect(owner.query(api.hunts.listCleared, { huntId })).resolves.toHaveLength(1);
    await expect(
      t
        .withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" })
        .mutation(api.candidates.reportSourceUnavailable, {
          candidateId: inserted.candidateId,
        }),
    ).rejects.toThrow("Not authorized");

    await owner.mutation(api.candidates.reportSourceUnavailable, {
      candidateId: inserted.candidateId,
    });
    await expect(owner.query(api.hunts.listCleared, { huntId })).resolves.toEqual([]);
    const reported = await owner.query(api.candidates.listByHunt, { huntId });
    expect(reported[0]).toMatchObject({
      clearsThreshold: false,
      disposition: "source_unavailable",
      sourceInspection: "user_reported_unavailable",
    });
    expect(reported[0]?.verification.flags).toContain("source_unavailable_to_user");

    const refreshed = await t.mutation(internal.candidates.insertVerified, insertArgs);
    expect(refreshed.shouldNotify).toBe(false);
    const afterRefresh = await owner.query(api.candidates.listByHunt, { huntId });
    expect(afterRefresh[0]).toMatchObject({
      clearsThreshold: false,
      disposition: "source_unavailable",
      sourceInspection: "user_reported_unavailable",
    });
  });

  it("fails closed when a legacy inbox mapping is ambiguous", async () => {
    const t = testBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentInboxes", {
        ownerId: "user-a",
        ownerEmail: "a@example.com",
        inboxId: "shared-inbox",
        email: "shared@example.com",
        webhookSecret: "secret-a",
        createdAt: 1,
        status: "active",
      });
      await ctx.db.insert("agentInboxes", {
        ownerId: "user-b",
        ownerEmail: "b@example.com",
        inboxId: "shared-inbox",
        email: "shared@example.com",
        webhookSecret: "secret-b",
        createdAt: 2,
        status: "active",
      });
    });

    await expect(
      t.query(internal.inbox.getWebhookSecret, { inboxId: "shared-inbox" }),
    ).resolves.toBeNull();

    // Moving one owner to a private inbox must not make the other legacy row
    // look safe by itself. The old physical inbox remains unusable.
    await t.mutation(internal.inbox.disableAmbiguousInboxForOwner, {
      ownerId: "user-a",
    });
    await t.run(async (ctx) => {
      const ownerA = await ctx.db
        .query("agentInboxes")
        .withIndex("by_owner", (q) => q.eq("ownerId", "user-a"))
        .unique();
      if (!ownerA) throw new Error("Missing test inbox");
      await ctx.db.patch(ownerA._id, {
        inboxId: "private-inbox-a",
        email: "agent-a@example.com",
        status: "active",
      });
    });
    await expect(
      t.query(internal.inbox.getWebhookSecret, { inboxId: "shared-inbox" }),
    ).resolves.toBeNull();
    await expect(
      t
        .withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" })
        .query(api.inbox.getForUser, {}),
    ).resolves.toBeNull();
  });

  it("keeps inbox waitlist requests private and idempotent", async () => {
    const t = testBackend();
    const ownerA = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const ownerB = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });

    await expect(ownerA.query(api.inbox.getWaitlistStatus, {})).resolves.toEqual({
      joined: false,
    });
    await ownerA.mutation(api.inbox.joinWaitlist, {});
    await ownerA.mutation(api.inbox.joinWaitlist, {});

    await expect(ownerA.query(api.inbox.getWaitlistStatus, {})).resolves.toEqual({
      joined: true,
    });
    await expect(ownerB.query(api.inbox.getWaitlistStatus, {})).resolves.toEqual({
      joined: false,
    });

    const entries = await t.run(async (ctx) =>
      await ctx.db
        .query("inboxWaitlist")
        .withIndex("by_owner", (q) => q.eq("ownerId", "user-a"))
        .take(2),
    );
    expect(entries).toHaveLength(1);
  });

  it("refuses to map one physical inbox to a second account", async () => {
    const t = testBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentInboxes", {
        ownerId: "user-a",
        ownerEmail: "a@example.com",
        inboxId: "demo-inbox",
        email: "demo@example.com",
        access: "demo",
        createdAt: 1,
        status: "active",
      });
    });

    await expect(
      t.mutation(internal.inbox.save, {
        ownerId: "user-b",
        ownerEmail: "b@example.com",
        inboxId: "demo-inbox",
        email: "demo@example.com",
        access: "demo",
      }),
    ).rejects.toThrow("already assigned to another user");
  });

  it("reclaims only a same-email development demo mapping after an auth reset", async () => {
    const t = testBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentInboxes", {
        ownerId: "old-auth-identity",
        ownerEmail: "demo@example.com",
        inboxId: "demo-inbox",
        email: "demo@agentmail.to",
        access: "demo",
        webhookSecret: "existing-webhook-secret",
        createdAt: 1,
        status: "active",
      });
    });

    await t.mutation(internal.inbox.reclaimDemoInboxForOwner, {
      previousOwnerId: "old-auth-identity",
      ownerId: "new-auth-identity",
      ownerEmail: "DEMO@example.com",
      inboxId: "demo-inbox",
      email: "demo@agentmail.to",
    });

    await expect(
      t.query(internal.inbox.getByOwner, { ownerId: "new-auth-identity" }),
    ).resolves.toMatchObject({
      ownerEmail: "demo@example.com",
      inboxId: "demo-inbox",
      access: "demo",
      webhookSecret: "existing-webhook-secret",
    });
    await expect(
      t.query(internal.inbox.getByOwner, { ownerId: "old-auth-identity" }),
    ).resolves.toBeNull();
  });

  it("does not reclaim a demo inbox for a different verified email", async () => {
    const t = testBackend();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentInboxes", {
        ownerId: "old-auth-identity",
        ownerEmail: "demo@example.com",
        inboxId: "demo-inbox",
        email: "demo@agentmail.to",
        access: "demo",
        createdAt: 1,
        status: "active",
      });
    });

    await expect(
      t.mutation(internal.inbox.reclaimDemoInboxForOwner, {
        previousOwnerId: "old-auth-identity",
        ownerId: "new-auth-identity",
        ownerEmail: "someone-else@example.com",
        inboxId: "demo-inbox",
        email: "demo@agentmail.to",
      }),
    ).rejects.toThrow("cannot be reclaimed");
  });

  it("retries transient queued-email failures with a durable backoff", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    const queued = await t.mutation(internal.notifications.enqueue, {
      huntId,
      ownerId: "user-a",
      text: "A potential listing match is ready.",
      idempotencyKey: "notification-1",
      coalesceKey: "quiet-1",
      scheduledAt: 0,
    });

    await t.mutation(internal.notifications.claim, {
      notificationId: queued.notificationId,
    });
    const retry = await t.mutation(internal.notifications.rescheduleAfterFailure, {
      notificationId: queued.notificationId,
      error: "provider timeout",
    });
    const stored = await t.query(internal.notifications.get, {
      notificationId: queued.notificationId,
    });

    expect(retry).toEqual({ scheduled: true, delayMs: 60_000 });
    expect(stored?.status).toBe("queued");
    expect(stored?.attempt).toBe(1);
    expect(stored?.lastError).toBe("provider timeout");
  });

  it("uses the recovery action's clock when selecting queued email updates", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    const due = await t.mutation(internal.notifications.enqueue, {
      huntId,
      ownerId: "user-a",
      text: "A potential listing match is ready.",
      idempotencyKey: "notification-due",
      coalesceKey: "quiet-due",
      scheduledAt: 1_000,
    });
    await t.mutation(internal.notifications.enqueue, {
      huntId,
      ownerId: "user-a",
      text: "A later potential listing match is ready.",
      idempotencyKey: "notification-later",
      coalesceKey: "quiet-later",
      scheduledAt: 2_000,
    });

    await expect(
      t.query(internal.notifications.listDue, { now: 1_500 }),
    ).resolves.toEqual([due.notificationId]);
  });

  it("keeps Auction Watch facts owner-scoped and alerts only for a material change", async () => {
    const t = testBackend();
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const other = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });
    const huntId = await owner.mutation(api.hunts.createHunt, {
      category: "hypercar",
      direction: "below",
      threshold: 26_000,
      money: { currency: "USD", amountMinor: 2_600_000, includesFees: false },
      spec: { make: "BMW", model: "M3", generation: "E46" },
      mode: "monitor",
      monitorPurpose: "auction",
      sourceUrls: ["https://example.com/live-auction/e46-m3"],
      notifyByEmail: false,
    });
    const observedAt = 1_800_000_000_000;
    const common = {
      huntId,
      ownerId: "user-a",
      monitorId: "monitor-a",
      sourceUrl: "https://example.com/live-auction/e46-m3",
      title: "2003 BMW M3 6-Speed",
      currency: "USD",
      endsAt: observedAt + 48 * 60 * 60 * 1000,
      listingState: "live" as const,
      reserveStatus: "unknown" as const,
      availability: "available" as const,
      observedAt,
    };
    const initial = await t.mutation(internal.auctionWatches.upsertSnapshot, {
      ...common,
      checkId: "auction-check-1",
      currentBidMinor: 2_500_000,
    });
    const material = await t.mutation(internal.auctionWatches.upsertSnapshot, {
      ...common,
      checkId: "auction-check-2",
      currentBidMinor: 2_610_000,
      observedAt: observedAt + 10 * 60 * 1000,
    });

    expect(initial.material).toBe(false);
    expect(material.material).toBe(true);
    expect(material.summary).toMatch(/ceiling/i);
    await expect(owner.query(api.auctionWatches.getForHunt, { huntId })).resolves.toMatchObject({
      currentBidMinor: 2_610_000,
      listingState: "live",
    });
    await expect(other.query(api.auctionWatches.getForHunt, { huntId })).rejects.toThrow(
      "Not authorized",
    );
  });

  it("never schedules a Garage Brief for an Auction Watch", async () => {
    const t = testBackend();
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const huntId = await owner.mutation(api.hunts.createHunt, {
      category: "hypercar",
      direction: "match",
      spec: { make: "BMW", model: "M3" },
      mode: "monitor",
      monitorPurpose: "auction",
      sourceUrls: ["https://example.com/live-auction/e46-m3"],
      notifyByEmail: false,
      weeklyGarageBrief: true,
    });

    await expect(t.query(internal.hunts.getByIdInternal, { huntId })).resolves.toMatchObject({
      weeklyGarageBrief: false,
    });
    await expect(
      owner.mutation(api.hunts.setWeeklyGarageBrief, { huntId, enabled: true }),
    ).rejects.toThrow("not available for Auction Watch");
  });

  it("shows a compact monitor heartbeat only to the mission owner", async () => {
    const t = testBackend();
    const huntId = await createDashboardHunt(t, "user-a", "a@example.com");
    await t.run(async (ctx) => {
      await ctx.db.insert("monitorChecks", {
        huntId,
        ownerId: "user-a",
        monitorId: "monitor-a",
        checkId: "check-a",
        status: "completed",
        changed: 1,
        added: 0,
        removed: 0,
        errors: 0,
        changedUrls: ["https://example.com/listing"],
        diffJson: "private provider detail",
        createdAt: 1,
      });
    });
    const owner = t.withIdentity({ tokenIdentifier: "user-a", email: "a@example.com" });
    const other = t.withIdentity({ tokenIdentifier: "user-b", email: "b@example.com" });

    await expect(owner.query(api.monitorChecks.listForHunt, { huntId })).resolves.toEqual([
      expect.objectContaining({ checkId: "check-a", changedUrls: ["https://example.com/listing"] }),
    ]);
    await expect(other.query(api.monitorChecks.listForHunt, { huntId })).rejects.toThrow(
      "Not authorized",
    );
  });

  it("applies a server-side inbox provisioning quota", async () => {
    const t = testBackend();
    await t.mutation(internal.rateLimit.consumeInboxProvision, { ownerId: "user-a" });
    await t.mutation(internal.rateLimit.consumeInboxProvision, { ownerId: "user-a" });
    await expect(
      t.mutation(internal.rateLimit.consumeInboxProvision, { ownerId: "user-a" }),
    ).rejects.toThrow("Please wait before trying to set up another agent inbox");
  });

  it("removes expired inbound email bodies", async () => {
    const t = testBackend();
    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("agentMessages", {
        ownerId: "user-a",
        inboxId: "inbox-a",
        messageId: "message-a",
        threadId: "thread-a",
        direction: "inbound",
        from: "a@example.com",
        to: "agent@example.com",
        subject: "Find an E46 M3",
        text: "Private request body",
        receivedAt: 0,
        processingStatus: "processed",
      });
    });

    const result = await t.mutation(internal.retention.purgeExpiredData, {});
    const deleted = await t.run(async (ctx) => await ctx.db.get(messageId));

    expect(result.deleted).toBeGreaterThan(0);
    expect(deleted).toBeNull();
  });
});
