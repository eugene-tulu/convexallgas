import { v } from "convex/values";
import {
  action,
  internalAction,
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { candidateForUser, toCandidateForUser } from "./candidates";
import {
  contactPolicyValidator,
  DEFAULT_DISCOVERY_EXCLUDED_DOMAINS,
  discoveryBriefValidator,
  discoveryPlanValidator,
  discoverySearchBreadthValidator,
  experienceProfileValidator,
  huntSpecValidator,
  marketValidator,
  moneyValidator,
  missionIntentValidator,
  notificationCadenceValidator,
  serendipityValidator,
  sourcePreferencesValidator,
  sourcePlanValidator,
  urgencyValidator,
} from "./market";

const categoryValidator = v.union(
  v.literal("hypercar"),
  v.literal("watch"),
  v.literal("reservation"),
  v.literal("salvage_flip"),
);

const directionValidator = v.union(
  v.literal("above"),
  v.literal("below"),
  v.literal("match"),
);

const huntModeValidator = v.union(
  v.literal("search"),
  v.literal("monitor"),
  v.literal("one_off"),
);

const monitorPurposeValidator = v.union(
  v.literal("discovery"),
  v.literal("auction"),
);

const notificationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("unavailable"),
  v.literal("failed"),
  v.literal("disabled"),
);

// Updating a mission deliberately uses replacement semantics for the mutable
// brief: the dashboard always sends the current complete brief, so clearing a
// field is unambiguous and cannot leave old search criteria behind.
const missionUpdateArgs = {
  huntId: v.id("hunts"),
  direction: directionValidator,
  threshold: v.optional(v.number()),
  spec: huntSpecValidator,
  mode: huntModeValidator,
  monitorPurpose: v.optional(monitorPurposeValidator),
  sourceUrls: v.optional(v.array(v.string())),
  cadenceMinutes: v.optional(v.number()),
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
  discoveryBrief: v.optional(discoveryBriefValidator),
};

type Market = {
  countryCode?: string;
  locality?: string;
  radiusKm?: number;
  deliveryMode?: "pickup" | "shipping" | "either";
  allowedCountries?: string[];
  language?: string;
};

type Money = {
  currency: string;
  amountMinor?: number;
  includesFees: boolean;
};

type SourcePreferences = {
  includeDomains?: string[];
  excludeDomains?: string[];
};

type ExperienceProfile = "collector" | "deal_radar" | "adaptive";
type MissionIntent = "known_car" | "guided" | "listing_review";
type DiscoveryBrief = {
  prompt?: string;
  vibes?: Array<
    | "weekend_escape"
    | "first_proper_car"
    | "road_trip"
    | "hands_on_project"
    | "understated_fast"
    | "occasion_car"
  >;
  ownershipAppetite?: "turn_key" | "learn_as_i_go" | "hands_on";
};

function creationSummary(
  missionIntent: MissionIntent,
  direction: "above" | "below" | "match",
  category: string,
): string {
  if (missionIntent === "guided") return "Created a guided car brief";
  if (missionIntent === "listing_review") return "Created a listing check";
  const item =
    category === "hypercar"
      ? "enthusiast-car mission"
      : category === "salvage_flip"
        ? "salvage-vehicle mission"
        : `${category} mission`;
  return `Created a ${direction} ${item}`;
}

function resolveExperienceProfile(
  supplied: ExperienceProfile | undefined,
  preference: ExperienceProfile,
  category: string,
  direction: string,
): ExperienceProfile {
  if (category !== "hypercar" && category !== "salvage_flip") return "adaptive";
  const selected = supplied ?? preference;
  if (selected !== "adaptive") return selected;
  return direction === "above" ? "collector" : direction === "below" ? "deal_radar" : "adaptive";
}

function validateSpec(
  spec: Record<string, unknown>,
  category: string,
  missionIntent: MissionIntent,
  discoveryBrief: DiscoveryBrief | undefined,
  sourceUrls: string[] | undefined,
): boolean {
  if (missionIntent === "listing_review") return Boolean(sourceUrls?.length);
  if (missionIntent === "guided") {
    return (
      category === "hypercar" &&
      Boolean(discoveryBrief?.prompt || discoveryBrief?.vibes?.length)
    );
  }
  if (category === "hypercar") return !!spec.make || !!spec.model || !!spec.minYear;
  if (category === "watch") return !!spec.brand;
  if (category === "reservation")
    return !!spec.venueName || !!spec.city || !!spec.partySize;
  if (category === "salvage_flip")
    return spec.salvageOnly !== undefined || !!spec.make;
  return false;
}

function normalizeDiscoveryBrief(
  supplied: DiscoveryBrief | undefined,
): DiscoveryBrief | undefined {
  const prompt = supplied?.prompt?.replace(/\s+/g, " ").trim();
  if (prompt && prompt.length > 800) {
    throw new Error("Keep your car brief under 800 characters");
  }
  if ((supplied?.vibes?.length ?? 0) > 3) {
    throw new Error("Choose up to three qualities for a guided car mission");
  }
  const vibes = [...new Set(supplied?.vibes ?? [])];
  const ownershipAppetite = supplied?.ownershipAppetite;
  if (!prompt && vibes.length === 0 && !ownershipAppetite) return undefined;
  return {
    ...(prompt ? { prompt } : {}),
    ...(vibes.length > 0 ? { vibes } : {}),
    ...(ownershipAppetite ? { ownershipAppetite } : {}),
  };
}

function resolveMissionIntent(
  supplied: MissionIntent | undefined,
  category: string,
): MissionIntent {
  const missionIntent = supplied ?? "known_car";
  if (
    (missionIntent === "guided" || missionIntent === "listing_review") &&
    category !== "hypercar"
  ) {
    throw new Error("This car-discovery path is available for enthusiast-car missions");
  }
  return missionIntent;
}

function isSafeSourceUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      host !== "localhost" &&
      !host.endsWith(".local") &&
      host !== "0.0.0.0" &&
      host !== "::1" &&
      !/^127\./.test(host) &&
      !/^10\./.test(host) &&
      !/^192\.168\./.test(host) &&
      !/^169\.254\./.test(host) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

function validateControls(
  threshold: number | undefined,
  sourceUrls: string[] | undefined,
  cadenceMinutes: number | undefined,
): void {
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0)) {
    throw new Error("threshold must be a non-negative finite number");
  }
  if (
    cadenceMinutes !== undefined &&
    (!Number.isFinite(cadenceMinutes) ||
      cadenceMinutes < 15 ||
      cadenceMinutes > 10080)
  ) {
    throw new Error("cadenceMinutes must be between 15 minutes and 7 days");
  }
  if (
    sourceUrls &&
    (sourceUrls.length > 20 || sourceUrls.some((url) => !isSafeSourceUrl(url)))
  ) {
    throw new Error("sourceUrls must contain at most 20 public HTTP(S) URLs");
  }
}

