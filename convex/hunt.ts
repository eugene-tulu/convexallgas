"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { DEFAULT_DISCOVERY_EXCLUDED_DOMAINS } from "./market";
import { buildFallbackVehicleListingQuery } from "./searchQueries";
import {
  buildVehicleSourceQuery,
  customIncludedDomains,
  isDirectListingUrl,
  profileForUrl,
  selectVehicleSourceProfiles,
  sourceContextForUrl,
  vehicleSearchTerms,
  type ListingFormat,
  type ListingPriceType,
  type SourceContext,
  type VehicleSourceProfile,
} from "./sourceRegistry";
import { sourceClearlySaysListingClosed } from "./listingEvidence";

export interface HuntDoc {
  _id: Id<"hunts">;
  ownerId: string;
  category: "hypercar" | "watch" | "reservation" | "salvage_flip";
  direction: "above" | "below" | "match";
  threshold?: number;
  money?: { currency: string; amountMinor?: number; includesFees: boolean };
  market?: {
    countryCode?: string;
    locality?: string;
    radiusKm?: number;
    deliveryMode?: "pickup" | "shipping" | "either";
    allowedCountries?: string[];
    language?: string;
  };
  timeZone?: string;
  notificationCadence?: "instant" | "daily_digest";
  weeklyGarageBrief?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  serendipity?: "exact" | "smart" | "delight";
  experienceProfile?: "collector" | "deal_radar" | "adaptive";
  contactPolicy?: "alerts_only" | "draft_for_review";
  urgency?: "whenever" | "soon" | "urgent";
  expiresAt?: number;
  sourcePreferences?: { includeDomains?: string[]; excludeDomains?: string[] };
  missionIntent?: "known_car" | "guided" | "listing_review";
  discoveryBrief?: {
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
  discoverySearchBreadth?: "starting" | "wide";
  discoveryPlan?: {
    breadth: "starting" | "wide";
    searchedAt: number;
    sourceCount: number;
    lanes: Array<{
      label: string;
      rationale: string;
      searchTerms: string;
      resultCount: number;
      status: "sources_found" | "no_sources" | "unavailable";
    }>;
  };
  sourcePlan?: {
    searchedAt: number;
    sourceCount: number;
    entries: Array<{
      sourceId: string;
      sourceLabel: string;
      domains: string[];
      listingFormat: ListingFormat;
      expectedPriceType: ListingPriceType;
      status: "sources_found" | "no_sources" | "unavailable" | "skipped";
      resultCount: number;
      detail: string;
    }>;
  };
  spec: Record<string, unknown>;
  inboxId?: string;
  inboxEmail?: string;
  mode?: "search" | "monitor" | "one_off";
  sourceUrls?: string[];
  sourceMessageId?: string;
  notifyByEmail?: boolean;
  notificationMessageId?: string;
  notificationThreadId?: string;
  notificationStatus?:
    | "pending"
    | "active"
    | "unavailable"
    | "failed"
    | "disabled";
  cadenceMinutes?: number;
  monitorId?: string;
  monitorStatus?: "active" | "paused" | "deleted" | "needs_attention";
  monitorPurpose?: "discovery" | "auction";
  status: string;
  createdAt: number;
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  markdown: string;
  summary: string;
  imageUrl?: string;
  sourceContext?: SourceContext;
}

interface VerificationResult {
  passed: boolean;
  confidence: number;
  flags: string[];
  contactEmail: string;
  listingTitle?: string;
  listingImageUrl?: string;
  extractedValue?: number;
  matchDetail?: string;
  listingPriceMinor?: number;
  listingCurrency?: string;
  priceType?: ListingPriceType;
  normalizedPriceMinor?: number;
  normalizedCurrency?: string;
  estimatedTotalMinor?: number;
  availability?: "available" | "unknown" | "unavailable";
  sellerTrust?: "reviewed" | "unknown" | "caution";
  listingKind?: "specific_listing" | "research" | "unknown";
  sourceContext?: SourceContext;
  matchReasons?: string[];
}

interface ClearedMatch {
  candidateId: Id<"candidates">;
  title: string;
  url: string;
  extractedValue?: number;
  matchDetail?: string;
  listingPriceMinor?: number;
  listingCurrency?: string;
  priceType?: ListingPriceType;
  estimatedTotalMinor?: number;
  availability?: "available" | "unknown" | "unavailable";
  sellerTrust?: "reviewed" | "unknown" | "caution";
  matchReasons?: string[];
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function huntBudgetLabel(hunt: HuntDoc): string | undefined {
  if (hunt.money?.amountMinor !== undefined) {
    return formatMoney(hunt.money.amountMinor, hunt.money.currency);
  }
  return hunt.threshold !== undefined ? hunt.threshold.toLocaleString() : undefined;
}

function safeListingImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return undefined;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeListingTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.replace(/\s+/g, " ").trim().slice(0, 240);
  return title || undefined;
}

function searchText(value: unknown, limit = 160): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function quotedSearchText(value: unknown): string {
  const text = searchText(value, 100);
  return text ? `"${text}"` : "";
}

function knownVehicleQuery(spec: Record<string, unknown>): string {
  const make = searchText(spec.make, 80);
  const model = searchText(spec.model, 80);
  return [
    make && model ? quotedSearchText(`${make} ${model}`) : quotedSearchText(make || model),
    quotedSearchText(spec.generation),
    quotedSearchText(spec.variant),
  ]
    .filter(Boolean)
    .join(" ");
}

function searchScopeForHunt(hunt: HuntDoc): {
  includeDomains?: string[];
  excludeDomains?: string[];
  location?: string;
} {
  const included = hunt.sourcePreferences?.includeDomains ?? [];
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(", ");
  if (included.length > 0) {
    return {
      includeDomains: included,
      ...(location ? { location } : {}),
    };
  }
  return {
    excludeDomains: [
      ...new Set([
        ...DEFAULT_DISCOVERY_EXCLUDED_DOMAINS,
        ...(hunt.sourcePreferences?.excludeDomains ?? []),
      ]),
    ],
    ...(location ? { location } : {}),
  };
}

function buildSearchQuery(hunt: HuntDoc): string {
  const { category } = hunt;
  const spec = hunt.spec;
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(" ");
  const locationSuffix = location ? ` ${location}` : "";
  const deliverySuffix =
    hunt.market?.deliveryMode === "pickup"
      ? " local pickup"
      : hunt.market?.deliveryMode === "shipping"
        ? " shipping available"
        : "";
  const vehicleBrief = [
    typeof hunt.spec.model === "string" ? hunt.spec.model : "",
    typeof hunt.spec.generation === "string" ? hunt.spec.generation : "",
    typeof hunt.spec.variant === "string" ? hunt.spec.variant : "",
    hunt.spec.bodyStyle && hunt.spec.bodyStyle !== "either"
      ? String(hunt.spec.bodyStyle)
      : "",
    hunt.spec.originality && hunt.spec.originality !== "either"
      ? String(hunt.spec.originality)
      : "",
    typeof hunt.spec.maxMileage === "number"
      ? `under ${hunt.spec.maxMileage.toLocaleString()} miles`
      : "",
    hunt.spec.transmission && hunt.spec.transmission !== "either"
      ? hunt.spec.transmission
      : "",
    hunt.spec.driveSide && hunt.spec.driveSide !== "either"
      ? `${hunt.spec.driveSide}-hand drive`
      : "",
    hunt.spec.exteriorColor ? String(hunt.spec.exteriorColor) : "",
    hunt.spec.mustHave ? String(hunt.spec.mustHave) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const profileSuffix =
    hunt.experienceProfile === "collector"
      ? " rare collector provenance service history desirable specification"
      : hunt.experienceProfile === "deal_radar"
        ? " newly listed price drop good deal available now"
        : "";
  // Listing language and negative operators deliberately bias the first pass
  // away from reviews, market guides, and content pages. Budget and the more
  // nuanced taste criteria are applied during verification, where a source can
  // be read rather than inferred from a search-result snippet.
  const listingIntent = '"for sale" "asking price" -review -guide -valuation -forum -video';

  if (category === "hypercar") {
    const parts: string[] = [];
    if (spec.minYear && spec.maxYear) parts.push(`${spec.minYear}-${spec.maxYear}`);
    else if (spec.minYear) parts.push(`${spec.minYear}+`);
    else if (spec.maxYear) parts.push(`before ${spec.maxYear}`);
    if (spec.make) parts.push(spec.make as string);
    const vehicleIdentity = knownVehicleQuery(spec);
    let query = `${parts.join(" ")} ${vehicleIdentity || "enthusiast car"} ${vehicleBrief} ${listingIntent}${locationSuffix}${deliverySuffix}${profileSuffix}`;
    return query;
  }
  if (category === "watch") {
    let query = `${(spec.brand as string) || "luxury"} pre-owned watch ${listingIntent}${locationSuffix}${deliverySuffix}`;
    return query;
  }
  if (category === "salvage_flip") {
    let query = `${String(spec.make ?? "")} ${vehicleBrief} salvage title car ${listingIntent}${locationSuffix}${deliverySuffix}${profileSuffix}`;
    return query;
  }
  if (category === "reservation") {
    const venue = (spec.venueName as string) || "restaurant";
    const city = (spec.city as string) || "";
    const size = spec.partySize ? `${spec.partySize} people` : "";
    return `${venue} ${city || location} ${size} reservation available`.trim();
  }
  return "for sale";
}

type SourcePlanEntry = NonNullable<HuntDoc["sourcePlan"]>["entries"][number];

function sourceSearchLocation(hunt: HuntDoc): string | undefined {
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(", ");
  return location || undefined;
}

function sourcePlanEntry(
  profile: VehicleSourceProfile,
  status: SourcePlanEntry["status"],
  resultCount: number,
  detail: string,
): SourcePlanEntry {
  return {
    sourceId: profile.id,
    sourceLabel: profile.label,
    domains: [...profile.domains],
    listingFormat: profile.listingFormat,
    expectedPriceType: profile.expectedPriceType,
    status,
    resultCount,
    detail,
  };
}

function customSourcePlanEntry(
  domains: string[],
  status: SourcePlanEntry["status"],
  resultCount: number,
  detail: string,
): SourcePlanEntry {
  return {
    sourceId: "user_selected",
    sourceLabel: "Your selected sources",
    domains,
    listingFormat: "unknown",
    expectedPriceType: "unknown",
    status,
    resultCount,
    detail,
  };
}

function broadWebPlanEntry(
  status: SourcePlanEntry["status"],
  resultCount: number,
  detail: string,
): SourcePlanEntry {
  return {
    sourceId: "broad_web",
    sourceLabel: "Broader web discovery",
    domains: [],
    listingFormat: "unknown",
    expectedPriceType: "unknown",
    status,
    resultCount,
    detail,
  };
}

async function searchKnownVehicleMarket(
  ctx: ActionCtx,
  hunt: HuntDoc,
): Promise<{ results: SearchResult[]; broadened: boolean }> {
  const profiles = selectVehicleSourceProfiles(hunt.sourcePreferences);
  const location = sourceSearchLocation(hunt);
  const profileAttempts = await Promise.allSettled(
    profiles.map(async (profile) => {
      const results = (await ctx.runAction(internal.firecrawl.search, {
        query: buildVehicleSourceQuery(profile, hunt.spec),
        includeDomains: [...profile.domains],
        ...(location ? { location } : {}),
        // Three known sources × four results is deliberately bounded. The
        // next step spends effort reading direct vehicle pages, not collecting
        // a browser-sized pile of source links.
        limit: 4,
      })) as SearchResult[];
      return {
        profile,
        results: results.map((result) => ({
          ...result,
          sourceContext: sourceContextForUrl(profile, result.url),
        })),
      };
    }),
  );

  const planEntries: SourcePlanEntry[] = [];
  const candidateResults: SearchResult[] = [];
  const hubsToExpand: Array<{ profile: VehicleSourceProfile; result: SearchResult }> = [];
  for (let index = 0; index < profileAttempts.length; index++) {
    const profile = profiles[index];
    const attempt = profileAttempts[index];
    if (!profile || !attempt) continue;
    if (attempt.status === "rejected") {
      planEntries.push(
        sourcePlanEntry(
          profile,
          "unavailable",
          0,
          "This source could not be reached for this pass.",
        ),
      );
      continue;
    }

    // Known source profiles are deliberately conservative: an unfamiliar
    // route on a source site may be a story, guide, or search page. Only the
    // individual-record shape we understand is eligible for evidence review.
    // Market routes are separately expanded below; neither route type is a
    // lead in its own right.
    const directListings = attempt.value.results.filter(
      (result) => result.sourceContext?.resultRole === "specific_listing",
    );
    const hubs = attempt.value.results.filter(
      (result) => result.sourceContext?.resultRole === "market_context",
    );
    const unclassifiedRoutes = attempt.value.results.length - directListings.length - hubs.length;
    candidateResults.push(...directListings);
    hubsToExpand.push(...hubs.slice(0, 1).map((result) => ({ profile, result })));
    planEntries.push(
      sourcePlanEntry(
        profile,
        directListings.length > 0 ? "sources_found" : "no_sources",
        directListings.length,
        attempt.value.results.length === 0
          ? "No matching source pages surfaced in this pass."
          : directListings.length > 0
            ? `Found ${directListings.length} direct vehicle ${directListings.length === 1 ? "page" : "pages"} to inspect.`
            : hubs.length > 0
            ? "Found a source market route and looked for its direct vehicle pages."
            : unclassifiedRoutes > 0
              ? "Only non-listing routes surfaced, so Jamanyo did not treat them as leads."
              : "No direct vehicle pages surfaced in this pass.",
      ),
    );
  }

  // A market hub is useful navigation, but not a lead. For the sources whose
  // route shape we know, make one bounded attempt to pull the direct listing
  // pages from that hub before falling back to a wider web search.
  const hubSearchTerms = vehicleSearchTerms(hunt.spec);
  const hubAttempts = await Promise.allSettled(
    hubsToExpand.slice(0, 3).map(async ({ profile, result }) => {
      const links = await ctx.runAction(internal.firecrawl.map, {
        url: result.url,
        limit: 12,
        ...(hubSearchTerms ? { search: hubSearchTerms } : {}),
      });
      return {
        profile,
        urls: links
          .map((link) => link.url)
          .filter((url) => isDirectListingUrl(profile, url))
          .slice(0, 3),
      };
    }),
  );
  for (const attempt of hubAttempts) {
    if (attempt.status !== "fulfilled") continue;
    const discovered = attempt.value.urls.map((url) => ({
      title: "Direct listing discovered from source market",
      url,
      description: "A direct vehicle page found from the source's market route.",
      markdown: "",
      summary: "",
      sourceContext: sourceContextForUrl(attempt.value.profile, url),
    }));
    const entry = planEntries.find((item) => item.sourceId === attempt.value.profile.id);
    if (discovered.length > 0) {
      candidateResults.push(...discovered);
    }
    if (entry && discovered.length > 0) {
      entry.resultCount += discovered.length;
      entry.status = "sources_found";
      entry.detail = `Found ${discovered.length} direct listing ${discovered.length === 1 ? "page" : "pages"} from the source market route.`;
    } else if (entry && entry.status !== "sources_found") {
      entry.detail = "Found a source market route, but it did not yield direct vehicle pages for this brief.";
    }
  }

  const customDomains = customIncludedDomains(hunt.sourcePreferences);
  if (customDomains.length > 0) {
    try {
      const customResults = (await ctx.runAction(internal.firecrawl.search, {
        query: buildFallbackVehicleListingQuery(hunt.spec, hunt.market),
        includeDomains: customDomains,
        ...(location ? { location } : {}),
        limit: 6,
      })) as SearchResult[];
      candidateResults.push(...customResults);
      planEntries.push(
        customSourcePlanEntry(
          customDomains,
          customResults.length > 0 ? "sources_found" : "no_sources",
          customResults.length,
          customResults.length > 0
            ? "Searched the domains chosen for this mission."
            : "No matching pages surfaced from the domains chosen for this mission.",
        ),
      );
    } catch {
      planEntries.push(
        customSourcePlanEntry(
          customDomains,
          "unavailable",
          0,
          "Your selected source could not be reached for this pass.",
        ),
      );
    }
  }

  let broadened = false;
  if (candidateResults.length === 0) {
    const fallbackQuery =
      hunt.category === "hypercar"
        ? buildFallbackVehicleListingQuery(hunt.spec, hunt.market)
        : "";
    if (fallbackQuery) {
      broadened = true;
      try {
        const fallback = (await ctx.runAction(internal.firecrawl.search, {
          query: fallbackQuery,
          ...searchScopeForHunt(hunt),
          limit: 8,
        })) as SearchResult[];
        candidateResults.push(...fallback);
        planEntries.push(
          broadWebPlanEntry(
            fallback.length > 0 ? "sources_found" : "no_sources",
            fallback.length,
            fallback.length > 0
              ? "The selected sources had no direct pages, so Jamanyo tried one bounded broader listing search."
              : "The selected sources and one bounded broader listing search returned no pages.",
          ),
        );
      } catch {
        planEntries.push(
          broadWebPlanEntry(
            "unavailable",
            0,
            "The broader discovery service was temporarily unavailable.",
          ),
        );
      }
    }
  }

  const results = dedupeSearchResults(candidateResults).slice(0, 12);
  const plan = {
    searchedAt: Date.now(),
    sourceCount: results.length,
    entries: planEntries,
  };
  await ctx.runMutation(internal.hunts.saveSourcePlan, {
    huntId: hunt._id,
    plan,
  });
  await logActivity(
    ctx,
    hunt._id,
    hunt.ownerId,
    "source_portfolio_checked",
    planEntries.length > 0
      ? `Checked ${planEntries.length} source ${planEntries.length === 1 ? "route" : "routes"}; ${results.length} pages are ready for evidence review`
      : "No default source route applied to this brief; Jamanyo used the bounded discovery fallback",
  );
  if (broadened) {
    await logActivity(
      ctx,
      hunt._id,
      hunt.ownerId,
      "source_search_broadened",
      results.length > 0
        ? "The source portfolio found no direct pages, so Jamanyo widened the wording once"
        : "The source portfolio found no direct pages; Jamanyo also tried one broader listing search",
    );
  }
  return { results, broadened };
}

type GuidedDiscoveryLane = {
  label: string;
  rationale: string;
  searchTerms: string;
  resultCount: number;
  status: "sources_found" | "no_sources" | "unavailable";
};

type GuidedDiscoveryOutcome = {
  results: SearchResult[];
  sourceCount: number;
  lanes: GuidedDiscoveryLane[];
};

function buildGuidedLaneQuery(hunt: HuntDoc, searchTerms: string): string {
  const location = [hunt.market?.locality, hunt.market?.countryCode]
    .filter(Boolean)
    .join(" ");
  const locationSuffix = location ? ` ${location}` : "";
  const deliverySuffix =
    hunt.market?.deliveryMode === "pickup"
      ? " local pickup"
      : hunt.market?.deliveryMode === "shipping"
        ? " shipping available"
        : "";
  // The broader retry relaxes the explicit-price phrase without allowing the
  // search to drift into editorial content. Price still remains mandatory for
  // below/above decisions during source verification.
  const listingIntent =
    hunt.discoverySearchBreadth === "wide"
      ? '"for sale" -review -guide -valuation -forum -video'
      : '"for sale" "asking price" -review -guide -valuation -forum -video';
  return `${searchTerms} ${listingIntent}${locationSuffix}${deliverySuffix}`
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const deduped = new Map<string, SearchResult>();
  for (const result of results) {
    const key = canonicalSourceUrl(result.url);
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing || (!existing.sourceContext && result.sourceContext)) {
      deduped.set(key, { ...result, url: key });
    }
  }
  return [...deduped.values()];
}

async function searchGuidedVehicleLanes(
  ctx: ActionCtx,
  hunt: HuntDoc,
): Promise<GuidedDiscoveryOutcome> {
  const breadth = hunt.discoverySearchBreadth ?? "starting";
  const seeds = (await ctx.runAction(internal.discovery.planGuidedVehicleDiscovery, {
    ownerId: hunt.ownerId,
    discoveryBrief: hunt.discoveryBrief ?? {},
    breadth,
    market: hunt.market,
    money: hunt.money,
  })) as Array<{ label: string; rationale: string; searchTerms: string }>;
  const settled = await Promise.allSettled(
    seeds.slice(0, 3).map(async (seed) => {
      const results = (await ctx.runAction(internal.firecrawl.search, {
        query: buildGuidedLaneQuery(hunt, seed.searchTerms),
        ...searchScopeForHunt(hunt),
        // Three lanes × four results remains bounded while making an initial
        // human-language brief meaningfully more resilient than one giant query.
        limit: 4,
      })) as SearchResult[];
      return { seed, results };
    }),
  );

  const lanes: GuidedDiscoveryLane[] = [];
  const resultGroups: SearchResult[][] = [];
  for (let index = 0; index < settled.length; index++) {
    const attempt = settled[index];
    const seed = seeds[index];
    if (!seed) continue;
    if (attempt.status === "fulfilled") {
      const resultCount = attempt.value.results.length;
      lanes.push({
        ...seed,
        resultCount,
        status: resultCount > 0 ? "sources_found" : "no_sources",
      });
      resultGroups.push(attempt.value.results);
    } else {
      // One source/search direction should not turn an otherwise useful scout
      // run into a failed mission. The dashboard records this distinction.
      lanes.push({ ...seed, resultCount: 0, status: "unavailable" });
    }
  }
  const results = dedupeSearchResults(resultGroups.flat());
  const plan = {
    breadth,
    searchedAt: Date.now(),
    sourceCount: results.length,
    lanes,
  };
  await ctx.runMutation(internal.hunts.saveDiscoveryPlan, {
    huntId: hunt._id,
    plan,
  });
  for (const lane of lanes) {
    const summary =
      lane.status === "sources_found"
        ? `Explored ${lane.label}: ${lane.resultCount} listing source${lane.resultCount === 1 ? "" : "s"}`
        : lane.status === "no_sources"
          ? `Explored ${lane.label}: no listing sources surfaced`
          : "One guided search direction was unavailable; the other directions continued";
    await logActivity(ctx, hunt._id, hunt.ownerId, "discovery_lane_checked", summary);
  }
  return { results, sourceCount: results.length, lanes };
}

function isPermittedSource(hunt: HuntDoc, url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  const included = hunt.sourcePreferences?.includeDomains ?? [];
  const explicitlyExcluded = hunt.sourcePreferences?.excludeDomains ?? [];
  if (explicitlyExcluded.some(matches)) return false;
  if (included.length > 0) return included.some(matches);
  return !DEFAULT_DISCOVERY_EXCLUDED_DOMAINS.some(matches);
}

function userSuppliedListingResults(hunt: HuntDoc): SearchResult[] {
  return [...new Set(hunt.sourceUrls ?? [])].map((url) => {
    const profile = profileForUrl(url);
    return {
      title: "Listing shared by you",
      url,
      description: "A public listing link supplied for a source check.",
      markdown: "",
      summary: "",
      sourceContext: sourceContextForUrl(profile, url),
    };
  });
}

function describeItem(category: string, spec: Record<string, unknown>): string {
  if (category === "hypercar") {
    const parts = [spec.minYear, spec.make, spec.model, spec.variant].filter(Boolean);
    return `${parts.join(" ")} enthusiast car`;
  }
  if (category === "watch") return `${spec.brand} watch`;
  if (category === "salvage_flip")
    return spec.salvageOnly ? "salvage-title vehicle" : "vehicle";
  if (category === "reservation")
    return `reservation at ${spec.venueName || "your venue"}`;
  return category;
}

function draftOutreachBody(
  hunt: HuntDoc,
  verification: VerificationResult,
  result: SearchResult,
): string {
  const value =
    verification.listingPriceMinor !== undefined && verification.listingCurrency
      ? formatMoney(verification.listingPriceMinor, verification.listingCurrency)
      : verification.extractedValue !== undefined
        ? verification.extractedValue.toLocaleString()
        : "the asking price";
  const budget = huntBudgetLabel(hunt) ?? "the target budget";
  let body = `Hi there,\n\nI'm reaching out about this listing: ${result.title || result.url}.\n\n`;

  if (hunt.direction === "above" && hunt.threshold !== undefined) {
    body +=
      `I'm looking for ${describeItem(hunt.category, hunt.spec)} priced above ${budget}. ` +
      `Your listing at ${value} appears to meet this criteria. ` +
      `Are you open to selling? I'd like to discuss terms.\n\n`;
  } else if (hunt.direction === "below" && hunt.threshold !== undefined) {
    body +=
      `I'm looking for ${describeItem(hunt.category, hunt.spec)} priced below ${budget}. ` +
      `Your listing at ${value} appears to fit within this budget. ` +
      `Are you open to selling? Let's talk.\n\n`;
  } else {
    body +=
      `I'm looking for ${describeItem(hunt.category, hunt.spec)}. ` +
      `Your listing appears to match the criteria. ` +
      `Are you open to selling? I'd like to discuss.\n\n`;
  }
  return `${body}Best regards,\nJamanyo\n`;
}

function resultsReplyBody(hunt: HuntDoc, matches: ClearedMatch[]): string {
  const visibleMatches = matches.slice(0, 10);
  const introduction =
    hunt.experienceProfile === "collector"
      ? "Your Acquisition Desk has"
      : hunt.experienceProfile === "deal_radar"
        ? "Deal Radar found"
        : "I found";
  const intro =
    matches.length === 1
      ? `${introduction} a newly found potential match:`
      : `${introduction} ${matches.length} newly found potential matches:`;
  const items = visibleMatches
    .map((match, index) => {
      const priceLabel =
        match.priceType === "current_bid"
          ? "current bid "
          : match.priceType === "buy_now"
            ? "buy now "
            : "asking ";
      const value =
        match.listingPriceMinor !== undefined && match.listingCurrency
          ? ` — ${priceLabel}${formatMoney(match.listingPriceMinor, match.listingCurrency)}`
          : match.extractedValue !== undefined
            ? ` — ${priceLabel}${match.extractedValue.toLocaleString()}`
            : "";
      const detail = match.matchDetail ? `\n${match.matchDetail.slice(0, 300)}` : "";
      const reasons = match.matchReasons?.length
        ? `\nWhy it stands out: ${match.matchReasons.join("; ")}`
        : "";
      const auctionNote =
        match.priceType === "current_bid"
          ? "\nAuction note: this is a live current bid, not a fixed asking price; it can rise before close."
          : "";
      const confidence =
        match.availability || match.sellerTrust
          ? `\nAvailability: ${match.availability ?? "unknown"}; source trust: ${match.sellerTrust ?? "unknown"}`
          : "";
      return `${index + 1}. ${match.title || "Match"}${value}\n${match.url}${detail}${reasons}${auctionNote}${confidence}`;
    })
    .join("\n\n");
  const remainder =
    matches.length > visibleMatches.length
      ? `\n\n${matches.length - visibleMatches.length} more matches are available in your dashboard.`
      : "";
  return `${intro}\n\n${items}${remainder}\n\nThese are signals from available listing information, not a vehicle inspection, title check, valuation, or guarantee. Confirm condition, history, availability, and terms directly.\n\nReply to this thread if you want me to refine or pause the hunt.`;
}

async function logActivity(
  ctx: ActionCtx,
  huntId: Id<"hunts">,
  ownerId: string,
  actionName: string,
  summary: string,
): Promise<void> {
  await ctx.runMutation(internal.eventsLog.logEvent, {
    ownerId,
    table: "hunts",
    rowId: huntId as unknown as string,
    action: actionName,
    summary,
  });
}

type NotificationThread = {
  messageId: string;
  threadId?: string;
};

export type HuntNotificationDelivery =
  | "sent"
  | "queued"
  | "disabled"
  | "unavailable";

type LocalClock = {
  dateKey: string;
  hour: number;
  minute: number;
};

function clockInTimeZone(timestamp: number, timeZone: string): LocalClock {
  const fallback = (): LocalClock => {
    const date = new Date(timestamp);
    return {
      dateKey: [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
        .map((value) => String(value).padStart(2, "0"))
        .join("-"),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  };

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (name: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === name)?.value);
    const year = part("year");
    const month = part("month");
    const day = part("day");
    const hour = part("hour");
    const minute = part("minute");
    if (![year, month, day, hour, minute].every(Number.isFinite)) return fallback();
    return {
      dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      hour,
      minute,
    };
  } catch {
    return fallback();
  }
}

function isQuietHour(
  hour: number,
  quietHoursStart: number | undefined,
  quietHoursEnd: number | undefined,
): boolean {
  if (
    quietHoursStart === undefined ||
    quietHoursEnd === undefined ||
    quietHoursStart === quietHoursEnd
  ) {
    return false;
  }
  return quietHoursStart < quietHoursEnd
    ? hour >= quietHoursStart && hour < quietHoursEnd
    : hour >= quietHoursStart || hour < quietHoursEnd;
}

function nextLocalHour(
  timestamp: number,
  clock: LocalClock,
  targetHour: number,
): number {
  const currentMinuteOfDay = clock.hour * 60 + clock.minute;
  let minutesUntil = targetHour * 60 - currentMinuteOfDay;
  if (minutesUntil <= 0) minutesUntil += 24 * 60;
  return timestamp + minutesUntil * 60_000 - (timestamp % 60_000);
}

function notificationPlan(
  hunt: HuntDoc,
): { scheduledAt: number; coalesceKey: string; reason: "quiet_hours" | "daily_digest" } | null {
  const now = Date.now();
  const timeZone = hunt.timeZone ?? "UTC";
  const clock = clockInTimeZone(now, timeZone);
  if (isQuietHour(clock.hour, hunt.quietHoursStart, hunt.quietHoursEnd)) {
    const scheduledAt = nextLocalHour(now, clock, hunt.quietHoursEnd!);
    const scheduledClock = clockInTimeZone(scheduledAt, timeZone);
    return {
      scheduledAt,
      coalesceKey: `quiet:${hunt._id}:${scheduledClock.dateKey}:${scheduledClock.hour}`,
      reason: "quiet_hours",
    };
  }

  // Urgent missions can bypass a digest, but never a stated quiet period.
  if (hunt.notificationCadence !== "daily_digest" || hunt.urgency === "urgent") {
    return null;
  }

  const digestHour = isQuietHour(9, hunt.quietHoursStart, hunt.quietHoursEnd)
    ? hunt.quietHoursEnd!
    : 9;
  const scheduledAt = nextLocalHour(now, clock, digestHour);
  const scheduledClock = clockInTimeZone(scheduledAt, timeZone);
  return {
    scheduledAt,
    coalesceKey: `digest:${hunt._id}:${scheduledClock.dateKey}:${digestHour}`,
    reason: "daily_digest",
  };
}

async function getNotificationInbox(
  ctx: ActionCtx,
  hunt: HuntDoc,
): Promise<{ inboxId: string; email: string; ownerEmail?: string } | null> {
  const inbox = await ctx.runQuery(internal.inbox.getByOwner, {
    ownerId: hunt.ownerId,
  });
  if (!inbox || inbox.status !== "active") return null;
  const mappings = await ctx.runQuery(internal.inbox.getByInbox, {
    inboxId: inbox.inboxId,
  });
  if (
    mappings.length !== 1 ||
    mappings[0].ownerId !== hunt.ownerId ||
    mappings[0].status !== "active"
  ) {
    return null;
  }

  if (hunt.inboxId !== inbox.inboxId || hunt.inboxEmail !== inbox.email) {
    await ctx.runMutation(internal.hunts.setInbox, {
      huntId: hunt._id,
      inboxId: inbox.inboxId,
      inboxEmail: inbox.email,
    });
    hunt.inboxId = inbox.inboxId;
    hunt.inboxEmail = inbox.email;
  }
  return {
    inboxId: inbox.inboxId,
    email: inbox.email,
    ownerEmail: inbox.ownerEmail,
  };
}

function notificationVehicleName(hunt: HuntDoc): string | undefined {
  const fields = ["make", "model", "generation", "variant"];
  const name = fields
    .map((field) => hunt.spec[field])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().slice(0, 80))
    .join(" ");
  return name || undefined;
}