function resolveMonitorPurpose(
  mode: "search" | "monitor" | "one_off",
  supplied: "discovery" | "auction" | undefined,
  sourceUrls: string[] | undefined,
): "discovery" | "auction" | undefined {
  if (mode !== "monitor") return undefined;
  const purpose = supplied ?? "discovery";
  if (purpose === "auction" && sourceUrls?.length !== 1) {
    throw new Error("An Auction Watch needs one public auction listing link.");
  }
  return purpose;
}

function defaultCadenceForUrgency(urgency: "whenever" | "soon" | "urgent"): number {
  if (urgency === "urgent") return 15;
  if (urgency === "whenever") return 360;
  return 60;
}

function normalizeCountry(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized || undefined;
}

function normalizeDomains(domains: string[] | undefined): string[] | undefined {
  if (!domains) return undefined;
  const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
  if (normalized.length > 12) throw new Error("Choose at most 12 preferred or blocked domains");
  if (normalized.some((domain) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))) {
    throw new Error("Domains should look like example.com, without a path");
  }
  return normalized.length > 0 ? normalized : undefined;
}

function resolveMarket(
  supplied: Market | undefined,
  preferences: {
    countryCode?: string;
    locality?: string;
    radiusKm?: number;
    deliveryMode: "pickup" | "shipping" | "either";
    allowedCountries?: string[];
    language?: string;
  },
): Market {
  const market = {
    countryCode: normalizeCountry(supplied?.countryCode ?? preferences.countryCode),
    locality: (supplied?.locality ?? preferences.locality)?.trim() || undefined,
    radiusKm: supplied?.radiusKm ?? preferences.radiusKm,
    deliveryMode: supplied?.deliveryMode ?? preferences.deliveryMode,
    allowedCountries: (supplied?.allowedCountries ?? preferences.allowedCountries)?.map(
      (country) => country.trim().toUpperCase(),
    ),
    language: (supplied?.language ?? preferences.language)?.trim() || undefined,
  };
  if (market.countryCode && !/^[A-Z]{2}$/.test(market.countryCode)) {
    throw new Error("Market country must be a two-letter ISO code");
  }
  if (market.radiusKm !== undefined && (!Number.isFinite(market.radiusKm) || market.radiusKm < 1 || market.radiusKm > 20000)) {
    throw new Error("Search radius must be between 1 and 20,000 km");
  }
  if (market.allowedCountries && (market.allowedCountries.length > 12 || market.allowedCountries.some((country) => !/^[A-Z]{2}$/.test(country)))) {
    throw new Error("Allowed markets must use up to 12 two-letter country codes");
  }
  return market;
}

function resolveMoney(
  supplied: Money | undefined,
  threshold: number | undefined,
  defaultCurrency: string,
): Money | undefined {
  if (!supplied && threshold === undefined) return undefined;
  const money = supplied ?? {
    currency: defaultCurrency,
    amountMinor: Math.round(threshold! * 100),
    includesFees: false,
  };
  const currency = money.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter ISO code");
  if (money.amountMinor !== undefined && (!Number.isSafeInteger(money.amountMinor) || money.amountMinor < 0)) {
    throw new Error("Budget must be a non-negative whole number of minor currency units");
  }
  return { ...money, currency };
}

function resolveSourcePreferences(
  supplied: SourcePreferences | undefined,
  preferences: { preferredDomains?: string[]; blockedDomains?: string[] },
): SourcePreferences | undefined {
  const includeDomains = normalizeDomains(supplied?.includeDomains ?? preferences.preferredDomains);
  const excludeDomains = normalizeDomains(supplied?.excludeDomains ?? preferences.blockedDomains);
  if (!includeDomains && !excludeDomains) return undefined;
  return { includeDomains, excludeDomains };
}

function searchDomainScope(sourcePreferences: SourcePreferences | undefined): {
  includeDomains?: string[];
  excludeDomains?: string[];
} {
  const included = sourcePreferences?.includeDomains;
  if (included?.length) return { includeDomains: included };
  return {
    excludeDomains: [
      ...new Set([
        ...DEFAULT_DISCOVERY_EXCLUDED_DOMAINS,
        ...(sourcePreferences?.excludeDomains ?? []),
      ]),
    ],
  };
}

function validateTimePreferences(
  timeZone: string,
  quietHoursStart: number | undefined,
  quietHoursEnd: number | undefined,
): void {
  try {
    Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new Error("Choose a valid IANA time zone");
  }
  if ((quietHoursStart === undefined) !== (quietHoursEnd === undefined)) {
    throw new Error("Set both quiet-hours boundaries or neither");
  }
  for (const hour of [quietHoursStart, quietHoursEnd]) {
    if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
      throw new Error("Quiet hours must use whole hours from 0 to 23");
    }
  }
  if (
    quietHoursStart !== undefined &&
    quietHoursStart === quietHoursEnd
  ) {
    throw new Error("Quiet-hours start and end must be different");
  }
}

function monitorSearchQuery(hunt: {
  category: string;
  direction: string;
  threshold?: number;
  money?: Money;
  market?: Market;
  spec: Record<string, unknown>;
  experienceProfile?: ExperienceProfile;
  missionIntent?: MissionIntent;
  discoveryBrief?: DiscoveryBrief;
}): string {
  const guidedItem =
    hunt.missionIntent === "guided"
      ? [
          hunt.discoveryBrief?.prompt,
          ...(hunt.discoveryBrief?.vibes ?? []).map((vibe) => vibe.replace(/_/g, " ")),
          hunt.discoveryBrief?.ownershipAppetite?.replace(/_/g, " "),
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .slice(0, 220)
      : "";
  const item =
    hunt.category === "watch"
      ? String(hunt.spec.brand ?? "luxury watch")
      : hunt.category === "reservation"
        ? String(hunt.spec.venueName ?? hunt.spec.city ?? "restaurant reservation")
        : hunt.category === "hypercar"
          ? [
              hunt.spec.minYear && hunt.spec.maxYear
                ? `${hunt.spec.minYear}-${hunt.spec.maxYear}`
                : hunt.spec.minYear
                  ? `${hunt.spec.minYear}+`
                  : "",
              hunt.spec.make,
              hunt.spec.model,
              hunt.spec.generation,
              hunt.spec.variant,
            ]
              .filter(Boolean)
              .join(" ") || guidedItem || "enthusiast car"
          : [hunt.spec.make, hunt.spec.model, hunt.spec.generation, hunt.spec.variant, "salvage vehicle"]
              .filter(Boolean)
              .join(" ");
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(" ");
  const budget =
    hunt.direction === "below" && hunt.money?.amountMinor !== undefined
      ? ` under ${hunt.money.currency} ${hunt.money.amountMinor / 100}`
      : hunt.direction === "below" && hunt.threshold !== undefined
        ? ` under ${hunt.threshold}`
        : "";
  const isVehicle = hunt.category === "hypercar" || hunt.category === "salvage_flip";
  const vehicleDetails = isVehicle
    ? [
        hunt.spec.bodyStyle && hunt.spec.bodyStyle !== "either"
          ? String(hunt.spec.bodyStyle)
          : "",
        hunt.spec.originality && hunt.spec.originality !== "either"
          ? String(hunt.spec.originality)
          : "",
        typeof hunt.spec.maxMileage === "number"
          ? `under ${hunt.spec.maxMileage.toLocaleString()} miles`
          : "",
        hunt.spec.transmission === "manual" || hunt.spec.transmission === "automatic"
          ? `${hunt.spec.transmission} transmission`
          : "",
        hunt.spec.driveSide === "left" || hunt.spec.driveSide === "right"
          ? `${hunt.spec.driveSide}-hand drive`
          : "",
        typeof hunt.spec.exteriorColor === "string" ? hunt.spec.exteriorColor : "",
        typeof hunt.spec.mustHave === "string" ? hunt.spec.mustHave : "",
        typeof hunt.spec.avoid === "string" ? `avoid ${hunt.spec.avoid}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const profileIntent =
    isVehicle && hunt.experienceProfile === "collector"
      ? " provenance service history original specification collector quality"
      : isVehicle && hunt.experienceProfile === "deal_radar"
        ? " newly listed price drop best deal available now"
        : "";
  return `${item} ${vehicleDetails} available${location ? ` ${location}` : ""}${budget} ${profileIntent}`
    .replace(/\s+/g, " ")
    .trim();
}

export const createHunt = mutation({
  args: {
    category: categoryValidator,
    direction: directionValidator,
    threshold: v.optional(v.number()),
    spec: huntSpecValidator,
    mode: v.optional(huntModeValidator),
    monitorPurpose: v.optional(monitorPurposeValidator),
    sourceUrls: v.optional(v.array(v.string())),
    cadenceMinutes: v.optional(v.number()),
    notifyByEmail: v.optional(v.boolean()),
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
  },
  returns: v.id("hunts"),
  handler: async (ctx, args): Promise<Id<"hunts">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const preferences = await ctx.runQuery(internal.preferences.getForOwnerInternal, {
      ownerId: identity.tokenIdentifier,
    });
    const threshold =
      args.threshold ??
      (args.money?.amountMinor !== undefined ? args.money.amountMinor / 100 : undefined);
    const urgency = args.urgency ?? "soon";
    const money = resolveMoney(args.money, threshold, preferences.currency);
    const market = resolveMarket(args.market, preferences);
    const timeZone = args.timeZone?.trim() || preferences.timeZone;
    const quietHoursStart = args.quietHoursStart ?? preferences.quietHoursStart;
    const quietHoursEnd = args.quietHoursEnd ?? preferences.quietHoursEnd;
    const notificationCadence = args.notificationCadence ?? preferences.notificationCadence;
    const preferredWeeklyGarageBrief = args.weeklyGarageBrief ?? preferences.weeklyGarageBrief;
    const serendipity = args.serendipity ?? preferences.serendipity;
    const experienceProfile = resolveExperienceProfile(
      args.experienceProfile,
      preferences.experienceProfile,
      args.category,
      args.direction,
    );
    const contactPolicy = args.contactPolicy ?? preferences.contactPolicy;
    const sourcePreferences = resolveSourcePreferences(args.sourcePreferences, preferences);
    const cadenceMinutes = args.cadenceMinutes ?? defaultCadenceForUrgency(urgency);
    const missionIntent = resolveMissionIntent(args.missionIntent, args.category);
    const discoveryBrief = normalizeDiscoveryBrief(args.discoveryBrief);

    if (args.direction === "match" && threshold !== undefined)
      throw new Error("direction=match cannot have a threshold");
    if (args.direction !== "match" && threshold === undefined)
      throw new Error("direction=above|below requires a numeric threshold");

    validateControls(threshold, args.sourceUrls, cadenceMinutes);
    const mode = args.mode ?? "search";
    const monitorPurpose = resolveMonitorPurpose(
      mode,
      args.monitorPurpose,
      args.sourceUrls,
    );
    const weeklyGarageBrief =
      monitorPurpose === "auction" ? false : preferredWeeklyGarageBrief;
    validateTimePreferences(timeZone, quietHoursStart, quietHoursEnd);
    if (args.expiresAt !== undefined && (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now())) {
      throw new Error("Mission expiry must be in the future");
    }

    if (
      !validateSpec(
        args.spec,
        args.category,
        missionIntent,
        discoveryBrief,
        args.sourceUrls,
      )
    )
      throw new Error(`Invalid spec fields for category ${args.category}`);

    // Dashboard-first is the safe default. Creating an inbox and starting an
    // email thread is a separate, explicit choice in the client.
    const notifyByEmail = args.notifyByEmail ?? false;
    const huntId = await ctx.db.insert("hunts", {
      ownerId: identity.tokenIdentifier,
      category: args.category,
      direction: args.direction,
      threshold,
      money,
      market,
      timeZone,
      notificationCadence,
      weeklyGarageBrief,
      quietHoursStart,
      quietHoursEnd,
      serendipity,
      experienceProfile,
      contactPolicy,
      urgency,
      expiresAt: args.expiresAt,
      sourcePreferences,
      missionIntent,
      discoveryBrief,
      discoverySearchBreadth:
        missionIntent === "guided" ? ("starting" as const) : undefined,
      spec: args.spec,
      mode,
      monitorPurpose,
      sourceUrls: args.sourceUrls,
      cadenceMinutes,
      notifyByEmail,
      notificationStatus: notifyByEmail ? ("pending" as const) : ("disabled" as const),
      status: "active" as const,
      createdAt: Date.now(),
    });

    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: identity.tokenIdentifier,
      table: "hunts",
      rowId: huntId as unknown as string,
      action: "hunt_created",
      summary: creationSummary(missionIntent, args.direction, args.category),
    });

    if (notifyByEmail) {
      await ctx.scheduler.runAfter(
        0,
        internal.hunt.ensureDashboardNotificationThread,
        { huntId },
      );
    }
    if (args.expiresAt !== undefined) {
      await ctx.scheduler.runAfter(
        Math.max(0, args.expiresAt - Date.now()),
        internal.hunt.expireMission,
        { huntId },
      );
    }

    return huntId;
  },
});

export const startMonitorForOwner = internalAction({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    // Starting a monitor from the creation flow can retain the existing
    // scheduled-search fallback. Refreshing an edited brief must not launch a
    // new search merely because the user pressed Save.
    startFallbackRun: v.boolean(),
  },
  returns: v.object({ active: v.boolean(), fallback: v.boolean() }),
  handler: async (ctx, args): Promise<{ active: boolean; fallback: boolean }> => {
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: args.huntId,
    });
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Not authorized");
    if (hunt.status !== "active") throw new Error("Hunt is paused or archived");
    if (hunt.expiresAt && hunt.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.hunts.setStatus, {
        huntId: hunt._id,
        status: "archived",
      });
      throw new Error("This mission has expired and was archived");
    }
    if (hunt.monitorId && hunt.monitorStatus === "active") {
      return { active: true, fallback: false };
    }

    const isAuctionWatch = hunt.monitorPurpose === "auction";
    if (isAuctionWatch && hunt.sourceUrls?.length !== 1) {
      await ctx.runMutation(internal.hunts.setMonitorHealth, {
        huntId: hunt._id,
        status: "needs_attention",
      });
      throw new Error("This Auction Watch needs one public auction listing link.");
    }
    const target = hunt.sourceUrls?.length
      ? { type: "scrape" as const, urls: hunt.sourceUrls }
      : {
          type: "search" as const,
          queries: [monitorSearchQuery(hunt)],
          ...searchDomainScope(hunt.sourcePreferences),
          maxResults: 12,
        };
    try {
      await ctx.runAction(internal.firecrawl.createMonitor, {
        huntId: hunt._id,
        ownerId: hunt.ownerId,
        name: `Jamanyo ${hunt.category} monitor`,
        schedule: `every ${hunt.cadenceMinutes ?? 60} minutes`,
        goal: `Notify me about meaningful changes for ${monitorSearchQuery(hunt)}`,
        targets: [target],
      });
      await ctx.runMutation(internal.eventsLog.logEvent, {
        ownerId: hunt.ownerId,
        table: "hunts",
        rowId: hunt._id as unknown as string,
        action: "monitor_started",
        summary: "Started a Firecrawl monitor for this mission",
      });
      return { active: true, fallback: false };
    } catch (error: unknown) {
      // Broad discovery can safely degrade into the scheduled scout. A single
      // auction cannot: pretending a deadline is watched would be worse than
      // asking the owner to retry or use another public listing.
      if (isAuctionWatch) {
        await ctx.runMutation(internal.hunts.setMonitorHealth, {
          huntId: hunt._id,
          status: "needs_attention",
        });
        await ctx.runMutation(internal.eventsLog.logEvent, {
          ownerId: hunt.ownerId,
          table: "hunts",
          rowId: hunt._id as unknown as string,
          action: "auction_watch_needs_attention",
          summary: "Jamanyo could not start the Auction Watch; no deadline monitoring is active",
        });
        const reason = error instanceof Error ? error.message : "unknown provider error";
        throw new Error(`Jamanyo couldn't start this Auction Watch (${reason}). No deadline monitoring is active.`);
      }
      await ctx.runMutation(internal.hunts.fallbackToSearch, {
        huntId: hunt._id,
      });
      if (args.startFallbackRun) {
        await ctx.runMutation(internal.huntRuns.enqueueForHunt, {
          huntId: hunt._id,
          ownerId: hunt.ownerId,
          trigger: "manual",
          idempotencyKey: `monitor-fallback:${hunt._id}:${Date.now()}`,
        });
      }
      await ctx.runMutation(internal.eventsLog.logEvent, {
        ownerId: hunt.ownerId,
        table: "hunts",
        rowId: hunt._id as unknown as string,
        action: "monitor_fallback",
        summary: "Native monitoring was unavailable; switched this mission to scheduled search",
      });
      return { active: false, fallback: true };
    }
  },
});