export function dashboardNotificationTitle(hunt: HuntDoc): string {
  const vehicle = notificationVehicleName(hunt);
  if (hunt.monitorPurpose === "auction") {
    return `${vehicle ?? "This listing"} Auction Watch`;
  }
  return vehicle ? `${vehicle} hunt` : `${hunt.category} hunt`;
}

export function dashboardNotificationBody(hunt: HuntDoc): string {
  const title = dashboardNotificationTitle(hunt);
  const status =
    hunt.status === "paused"
      ? "It is paused right now, so Jamanyo will not run another check or send watch alerts until you resume it."
      : hunt.mode === "monitor" && hunt.monitorStatus === "needs_attention"
        ? "It needs attention before Jamanyo can reliably keep watching; the dashboard has the current watch health."
        : hunt.mode === "monitor"
          ? `It is active. I’ll email only material public-listing changes${hunt.monitorPurpose === "auction" ? " and timing milestones" : ""}.`
          : "It is ready. I’ll email potential matches and material source changes.";
  return (
    `Your ${title} is now connected to this email thread.\n\n${status}\n\n` +
    "Reply here if you want to check its status, pause it, or resume it. You can also manage the same mission in your dashboard."
  );
}

export function dashboardNotificationSubject(hunt: HuntDoc): string {
  return `Jamanyo update: ${dashboardNotificationTitle(hunt)}`;
}

export function canStartDashboardEmailThread(hunt: HuntDoc): boolean {
  // A paused mission still benefits from one clear connection/status note.
  // Future hunt and monitor notifications remain suppressed until it resumes.
  return hunt.status !== "deleting" && hunt.status !== "archived";
}

async function ensureDashboardNotificationThreadForHunt(
  ctx: ActionCtx,
  hunt: HuntDoc,
): Promise<NotificationThread | null> {
  if (hunt.sourceMessageId || hunt.notifyByEmail === false) return null;
  if (hunt.notificationMessageId) {
    return {
      messageId: hunt.notificationMessageId,
      threadId: hunt.notificationThreadId,
    };
  }

  const inbox = await getNotificationInbox(ctx, hunt);
  if (!inbox?.ownerEmail) {
    await ctx.runMutation(internal.hunts.setNotificationStatus, {
      huntId: hunt._id,
      status: "unavailable",
    });
    return null;
  }

  try {
    await ctx.runMutation(internal.rateLimit.consumeEmail, {
      ownerId: hunt.ownerId,
    });
    const sent = await ctx.runAction(internal.mail.sendEmail, {
      ownerId: hunt.ownerId,
      inboxId: inbox.inboxId,
      to: inbox.ownerEmail,
      subject: dashboardNotificationSubject(hunt),
      text: dashboardNotificationBody(hunt),
      idempotencyKey: `hunt-notification:${hunt._id}`,
    });
    await ctx.runMutation(internal.agentThreads.recordOutbound, {
      ownerId: hunt.ownerId,
      inboxId: inbox.inboxId,
      messageId: sent.messageId,
      threadId: sent.threadId,
      to: inbox.ownerEmail,
      subject: dashboardNotificationSubject(hunt),
      text: dashboardNotificationBody(hunt),
      sentAt: Date.now(),
      huntId: hunt._id,
    });
    await ctx.runMutation(internal.hunts.setNotificationThread, {
      huntId: hunt._id,
      messageId: sent.messageId,
      threadId: sent.threadId,
    });
    hunt.notificationMessageId = sent.messageId;
    hunt.notificationThreadId = sent.threadId;
    hunt.notificationStatus = "active";
    await logActivity(
      ctx,
      hunt._id,
      hunt.ownerId,
      "email_notification_thread_ready",
      "Connected this dashboard hunt to an email thread",
    );
    return { messageId: sent.messageId, threadId: sent.threadId };
  } catch {
    await ctx.runMutation(internal.hunts.setNotificationStatus, {
      huntId: hunt._id,
      status: "failed",
    });
    await logActivity(
      ctx,
      hunt._id,
      hunt.ownerId,
      "email_notification_setup_failed",
      "Could not prepare email updates; the dashboard remains available",
    );
    return null;
  }
}