export const startMonitor = action({
  args: { huntId: v.id("hunts") },
  returns: v.object({ active: v.boolean(), fallback: v.boolean() }),
  handler: async (ctx, args): Promise<{ active: boolean; fallback: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.runAction(internal.hunts.startMonitorForOwner, {
      huntId: args.huntId,
      ownerId: identity.tokenIdentifier,
      startFallbackRun: true,
    });
  },
});

// Editing an active native monitor is a two-step operation: stop the old
// Firecrawl target first, save the new brief transactionally, then create a
// monitor from that new brief. That prevents a mission from silently watching
// yesterday's criteria.
export const updateMission = action({
  args: missionUpdateArgs,
  returns: v.object({
    restartedMonitor: v.boolean(),
    fallbackToSearch: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ restartedMonitor: boolean; fallbackToSearch: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: args.huntId,
    });
    if (!existing || existing.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    if (existing.status === "deleting") {
      throw new Error("This mission is already being removed");
    }

    const hasLiveMonitor =
      Boolean(existing.monitorId) && existing.monitorStatus !== "deleted";
    if (hasLiveMonitor && existing.monitorId) {
      let stopped = false;
      try {
        stopped = await ctx.runAction(internal.firecrawl.deleteMonitor, {
          huntId: existing._id,
          ownerId: identity.tokenIdentifier,
          monitorId: existing.monitorId,
        });
      } catch {
        throw new Error("We couldn't refresh this mission's monitor. Nothing has been changed—please try again.");
      }
      if (!stopped) {
        throw new Error("We couldn't confirm the old monitor stopped. Nothing has been changed—please try again.");
      }
    }

    const updated = await ctx.runMutation(internal.hunts.applyMissionUpdate, {
      ...args,
      ownerId: identity.tokenIdentifier,
    });

    if (updated.status !== "active" || updated.mode !== "monitor") {
      return { restartedMonitor: false, fallbackToSearch: false };
    }
    const monitoring = await ctx.runAction(internal.hunts.startMonitorForOwner, {
      huntId: updated._id,
      ownerId: identity.tokenIdentifier,
      startFallbackRun: false,
    });
    return {
      restartedMonitor: monitoring.active,
      fallbackToSearch: monitoring.fallback,
    };
  },
});

export const deleteMission = action({
  args: { huntId: v.id("hunts") },
  returns: v.object({ removalStarted: v.boolean() }),
  handler: async (ctx, args): Promise<{ removalStarted: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: args.huntId,
    });
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    if (hunt.status === "deleting") return { removalStarted: true };

    if (hunt.monitorId && hunt.monitorStatus !== "deleted") {
      let stopped = false;
      try {
        stopped = await ctx.runAction(internal.firecrawl.deleteMonitor, {
          huntId: hunt._id,
          ownerId: identity.tokenIdentifier,
          monitorId: hunt.monitorId,
        });
      } catch {
        throw new Error("We couldn't stop this mission's Firecrawl monitor. Nothing has been removed—please try again.");
      }
      if (!stopped) {
        throw new Error("We couldn't confirm the Firecrawl monitor stopped. Nothing has been removed—please try again.");
      }
    }

    await ctx.runMutation(internal.hunts.beginDeletion, {
      huntId: hunt._id,
      ownerId: identity.tokenIdentifier,
    });
    return { removalStarted: true };
  },
});