export const ensureDashboardNotificationThread = internalAction({
  args: { huntId: v.id("hunts") },
  returns: v.object({ ready: v.boolean() }),
  handler: async (ctx, args): Promise<{ ready: boolean }> => {
    const hunt: HuntDoc | null = (await ctx.runQuery(
      internal.hunts.getByIdInternal,
      { huntId: args.huntId },
    )) as HuntDoc | null;
    if (!hunt || !canStartDashboardEmailThread(hunt)) return { ready: false };
    const thread = await ensureDashboardNotificationThreadForHunt(ctx, hunt);
    return { ready: Boolean(thread) };
  },
});

async function sendHuntNotificationNow(
  ctx: ActionCtx,
  hunt: HuntDoc,
  args: { text: string; idempotencyKey: string },
): Promise<HuntNotificationDelivery> {
  const current: HuntDoc | null = (await ctx.runQuery(
    internal.hunts.getByIdInternal,
    { huntId: hunt._id },
  )) as HuntDoc | null;
  if (!current || current.ownerId !== hunt.ownerId || current.status !== "active") {
    return "disabled";
  }
  if (!hunt.sourceMessageId && hunt.notifyByEmail === false) {
    return "disabled";
  }

  const inbox = await getNotificationInbox(ctx, hunt);
  if (!inbox) return "unavailable";

  const thread = hunt.sourceMessageId
    ? { messageId: hunt.sourceMessageId }
    : await ensureDashboardNotificationThreadForHunt(ctx, hunt);
  if (!thread?.messageId) return "unavailable";

  await ctx.runMutation(internal.rateLimit.consumeEmail, {
    ownerId: hunt.ownerId,
  });
  const sent = await ctx.runAction(internal.mail.replyToMessage, {
    ownerId: hunt.ownerId,
    inboxId: inbox.inboxId,
    messageId: thread.messageId,
    text: args.text,
    idempotencyKey: args.idempotencyKey,
  });
  await ctx.runMutation(internal.agentThreads.recordOutbound, {
    ownerId: hunt.ownerId,
    inboxId: inbox.inboxId,
    messageId: sent.messageId,
    threadId: sent.threadId,
    text: args.text,
    sentAt: Date.now(),
    huntId: hunt._id,
  });
  return "sent";
}