export const createFromEmail = internalMutation({
  args: {
    ownerId: v.string(),
    ownerEmail: v.optional(v.string()),
    inboxId: v.string(),
    inboxEmail: v.string(),
    category: categoryValidator,
    direction: directionValidator,
    threshold: v.optional(v.number()),
    spec: huntSpecValidator,
    mode: v.optional(huntModeValidator),
    monitorPurpose: v.optional(monitorPurposeValidator),
    sourceUrls: v.optional(v.array(v.string())),
    sourceMessageId: v.optional(v.string()),
    cadenceMinutes: v.optional(v.number()),
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
  },
  returns: v.id("hunts"),
  handler: async (ctx, args): Promise<Id<"hunts">> => {
    if (args.sourceMessageId) {
      const existing = await ctx.db
        .query("hunts")
        .withIndex("by_owner_sourceMessage", (q) =>
          q.eq("ownerId", args.ownerId).eq("sourceMessageId", args.sourceMessageId),
        )
        .first();
      if (existing) return existing._id;
    }
    const preferences = await ctx.runQuery(internal.preferences.getForOwnerInternal, {
      ownerId: args.ownerId,
    });
    const threshold =
      args.threshold ??
      (args.money?.amountMinor !== undefined ? args.money.amountMinor / 100 : undefined);
    const urgency = args.urgency ?? "soon";
    const money = resolveMoney(args.money, threshold, preferences.currency);
    const market = resolveMarket(args.market, preferences);
    const timeZone = args.timeZone?.trim() || preferences.timeZone;
    const quietHoursStart = args.quietHoursStart ?? preferences.quietHoursStart;
    const quietHoursEnd = args.quietHoursEnd ?? preferences.quietHoursEnd;
    const notificationCadence = args.notificationCadence ?? preferences.notificationCadence;
    const preferredWeeklyGarageBrief = args.weeklyGarageBrief ?? preferences.weeklyGarageBrief;
    const serendipity = args.serendipity ?? preferences.serendipity;
    const experienceProfile = resolveExperienceProfile(
      args.experienceProfile,
      preferences.experienceProfile,
      args.category,
      args.direction,
    );
    const contactPolicy = args.contactPolicy ?? preferences.contactPolicy;
    const sourcePreferences = resolveSourcePreferences(args.sourcePreferences, preferences);
    const cadenceMinutes = args.cadenceMinutes ?? defaultCadenceForUrgency(urgency);
    const missionIntent = resolveMissionIntent(args.missionIntent, args.category);
    const discoveryBrief = normalizeDiscoveryBrief(args.discoveryBrief);

    if (args.direction === "match" && threshold !== undefined)
      throw new Error("direction=match cannot have a threshold");
    if (args.direction !== "match" && threshold === undefined)
      throw new Error("direction=above|below requires a numeric threshold");
    validateControls(threshold, args.sourceUrls, cadenceMinutes);
    const mode = args.mode ?? "search";
    const monitorPurpose = resolveMonitorPurpose(
      mode,
      args.monitorPurpose,
      args.sourceUrls,
    );
    const weeklyGarageBrief =
      monitorPurpose === "auction" ? false : preferredWeeklyGarageBrief;
    validateTimePreferences(timeZone, quietHoursStart, quietHoursEnd);
    if (args.expiresAt !== undefined && (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now())) {
      throw new Error("Mission expiry must be in the future");
    }
    if (
      !validateSpec(
        args.spec,
        args.category,
        missionIntent,
        discoveryBrief,
        args.sourceUrls,
      )
    )
      throw new Error(`Invalid spec fields for category ${args.category}`);

    const huntId = await ctx.db.insert("hunts", {
      ownerId: args.ownerId,
      category: args.category,
      direction: args.direction,
      threshold,
      money,
      market,
      timeZone,
      notificationCadence,
      weeklyGarageBrief,
      quietHoursStart,
      quietHoursEnd,
      serendipity,
      experienceProfile,
      contactPolicy,
      urgency,
      expiresAt: args.expiresAt,
      sourcePreferences,
      missionIntent,
      discoveryBrief,
      discoverySearchBreadth:
        missionIntent === "guided" ? ("starting" as const) : undefined,
      spec: args.spec,
      inboxId: args.inboxId,
      inboxEmail: args.inboxEmail,
      mode,
      monitorPurpose,
      sourceUrls: args.sourceUrls,
      sourceMessageId: args.sourceMessageId,
      cadenceMinutes,
      notifyByEmail: true,
      notificationStatus: "active" as const,
      status: "active" as const,
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: args.ownerId,
      table: "hunts",
      rowId: huntId as unknown as string,
      action: "hunt_created_from_email",
      summary: creationSummary(missionIntent, args.direction, args.category),
    });
    if (args.expiresAt !== undefined) {
      await ctx.scheduler.runAfter(
        Math.max(0, args.expiresAt - Date.now()),
        internal.hunt.expireMission,
        { huntId },
      );
    }
    return huntId;
  },
});

export const setEmailNotifications = mutation({
  args: { huntId: v.id("hunts"), enabled: v.boolean() },
  returns: v.object({ enabled: v.boolean(), scheduled: v.boolean() }),
  handler: async (ctx, args): Promise<{ enabled: boolean; scheduled: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");

    // Inbox-created hunts stay attached to their original request thread so a
    // reply can still pause, resume, or refine that hunt.
    if (hunt.sourceMessageId) return { enabled: true, scheduled: false };

    const notificationStatus = args.enabled
      ? hunt.notificationMessageId
        ? "active"
        : "pending"
      : "disabled";
    await ctx.db.patch(args.huntId, {
      notifyByEmail: args.enabled,
      notificationStatus,
    });

    const scheduled = args.enabled && !hunt.notificationMessageId;
    if (scheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.hunt.ensureDashboardNotificationThread,
        { huntId: args.huntId },
      );
    }
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: identity.tokenIdentifier,
      table: "hunts",
      rowId: args.huntId as unknown as string,
      action: args.enabled
        ? "email_notifications_enabled"
        : "email_notifications_disabled",
      summary: args.enabled
        ? "Email updates enabled for this dashboard hunt"
        : "Email updates disabled; dashboard activity remains available",
    });
    return { enabled: args.enabled, scheduled };
  },
});

export const setWeeklyGarageBrief = mutation({
  args: { huntId: v.id("hunts"), enabled: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    if (hunt.category !== "hypercar" && hunt.category !== "salvage_flip") {
      throw new Error("Garage Briefs are available for vehicle missions only");
    }
    if (hunt.monitorPurpose === "auction" && args.enabled) {
      throw new Error("Garage Briefs are not available for Auction Watch missions");
    }
    if (args.enabled && !hunt.sourceMessageId && hunt.notifyByEmail === false) {
      throw new Error("Turn on email updates before enabling a weekly Garage Brief");
    }
    await ctx.db.patch(hunt._id, { weeklyGarageBrief: args.enabled });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: identity.tokenIdentifier,
      table: "hunts",
      rowId: hunt._id as unknown as string,
      action: args.enabled ? "weekly_garage_brief_enabled" : "weekly_garage_brief_disabled",
      summary: args.enabled
        ? "Enabled a weekly Garage Brief for this mission"
        : "Disabled the weekly Garage Brief for this mission",
    });
    return args.enabled;
  },
});

// Email replies run without the user's browser-auth session, so the inbox
// action supplies and verifies the durable owner id before changing a mission.
// Keep this separate from the public mutation rather than accepting an owner id
// from a browser client.
export const setWeeklyGarageBriefForOwner = internalMutation({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    enabled: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId) {
      throw new Error("Not authorized");
    }
    if (hunt.category !== "hypercar" && hunt.category !== "salvage_flip") {
      throw new Error("Garage Briefs are available for vehicle missions only");
    }
    if (hunt.monitorPurpose === "auction" && args.enabled) {
      throw new Error("Garage Briefs are not available for Auction Watch missions");
    }
    if (args.enabled && !hunt.sourceMessageId && hunt.notifyByEmail === false) {
      throw new Error("Turn on email updates before enabling a weekly Garage Brief");
    }
    await ctx.db.patch(hunt._id, { weeklyGarageBrief: args.enabled });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: args.ownerId,
      table: "hunts",
      rowId: hunt._id as unknown as string,
      action: args.enabled ? "weekly_garage_brief_enabled" : "weekly_garage_brief_disabled",
      summary: args.enabled
        ? "Enabled a weekly Garage Brief from the agent inbox"
        : "Disabled the weekly Garage Brief from the agent inbox",
    });
    return args.enabled;
  },
});

// Status changes go through an action because native monitors live at the
// provider too. A local-only pause would leave Firecrawl running and make the
// dashboard's promise misleading.
export const updateStatus = action({
  args: {
    huntId: v.id("hunts"),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
    ),
  },
  returns: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  handler: async (ctx, args): Promise<"active" | "paused" | "archived"> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.runAction(internal.hunts.changeStatusForOwner, {
      ...args,
      ownerId: identity.tokenIdentifier,
    });
  },
});

export const changeStatusForOwner = internalAction({
  args: {
    huntId: v.id("hunts"),
    ownerId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
    ),
  },
  returns: v.union(
    v.literal("active"),
    v.literal("paused"),
    v.literal("archived"),
  ),
  handler: async (ctx, args): Promise<"active" | "paused" | "archived"> => {
    const hunt = await ctx.runQuery(internal.hunts.getByIdInternal, {
      huntId: args.huntId,
    });
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Not authorized");
    if (hunt.status === "deleting") throw new Error("This mission is being removed");
    if (hunt.status === args.status) return args.status;
    if (
      args.status === "active" &&
      hunt.expiresAt !== undefined &&
      hunt.expiresAt <= Date.now()
    ) {
      throw new Error("This mission has expired. Create a new mission to continue.");
    }

    if (args.status === "paused" && hunt.mode === "monitor" && hunt.monitorId) {
      await ctx.runAction(internal.firecrawl.pauseMonitor, {
        huntId: hunt._id,
        ownerId: args.ownerId,
        monitorId: hunt.monitorId,
      });
    }

    if (args.status === "active" && hunt.mode === "monitor") {
      if (hunt.monitorId && hunt.monitorStatus === "paused") {
        await ctx.runAction(internal.firecrawl.resumeMonitor, {
          huntId: hunt._id,
          ownerId: args.ownerId,
          monitorId: hunt.monitorId,
        });
      } else if (hunt.monitorStatus !== "active") {
        // The creation path requires an active local mission. If it fails, put
        // the mission back to paused so the UI cannot imply an active watch.
        await ctx.runMutation(internal.hunts.setStatus, {
          huntId: hunt._id,
          status: "active",
        });
        try {
          await ctx.runAction(internal.hunts.startMonitorForOwner, {
            huntId: hunt._id,
            ownerId: args.ownerId,
            startFallbackRun: true,
          });
        } catch (error) {
          await ctx.runMutation(internal.hunts.setStatus, {
            huntId: hunt._id,
            status: "paused",
          });
          throw error;
        }
      }
    }

    if (args.status === "archived" && hunt.mode === "monitor" && hunt.monitorId) {
      await ctx.runAction(internal.firecrawl.deleteMonitor, {
        huntId: hunt._id,
        ownerId: args.ownerId,
        monitorId: hunt.monitorId,
      });
    }

    await ctx.runMutation(internal.hunts.setStatus, {
      huntId: hunt._id,
      status: args.status,
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: args.ownerId,
      table: "hunts",
      rowId: hunt._id as unknown as string,
      action: `hunt_${args.status}`,
      summary:
        args.status === "active"
          ? "Resumed this mission and its provider watch"
          : args.status === "paused"
            ? "Paused this mission and its provider watch"
            : "Archived this mission and stopped its provider watch",
    });
    return args.status;
  },
});

export const applyMissionUpdate = internalMutation({
  args: {
    ownerId: v.string(),
    ...missionUpdateArgs,
  },
  returns: schema.doc("hunts"),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Not authorized");
    if (hunt.status === "deleting") throw new Error("This mission is being removed");

    const preferences = await ctx.runQuery(internal.preferences.getForOwnerInternal, {
      ownerId: args.ownerId,
    });
    const missionIntent = resolveMissionIntent(hunt.missionIntent, hunt.category);
    const threshold =
      args.threshold ??
      (args.money?.amountMinor !== undefined ? args.money.amountMinor / 100 : undefined);
    const urgency = args.urgency ?? hunt.urgency ?? "soon";
    const money = resolveMoney(args.money, threshold, preferences.currency);
    const market = resolveMarket(args.market, preferences);
    const timeZone = args.timeZone?.trim() || preferences.timeZone;
    const quietHoursStart = args.quietHoursStart;
    const quietHoursEnd = args.quietHoursEnd;
    const notificationCadence = args.notificationCadence ?? preferences.notificationCadence;
    const serendipity = args.serendipity ?? preferences.serendipity;
    const experienceProfile = resolveExperienceProfile(
      args.experienceProfile,
      preferences.experienceProfile,
      hunt.category,
      args.direction,
    );
    const contactPolicy = args.contactPolicy ?? preferences.contactPolicy;
    const sourcePreferences = resolveSourcePreferences(args.sourcePreferences, preferences);
    const cadenceMinutes = args.cadenceMinutes ?? defaultCadenceForUrgency(urgency);
    const discoveryBrief = normalizeDiscoveryBrief(args.discoveryBrief);

    if (missionIntent !== "known_car" && args.direction !== "match") {
      throw new Error("Guided and listing-check missions use a matching brief, not a price direction");
    }
    if (missionIntent === "listing_review" && args.mode !== "search") {
      throw new Error("Listing checks use a focused search, not background monitoring");
    }
    if (missionIntent === "guided" && args.mode === "monitor") {
      throw new Error("Start a guided brief with a market check before turning on monitoring");
    }
    if (args.direction === "match" && threshold !== undefined) {
      throw new Error("direction=match cannot have a threshold");
    }
    if (args.direction !== "match" && threshold === undefined) {
      throw new Error("direction=above|below requires a numeric threshold");
    }
    validateControls(threshold, args.sourceUrls, cadenceMinutes);
    const monitorPurpose = resolveMonitorPurpose(
      args.mode,
      args.monitorPurpose ?? hunt.monitorPurpose,
      args.sourceUrls,
    );
    const weeklyGarageBrief =
      monitorPurpose === "auction"
        ? false
        : args.weeklyGarageBrief ?? hunt.weeklyGarageBrief;
    validateTimePreferences(timeZone, quietHoursStart, quietHoursEnd);
    if (args.expiresAt !== undefined && (!Number.isFinite(args.expiresAt) || args.expiresAt <= Date.now())) {
      throw new Error("Mission expiry must be in the future");
    }
    if (
      !validateSpec(
        args.spec,
        hunt.category,
        missionIntent,
        discoveryBrief,
        args.sourceUrls,
      )
    ) {
      throw new Error(`Invalid spec fields for category ${hunt.category}`);
    }

    await ctx.db.patch(hunt._id, {
      direction: args.direction,
      threshold,
      money,
      market,
      timeZone,
      notificationCadence,
      weeklyGarageBrief,
      quietHoursStart,
      quietHoursEnd,
      serendipity,
      experienceProfile,
      contactPolicy,
      urgency,
      expiresAt: args.expiresAt,
      sourcePreferences,
      discoveryBrief,
      discoverySearchBreadth:
        missionIntent === "guided" ? ("starting" as const) : undefined,
      discoveryPlan: undefined,
      sourcePlan: undefined,
      spec: args.spec,
      mode: args.mode,
      monitorPurpose,
      sourceUrls: args.sourceUrls,
      cadenceMinutes,
      monitorId: args.mode === "monitor" ? hunt.monitorId : undefined,
      monitorStatus: args.mode === "monitor" ? hunt.monitorStatus : undefined,
      nextRunAt: args.mode === "monitor" ? hunt.nextRunAt : undefined,
      briefUpdatedAt: Date.now(),
    });
    await ctx.runMutation(internal.eventsLog.logEvent, {
      ownerId: args.ownerId,
      table: "hunts",
      rowId: hunt._id as unknown as string,
      action: "hunt_updated",
      summary: "Updated this mission brief; the next check will use the new criteria",
    });
    const updated = await ctx.db.get(hunt._id);
    if (!updated) throw new Error("Mission update could not be saved");
    return updated;
  },
});