export async function deliverHuntNotification(
  ctx: ActionCtx,
  hunt: HuntDoc,
  args: { text: string; idempotencyKey: string },
): Promise<HuntNotificationDelivery> {
  const current: HuntDoc | null = (await ctx.runQuery(
    internal.hunts.getByIdInternal,
    { huntId: hunt._id },
  )) as HuntDoc | null;
  if (!current || current.ownerId !== hunt.ownerId || current.status !== "active") {
    return "disabled";
  }
  if (!hunt.sourceMessageId && hunt.notifyByEmail === false) {
    return "disabled";
  }

  const plan = notificationPlan(hunt);
  if (!plan) return await sendHuntNotificationNow(ctx, hunt, args);

  const queued = await ctx.runMutation(internal.notifications.enqueue, {
    huntId: hunt._id,
    ownerId: hunt.ownerId,
    text: args.text,
    idempotencyKey: args.idempotencyKey,
    coalesceKey: plan.coalesceKey,
    scheduledAt: plan.scheduledAt,
  });
  if (queued.shouldSchedule) {
    await ctx.scheduler.runAfter(
      Math.max(0, plan.scheduledAt - Date.now()),
      internal.hunt.dispatchQueuedNotification,
      { notificationId: queued.notificationId },
    );
  }
  return "queued";
}

export const dispatchQueuedNotification = internalAction({
  args: { notificationId: v.id("notificationQueue") },
  returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, args): Promise<{ delivered: boolean }> => {
    const notification = await ctx.runMutation(internal.notifications.claim, {
      notificationId: args.notificationId,
    });
    if (!notification) return { delivered: false };

    const hunt: HuntDoc | null = (await ctx.runQuery(
      internal.hunts.getByIdInternal,
      { huntId: notification.huntId },
    )) as HuntDoc | null;
    if (!hunt || hunt.ownerId !== notification.ownerId || hunt.status === "deleting") {
      await ctx.runMutation(internal.notifications.markStatus, {
        notificationId: notification._id,
        status: "unavailable",
      });
      return { delivered: false };
    }

    try {
      const delivery = await sendHuntNotificationNow(ctx, hunt, {
        text: notification.text,
        idempotencyKey: notification.idempotencyKey,
      });
      await ctx.runMutation(internal.notifications.markStatus, {
        notificationId: notification._id,
        status: delivery === "sent" ? "sent" : delivery,
      });
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        delivery === "sent" ? "queued_email_sent" : "queued_email_not_sent",
        delivery === "sent"
          ? "Delivered a scheduled scout update by email"
          : "Scheduled email update was not sent; dashboard activity remains available",
      );
      return { delivered: delivery === "sent" };
    } catch (error: unknown) {
      const retry = await ctx.runMutation(internal.notifications.rescheduleAfterFailure, {
        notificationId: notification._id,
        error: "Email delivery failed",
      });
      if (retry.scheduled && retry.delayMs !== undefined) {
        await ctx.scheduler.runAfter(retry.delayMs, internal.hunt.dispatchQueuedNotification, {
          notificationId: notification._id,
        });
      }
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        retry.scheduled ? "queued_email_retrying" : "queued_email_unavailable",
        retry.scheduled
          ? "Scheduled email update will retry automatically; dashboard activity remains available"
          : "Scheduled email update was unavailable after retries; dashboard activity remains available",
      );
      return { delivered: false };
    }
  },
});

export const retryQueuedNotifications = internalAction({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const reclaimed = await ctx.runMutation(internal.notifications.requeueStale, {});
    const due = await ctx.runQuery(internal.notifications.listDue, { now: Date.now() });
    const notificationIds = [...new Set([...reclaimed, ...due])];
    for (const notificationId of notificationIds) {
      await ctx.scheduler.runAfter(0, internal.hunt.dispatchQueuedNotification, {
        notificationId,
      });
    }
    return { scheduled: notificationIds.length };
  },
});

export const expireMission = internalAction({
  args: { huntId: v.id("hunts") },
  returns: v.object({ archived: v.boolean(), monitorStopped: v.boolean() }),
  handler: async (ctx, args): Promise<{ archived: boolean; monitorStopped: boolean }> => {
    const hunt: HuntDoc | null = (await ctx.runQuery(
      internal.hunts.getByIdInternal,
      { huntId: args.huntId },
    )) as HuntDoc | null;
    if (!hunt || hunt.expiresAt === undefined) {
      return { archived: false, monitorStopped: false };
    }
    if (hunt.status === "deleting") {
      return { archived: false, monitorStopped: true };
    }
    if (hunt.expiresAt > Date.now()) {
      await ctx.scheduler.runAfter(
        hunt.expiresAt - Date.now(),
        internal.hunt.expireMission,
        { huntId: hunt._id },
      );
      return { archived: false, monitorStopped: false };
    }

    let monitorStopped = false;
    if (hunt.mode === "monitor" && hunt.monitorId) {
      try {
        monitorStopped = await ctx.runAction(internal.firecrawl.deleteMonitor, {
          huntId: hunt._id,
          ownerId: hunt.ownerId,
          monitorId: hunt.monitorId,
        });
      } catch {
        await logActivity(
          ctx,
          hunt._id,
          hunt.ownerId,
          "monitor_stop_failed",
          "The mission expired; the dashboard is archived while monitor shutdown is retried on its next callback",
        );
      }
    }
    if (hunt.status !== "archived") {
      await ctx.runMutation(internal.hunts.setStatus, {
        huntId: hunt._id,
        status: "archived",
      });
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        hunt.mode === "monitor" ? "monitor_expired" : "hunt_expired",
        "Archived this mission because its requested end time passed",
      );
    }
    return { archived: true, monitorStopped };
  },
});