export const broadenGuidedDiscovery = mutation({
  args: { huntId: v.id("hunts") },
  returns: v.object({
    breadth: discoverySearchBreadthValidator,
    changed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier) {
      throw new Error("Not authorized");
    }
    if (hunt.missionIntent !== "guided") {
      throw new Error("Only a guided car brief can be broadened");
    }
    const changed = hunt.discoverySearchBreadth !== "wide";
    if (changed) {
      await ctx.db.patch(hunt._id, { discoverySearchBreadth: "wide" });
      await ctx.runMutation(internal.eventsLog.logEvent, {
        ownerId: identity.tokenIdentifier,
        table: "hunts",
        rowId: hunt._id as unknown as string,
        action: "discovery_broadened",
        summary: "Broadened the guided car search into wider starting directions",
      });
    }
    return { breadth: "wide" as const, changed };
  },
});

const MISSION_DELETION_BATCH_SIZE = 25;

export const beginDeletion = internalMutation({
  args: { huntId: v.id("hunts"), ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId) throw new Error("Not authorized");
    if (hunt.status === "deleting") return null;
    await ctx.db.patch(hunt._id, {
      status: "deleting",
      nextRunAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.hunts.deleteMissionBatch, {
      huntId: hunt._id,
      ownerId: args.ownerId,
    });
    return null;
  },
});

// Mission deletion is batched so one long-running hunt cannot exceed a
// transaction budget. It removes user-visible work and short-lived local email
// records; already delivered external email cannot be recalled.
export const deleteMissionBatch = internalMutation({
  args: { huntId: v.id("hunts"), ownerId: v.string() },
  returns: v.object({ complete: v.boolean(), deleted: v.number() }),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== args.ownerId || hunt.status !== "deleting") {
      return { complete: true, deleted: 0 };
    }
    const continueDeletion = async (deleted: number) => {
      await ctx.scheduler.runAfter(0, internal.hunts.deleteMissionBatch, args);
      return { complete: false, deleted };
    };

    // A run that began just before deletion can still be doing provider work.
    // Let it reach its normal completion path, then clean its records in a
    // later batch. Queued work, however, is safe to retire immediately.
    const running = await ctx.db
      .query("huntRuns")
      .withIndex("by_hunt_status", (q) =>
        q.eq("huntId", hunt._id).eq("status", "running"),
      )
      .first();
    if (running) {
      await ctx.scheduler.runAfter(5_000, internal.hunts.deleteMissionBatch, args);
      return { complete: false, deleted: 0 };
    }
    const queuedRuns = await ctx.db
      .query("huntRuns")
      .withIndex("by_hunt_status", (q) =>
        q.eq("huntId", hunt._id).eq("status", "queued"),
      )
      .take(MISSION_DELETION_BATCH_SIZE);
    if (queuedRuns.length > 0) {
      const finishedAt = Date.now();
      for (const run of queuedRuns) {
        await ctx.db.patch(run._id, {
          status: "completed",
          finishedAt,
          candidatesFound: 0,
          cleared: 0,
        });
      }
      return await continueDeletion(queuedRuns.length);
    }

    const notification = await ctx.db
      .query("notificationQueue")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .first();
    if (notification) {
      const keys = await ctx.db
        .query("notificationKeys")
        .withIndex("by_notification", (q) => q.eq("notificationId", notification._id))
        .take(MISSION_DELETION_BATCH_SIZE);
      for (const key of keys) await ctx.db.delete(key._id);
      if (keys.length === MISSION_DELETION_BATCH_SIZE) {
        return await continueDeletion(keys.length);
      }
      await ctx.db.delete(notification._id);
      return await continueDeletion(keys.length + 1);
    }

    const feedback = await ctx.db
      .query("huntFeedback")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (feedback.length > 0) {
      for (const item of feedback) await ctx.db.delete(item._id);
      return await continueDeletion(feedback.length);
    }

    const outreach = await ctx.db
      .query("outreach")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (outreach.length > 0) {
      for (const item of outreach) await ctx.db.delete(item._id);
      return await continueDeletion(outreach.length);
    }

    const unclearedCandidates = await ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) =>
        q.eq("huntId", hunt._id).eq("clearsThreshold", false),
      )
      .take(MISSION_DELETION_BATCH_SIZE);
    const candidates = unclearedCandidates.length > 0
      ? unclearedCandidates
      : await ctx.db
        .query("candidates")
        .withIndex("by_hunt_cleared", (q) =>
          q.eq("huntId", hunt._id).eq("clearsThreshold", true),
        )
        .take(MISSION_DELETION_BATCH_SIZE);
    if (candidates.length > 0) {
      for (const candidate of candidates) await ctx.db.delete(candidate._id);
      return await continueDeletion(candidates.length);
    }

    const directMessages = await ctx.db
      .query("agentMessages")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (directMessages.length > 0) {
      for (const message of directMessages) await ctx.db.delete(message._id);
      return await continueDeletion(directMessages.length);
    }

    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .first();
    if (thread) {
      const threadMessages = await ctx.db
        .query("agentMessages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread.threadId))
        .take(MISSION_DELETION_BATCH_SIZE);
      if (threadMessages.length > 0) {
        for (const message of threadMessages) await ctx.db.delete(message._id);
        return await continueDeletion(threadMessages.length);
      }
      await ctx.db.delete(thread._id);
      return await continueDeletion(1);
    }

    const briefs = await ctx.db
      .query("garageBriefs")
      .withIndex("by_hunt_week", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (briefs.length > 0) {
      for (const brief of briefs) await ctx.db.delete(brief._id);
      return await continueDeletion(briefs.length);
    }

    const runs = await ctx.db
      .query("huntRuns")
      .withIndex("by_hunt_status", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (runs.length > 0) {
      for (const run of runs) await ctx.db.delete(run._id);
      return await continueDeletion(runs.length);
    }

    const checks = await ctx.db
      .query("monitorChecks")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (checks.length > 0) {
      for (const check of checks) await ctx.db.delete(check._id);
      return await continueDeletion(checks.length);
    }

    const auctionWatches = await ctx.db
      .query("auctionWatches")
      .withIndex("by_hunt", (q) => q.eq("huntId", hunt._id))
      .take(MISSION_DELETION_BATCH_SIZE);
    if (auctionWatches.length > 0) {
      for (const watch of auctionWatches) await ctx.db.delete(watch._id);
      return await continueDeletion(auctionWatches.length);
    }

    const activity = await ctx.db
      .query("events")
      .withIndex("by_table_rowId", (q) =>
        q.eq("table", "hunts").eq("rowId", hunt._id as unknown as string),
      )
      .take(MISSION_DELETION_BATCH_SIZE);
    if (activity.length > 0) {
      for (const event of activity) await ctx.db.delete(event._id);
      return await continueDeletion(activity.length);
    }

    await ctx.db.delete(hunt._id);
    return { complete: true, deleted: 1 };
  },
});