async function executeHunt(
  ctx: ActionCtx,
  hunt: HuntDoc,
  runId: Id<"huntRuns">,
): Promise<{ candidatesFound: number; cleared: number }> {
  const isListingReview = hunt.missionIntent === "listing_review";
  const isGuidedDiscovery = hunt.missionIntent === "guided";
  await logActivity(
    ctx,
    hunt._id,
    hunt.ownerId,
    "hunt_started",
    isGuidedDiscovery
      ? "Started guided car discovery"
      : isListingReview
        ? "Started a listing check"
        : `Started ${hunt.direction} hunt for ${hunt.category}`,
  );

  const guidedOutcome = isGuidedDiscovery
    ? await searchGuidedVehicleLanes(ctx, hunt)
    : undefined;
  const knownVehicleSearch = !isListingReview && !guidedOutcome
    ? await searchKnownVehicleMarket(ctx, hunt)
    : undefined;
  const results = isListingReview
    ? userSuppliedListingResults(hunt)
    : guidedOutcome
      ? guidedOutcome.results
      : knownVehicleSearch?.results ?? [];
  await logActivity(
    ctx,
    hunt._id,
    hunt.ownerId,
    "source_checked",
    isListingReview
      ? `Checked ${results.length} listing link${results.length === 1 ? "" : "s"} you shared`
      : guidedOutcome
      ? `Explored ${guidedOutcome.lanes.length} guided directions and found ${guidedOutcome.sourceCount} listing source${guidedOutcome.sourceCount === 1 ? "" : "s"}`
        : `The selected source portfolio returned ${results.length} page${results.length === 1 ? "" : "s"} for evidence review${knownVehicleSearch?.broadened ? " after one broader fallback" : ""}`,
  );
  const feedback = (await ctx.runQuery(internal.huntFeedback.listRecentInternal, {
    huntId: hunt._id,
  })) as Array<{
    kind: "good_lead" | "wrong_style" | "too_expensive" | "too_far" | "not_trusted";
    note?: string;
  }>;
  const feedbackContext = feedback.map((item) => ({
    kind: item.kind,
    note: item.note,
  }));

  let cleared = 0;
  const newlyCleared: ClearedMatch[] = [];
  for (const result of results) {
    const current: HuntDoc | null = (await ctx.runQuery(
      internal.hunts.getByIdInternal,
      { huntId: hunt._id },
    )) as HuntDoc | null;
    if (!current || current.ownerId !== hunt.ownerId || current.status !== "active") {
      // Deletion and pause both take effect between source checks, preventing
      // a long-running provider pass from spending more LLM capacity or
      // creating fresh records after the user changes its state.
      return { candidatesFound: results.length, cleared };
    }
    if (!isListingReview && !isPermittedSource(hunt, result.url)) {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "source_skipped",
        `Skipped a source outside this mission's trust preferences`,
      );
      continue;
    }
    if (
      !isListingReview &&
      result.sourceContext?.resultRole === "market_context"
    ) {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "source_market_context_seen",
        `${result.sourceContext.sourceLabel} supplied market context; Jamanyo is waiting for an individual vehicle page before treating it as a lead`,
      );
      continue;
    }
    await logActivity(ctx, hunt._id, hunt.ownerId, "candidate_found", result.url);

    let rawContent = [result.markdown, result.summary, result.description]
      .filter(Boolean)
      .join("\n\n");
    let fetchedFrom: "search" | "scrape" = "search";
    let sourceInspection: "inspected" | "limited" = "limited";
    let listingTitle = result.title;
    let listingImageUrl = result.imageUrl;
    try {
      const page = await ctx.runAction(internal.firecrawl.scrape, {
        url: result.url,
      });
      if (page.kind === "scraped") {
        rawContent = [page.markdown, page.summary, page.title]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 20000);
        fetchedFrom = "scrape";
        sourceInspection = "inspected";
        listingTitle = page.title || listingTitle;
        listingImageUrl = page.imageUrl ?? listingImageUrl;
      } else {
        await logActivity(
          ctx,
          hunt._id,
          hunt.ownerId,
          "source_scrape_limited",
          "A listing source blocked detailed inspection; continuing with available listing information",
        );
      }
    } catch (error: unknown) {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "source_scrape_failed",
        `Could not scrape ${result.url}; continuing with available listing information`,
      );
    }

    if (!rawContent.trim()) {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "source_empty",
        `No readable content for ${result.url}`,
      );
      continue;
    }

    await ctx.runMutation(internal.rateLimit.consumeOpenai, {
      ownerId: hunt.ownerId,
    });
    const verification = (await ctx.runAction(internal.verify.verifyCandidate, {
      category: hunt.category,
      direction: hunt.direction,
      threshold: hunt.threshold,
      spec: hunt.spec,
      market: hunt.market,
      money: hunt.money,
      serendipity: hunt.serendipity,
      experienceProfile: hunt.experienceProfile,
      discoveryBrief: hunt.discoveryBrief,
      feedback: feedbackContext,
      sourceContext: result.sourceContext,
      rawContent: rawContent.slice(0, 12000),
      sourceUrl: result.url,
    })) as VerificationResult;
    const enrichedVerification: VerificationResult = { ...verification };
    const safeTitle = safeListingTitle(listingTitle);
    const safeImageUrl = safeListingImageUrl(listingImageUrl);
    if (safeTitle) enrichedVerification.listingTitle = safeTitle;
    if (safeImageUrl) enrichedVerification.listingImageUrl = safeImageUrl;

    // Treat a source's own closed/sold wording as stronger evidence than a
    // model's inference from a price field. This prevents an old auction bid
    // from becoming a time-sensitive lead after an auction has ended.
    if (sourceClearlySaysListingClosed(listingTitle, rawContent)) {
      enrichedVerification.passed = false;
      enrichedVerification.availability = "unavailable";
      enrichedVerification.priceType = "market_context";
      enrichedVerification.flags = [
        ...new Set([
          ...enrichedVerification.flags.filter((flag) => flag !== "auction_price_can_change"),
          "source_says_listing_closed",
          "historical_price_not_actionable",
        ]),
      ];
      enrichedVerification.matchReasons = [
        ...new Set([
          "The source page indicates that this listing has closed or sold",
          ...(enrichedVerification.matchReasons ?? []),
        ]),
      ].slice(0, 6);
    }

    const hasExplicitPrice =
      enrichedVerification.listingPriceMinor !== undefined ||
      enrichedVerification.extractedValue !== undefined;
    const priceSupportsDecision =
      enrichedVerification.priceType === "asking_price" ||
      enrichedVerification.priceType === "buy_now" ||
      enrichedVerification.priceType === "current_bid";
    const hasSpecificListing =
      enrichedVerification.listingKind === "specific_listing";
    const hasConfirmedAvailability =
      enrichedVerification.availability === "available";
    const requiresExplicitPrice = hunt.direction !== "match";
    const qualifiesAsLead =
      enrichedVerification.passed &&
      sourceInspection === "inspected" &&
      hasSpecificListing &&
      hasConfirmedAvailability &&
      (!requiresExplicitPrice || (hasExplicitPrice && priceSupportsDecision));
    const disposition: "potential_lead" | "research" | "source_unavailable" =
      qualifiesAsLead
        ? "potential_lead"
        : sourceInspection === "limited"
          ? "source_unavailable"
          : "research";
    const eligibilityFlags = [
      sourceInspection !== "inspected" ? "source_inspection_limited" : undefined,
      sourceInspection === "inspected" && !hasSpecificListing
        ? "not_a_specific_listing"
        : undefined,
      sourceInspection === "inspected" && !hasConfirmedAvailability
        ? "availability_not_confirmed"
        : undefined,
      sourceInspection === "inspected" && requiresExplicitPrice && !hasExplicitPrice
        ? "price_not_explicit"
        : undefined,
      sourceInspection === "inspected" &&
      requiresExplicitPrice &&
      hasExplicitPrice &&
      !priceSupportsDecision
        ? "price_not_actionable"
        : undefined,
    ].filter((flag): flag is string => Boolean(flag));
    if (eligibilityFlags.length > 0) {
      enrichedVerification.flags = [
        ...new Set([...enrichedVerification.flags, ...eligibilityFlags]),
      ];
    }

    await logActivity(
      ctx,
      hunt._id,
      hunt.ownerId,
      "verification_run",
      `passed=${verification.passed} disposition=${disposition} confidence=${verification.confidence}`,
    );

    try {
      const candidate = await ctx.runMutation(internal.candidates.insertVerified, {
        huntId: hunt._id,
        sourceUrl: result.url,
        verification: enrichedVerification,
        disposition,
        sourceInspection,
        fetchedFrom,
      });

      if (disposition === "potential_lead") {
        cleared++;
        await logActivity(
          ctx,
          hunt._id,
          hunt.ownerId,
          "candidate_cleared",
          `Match found: ${result.url}`,
        );
        if (candidate.shouldNotify) {
          newlyCleared.push({
            candidateId: candidate.candidateId,
            title: result.title,
            url: result.url,
            extractedValue: enrichedVerification.extractedValue,
            matchDetail: enrichedVerification.matchDetail,
            listingPriceMinor: enrichedVerification.listingPriceMinor,
            listingCurrency: enrichedVerification.listingCurrency,
            priceType: enrichedVerification.priceType,
            estimatedTotalMinor: enrichedVerification.estimatedTotalMinor,
            availability: enrichedVerification.availability,
            sellerTrust: enrichedVerification.sellerTrust,
            matchReasons: enrichedVerification.matchReasons,
          });
        }
        if (
          hunt.contactPolicy !== "alerts_only" &&
          verification.contactEmail &&
          /\S+@\S+\.\S+/.test(verification.contactEmail)
        ) {
          await ctx.runAction(internal.outreach.draftOutreach, {
            huntId: hunt._id,
            candidateId: candidate.candidateId,
            contactEmail: verification.contactEmail,
            sourceUrl: result.url,
            draftBody: draftOutreachBody(hunt, verification, result),
          });
        } else if (hunt.contactPolicy === "alerts_only") {
          await logActivity(
            ctx,
            hunt._id,
            hunt.ownerId,
            "outreach_held",
            "Match recorded without drafting seller outreach under this mission's alert-only policy",
          );
        }
      }
    } catch (error: unknown) {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "candidate_insert_failed",
        `Could not record ${result.url}`,
      );
    }
  }

  if (newlyCleared.length > 0) {
    const delivery = await deliverHuntNotification(ctx, hunt, {
      text: resultsReplyBody(hunt, newlyCleared),
      idempotencyKey: `hunt-results:${runId}`,
    });
    if (delivery === "sent" || delivery === "queued" || delivery === "disabled") {
      await ctx.runMutation(internal.candidates.markNotified, {
        candidateIds: newlyCleared.map((match) => match.candidateId),
      });
    }
    if (delivery === "sent") {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "hunt_results_emailed",
        `Sent ${newlyCleared.length} new matches to the ${
          hunt.sourceMessageId ? "request" : "dashboard notification"
        } thread`,
      );
    } else if (delivery === "queued") {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "hunt_results_queued",
        `${newlyCleared.length} new matches are queued for the configured alert window`,
      );
    } else if (delivery === "disabled") {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "hunt_results_recorded",
        `${newlyCleared.length} new matches are available in the dashboard`,
      );
    } else {
      await logActivity(
        ctx,
        hunt._id,
        hunt.ownerId,
        "hunt_results_recorded",
        `${newlyCleared.length} new matches are available in the dashboard; email delivery is unavailable`,
      );
    }
  }

  await logActivity(
    ctx,
    hunt._id,
    hunt.ownerId,
    "hunt_completed",
    isGuidedDiscovery && results.length === 0 && guidedOutcome?.lanes.every((lane) => lane.status === "unavailable")
      ? "The guided search service was temporarily unavailable; no market conclusion was drawn"
      : isGuidedDiscovery && results.length === 0
        ? "No listing sources came back from this pass; this is a search outcome, not a market verdict"
      : isGuidedDiscovery
        ? `Screened ${results.length} listing source${results.length === 1 ? "" : "s"}, ${cleared} potential lead${cleared === 1 ? "" : "s"}`
        : `Processed ${results.length} candidates, ${cleared} cleared`,
  );
  return { candidatesFound: results.length, cleared };
}

export const runHunt = action({
  args: { huntId: v.id("hunts") },
  returns: v.object({
    runId: v.id("huntRuns"),
    status: v.union(v.literal("queued"), v.literal("running")),
  }),
  handler: async (ctx, args): Promise<{
    runId: Id<"huntRuns">;
    status: "queued" | "running";
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt: HuntDoc | null = (await ctx.runQuery(
      internal.hunts.getByIdInternal,
      { huntId: args.huntId },
    )) as HuntDoc | null;
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    if (hunt.status !== "active") throw new Error("Hunt is paused or archived");
    if (hunt.expiresAt && hunt.expiresAt <= Date.now()) {
      await ctx.runMutation(internal.hunts.setStatus, {
        huntId: hunt._id,
        status: "archived",
      });
      throw new Error("This mission has expired and was archived");
    }
    const result = (await ctx.runMutation(internal.huntRuns.enqueueForHunt, {
      huntId: args.huntId,
      ownerId: identity.tokenIdentifier,
      trigger: "manual",
      idempotencyKey: `manual:${args.huntId}:${Date.now()}`,
    })) as { runId: Id<"huntRuns">; status: "queued" | "running" };
    return { runId: result.runId, status: result.status as "queued" | "running" };
  },
});

export const runHuntJob = internalAction({
  args: { runId: v.id("huntRuns") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.runMutation(internal.huntRuns.start, {
      runId: args.runId,
    });
    if (!run) return null;

    try {
      const hunt: HuntDoc | null = (await ctx.runQuery(
        internal.hunts.getByIdInternal,
        { huntId: run.huntId },
      )) as HuntDoc | null;
      if (!hunt) throw new Error("Hunt not found");
      if (hunt.expiresAt && hunt.expiresAt <= Date.now()) {
        await ctx.runMutation(internal.hunts.setStatus, {
          huntId: hunt._id,
          status: "archived",
        });
        await logActivity(
          ctx,
          hunt._id,
          hunt.ownerId,
          "hunt_expired",
          "Archived this mission because its requested end time passed",
        );
        await ctx.runMutation(internal.huntRuns.complete, {
          runId: args.runId,
          candidatesFound: 0,
          cleared: 0,
        });
        return null;
      }
      if (hunt.status !== "active") {
        await ctx.runMutation(internal.huntRuns.complete, {
          runId: args.runId,
          candidatesFound: 0,
          cleared: 0,
        });
        return null;
      }
      const result = await executeHunt(ctx, hunt as HuntDoc, args.runId);
      await ctx.runMutation(internal.huntRuns.complete, {
        runId: args.runId,
        candidatesFound: result.candidatesFound,
        cleared: result.cleared,
      });
    } catch (error: unknown) {
      await ctx.runMutation(internal.huntRuns.failOrRetry, {
        runId: args.runId,
        error: "A provider request failed while checking this mission",
      });
    }
    return null;
  },
});

export const runActiveHunts = internalAction({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), skipped: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ scheduled: number; skipped: number }> => {
    const result = (await ctx.runMutation(internal.huntRuns.enqueueActive, {
      cursor: args.cursor,
    })) as {
      scheduled: number;
      skipped: number;
      continueCursor?: string;
    };
    if (result.continueCursor) {
      await ctx.scheduler.runAfter(0, internal.hunt.runActiveHunts, {
        cursor: result.continueCursor,
      });
    }
    return { scheduled: result.scheduled, skipped: result.skipped };
  },
});