export const listForUser = query({
  args: {},
  returns: v.array(schema.doc("hunts")),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const ownerId = identity.tokenIdentifier;
    const [active, paused, archived] = await Promise.all([
      ctx.db.query("hunts").withIndex("by_owner_status", (q) =>
        q.eq("ownerId", ownerId).eq("status", "active"),
      ).order("desc").take(50),
      ctx.db.query("hunts").withIndex("by_owner_status", (q) =>
        q.eq("ownerId", ownerId).eq("status", "paused"),
      ).order("desc").take(50),
      ctx.db.query("hunts").withIndex("by_owner_status", (q) =>
        q.eq("ownerId", ownerId).eq("status", "archived"),
      ).order("desc").take(50),
    ]);
    return [...active, ...paused, ...archived]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 50);
  },
});

export const listCleared = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(candidateForUser),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) throw new Error("Hunt not found");
    if (hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    const candidates = await ctx.db
      .query("candidates")
      .withIndex("by_hunt_cleared", (q) =>
        q.eq("huntId", args.huntId).eq("clearsThreshold", true),
      )
      .order("desc")
      .take(50);
    // Legacy candidates predate the actionability gate. Do not surface them
    // as leads until a later check records a deliberate potential_lead
    // disposition.
    return candidates
      .filter((candidate) => candidate.disposition === "potential_lead")
      .map(toCandidateForUser);
  },
});

export const getByIdInternal = internalQuery({
  args: { huntId: v.id("hunts") },
  returns: v.union(schema.doc("hunts"), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.huntId);
  },
});

export const saveDiscoveryPlan = internalMutation({
  args: {
    huntId: v.id("hunts"),
    plan: discoveryPlanValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) return null;
    await ctx.db.patch(hunt._id, { discoveryPlan: args.plan });
    return null;
  },
});

export const saveSourcePlan = internalMutation({
  args: {
    huntId: v.id("hunts"),
    plan: sourcePlanValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) return null;
    await ctx.db.patch(hunt._id, { sourcePlan: args.plan });
    return null;
  },
});

export const listActiveInternal = internalQuery({
  args: {},
  returns: v.array(schema.doc("hunts")),
  handler: async (ctx) => {
    return await ctx.db
      .query("hunts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(50);
  },
});

export const setInbox = internalMutation({
  args: {
    huntId: v.id("hunts"),
    inboxId: v.optional(v.string()),
    inboxEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.huntId, {
      inboxId: args.inboxId,
      inboxEmail: args.inboxEmail,
    });
    return null;
  },
});

export const setNotificationThread = internalMutation({
  args: {
    huntId: v.id("hunts"),
    messageId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt) return null;
    await ctx.db.patch(args.huntId, {
      notificationMessageId: args.messageId,
      notificationThreadId: args.threadId,
      notificationStatus: "active",
    });
    return null;
  },
});

export const setNotificationStatus = internalMutation({
  args: {
    huntId: v.id("hunts"),
    status: notificationStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.sourceMessageId) return null;
    await ctx.db.patch(args.huntId, { notificationStatus: args.status });
    return null;
  },
});

export const setMonitor = internalMutation({
  args: {
    huntId: v.id("hunts"),
    monitorId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("deleted"),
      v.literal("needs_attention"),
    ),
    nextRunAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.status === "deleting") return null;
    await ctx.db.patch(args.huntId, {
      mode: "monitor",
      monitorId: args.monitorId,
      monitorStatus: args.status,
      nextRunAt: args.nextRunAt,
    });
    return null;
  },
});

export const setMonitorHealth = internalMutation({
  args: {
    huntId: v.id("hunts"),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("deleted"),
      v.literal("needs_attention"),
    ),
    nextRunAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.status === "deleting") return null;
    await ctx.db.patch(hunt._id, {
      mode: "monitor",
      monitorStatus: args.status,
      nextRunAt: args.nextRunAt,
    });
    return null;
  },
});

export const setStatus = internalMutation({
  args: {
    huntId: v.id("hunts"),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.status === "deleting") return null;
    await ctx.db.patch(args.huntId, { status: args.status });
    return null;
  },
});

export const fallbackToSearch = internalMutation({
  args: { huntId: v.id("hunts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.status === "deleting") return null;
    await ctx.db.patch(args.huntId, {
      mode: "search",
      // A scheduled scout is a useful fallback, but it is not a live provider
      // monitor. The UI can say that plainly instead of showing “monitoring”.
      monitorStatus: "needs_attention",
      nextRunAt: Date.now(),
    });
    return null;
  },
});

export const monitorCapacity = internalQuery({
  args: { ownerId: v.string() },
  returns: v.object({ ownerActive: v.number(), globalActive: v.number() }),
  handler: async (ctx, args) => {
    const [owner, global] = await Promise.all([
      ctx.db
        .query("hunts")
        .withIndex("by_owner_monitor_status", (q) =>
          q.eq("ownerId", args.ownerId).eq("monitorStatus", "active"),
        )
        .take(6),
      ctx.db
        .query("hunts")
        .withIndex("by_monitor_status", (q) => q.eq("monitorStatus", "active"))
        .take(251),
    ]);
    return { ownerActive: owner.length, globalActive: global.length };
  },
});
