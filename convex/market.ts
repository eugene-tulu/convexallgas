import { v } from "convex/values";

export const deliveryModeValidator = v.union(
  v.literal("pickup"),
  v.literal("shipping"),
  v.literal("either"),
);

export const notificationCadenceValidator = v.union(
  v.literal("instant"),
  v.literal("daily_digest"),
);

export const serendipityValidator = v.union(
  v.literal("exact"),
  v.literal("smart"),
  v.literal("delight"),
);

export const experienceProfileValidator = v.union(
  v.literal("collector"),
  v.literal("deal_radar"),
  v.literal("adaptive"),
);

// A car mission can start from a known vehicle, a human-language brief, or a
// public listing the user has already found. Keep the paths explicit so the
// search and verification steps know how much taxonomy they can rely on.
export const missionIntentValidator = v.union(
  v.literal("known_car"),
  v.literal("guided"),
  v.literal("listing_review"),
);

export const discoveryVibeValidator = v.union(
  v.literal("weekend_escape"),
  v.literal("first_proper_car"),
  v.literal("road_trip"),
  v.literal("hands_on_project"),
  v.literal("understated_fast"),
  v.literal("occasion_car"),
);

export const ownershipAppetiteValidator = v.union(
  v.literal("turn_key"),
  v.literal("learn_as_i_go"),
  v.literal("hands_on"),
);

export const discoveryBriefValidator = v.object({
  prompt: v.optional(v.string()),
  vibes: v.optional(v.array(discoveryVibeValidator)),
  ownershipAppetite: v.optional(ownershipAppetiteValidator),
});

// Guided discovery starts with a few deliberately different search directions
// rather than turning a person's whole brief into one brittle web query. The
// stored plan makes that first pass explainable without accumulating an
// unbounded research log on a hunt document.
export const discoverySearchBreadthValidator = v.union(
  v.literal("starting"),
  v.literal("wide"),
);

export const discoveryLaneSeedValidator = v.object({
  label: v.string(),
  rationale: v.string(),
  searchTerms: v.string(),
});

export const discoveryLaneStatusValidator = v.union(
  v.literal("sources_found"),
  v.literal("no_sources"),
  v.literal("unavailable"),
);

export const discoveryLaneValidator = discoveryLaneSeedValidator.extend({
  resultCount: v.number(),
  status: discoveryLaneStatusValidator,
});

export const discoveryPlanValidator = v.object({
  breadth: discoverySearchBreadthValidator,
  searchedAt: v.number(),
  sourceCount: v.number(),
  lanes: v.array(discoveryLaneValidator),
});

// These are content/community surfaces or known user-inaccessible marketplaces
// by default, rather than reliable individual-listing sources. A user may
// still explicitly restrict a mission to one of them through preferred domains,
// and a user-supplied listing URL is always inspected rather than silently
// discarded.
export const DEFAULT_DISCOVERY_EXCLUDED_DOMAINS = [
  "youtube.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "quora.com",
  "pinterest.com",
  // This marketplace frequently denies ordinary browser access (406) and can
  // leave users with a lead they cannot open. An explicit preferred-domain
  // choice remains an intentional override.
  "cargurus.com",
] as const;

export const contactPolicyValidator = v.union(
  v.literal("alerts_only"),
  v.literal("draft_for_review"),
);

export const urgencyValidator = v.union(
  v.literal("whenever"),
  v.literal("soon"),
  v.literal("urgent"),
);

export const vehicleBodyStyleValidator = v.union(
  v.literal("coupe"),
  v.literal("convertible"),
  v.literal("sedan"),
  v.literal("wagon"),
  v.literal("suv"),
  v.literal("truck"),
  v.literal("hatchback"),
  v.literal("other"),
  v.literal("either"),
);

export const vehicleOriginalityValidator = v.union(
  v.literal("original"),
  v.literal("modified"),
  v.literal("restomod"),
  v.literal("either"),
);

// A mission is intentionally broad enough for watches and reservations, while
// vehicle missions get the small amount of taxonomy that makes a real market
// comparison meaningful. Each field is optional so existing missions remain
// valid and an email can begin as a natural-language request.
export const huntSpecValidator = v.object({
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  generation: v.optional(v.string()),
  variant: v.optional(v.string()),
  minYear: v.optional(v.number()),
  maxYear: v.optional(v.number()),
  bodyStyle: v.optional(vehicleBodyStyleValidator),
  originality: v.optional(vehicleOriginalityValidator),
  brand: v.optional(v.string()),
  venueName: v.optional(v.string()),
  city: v.optional(v.string()),
  dateRangeStart: v.optional(v.number()),
  dateRangeEnd: v.optional(v.number()),
  partySize: v.optional(v.number()),
  salvageOnly: v.optional(v.boolean()),
  maxMileage: v.optional(v.number()),
  transmission: v.optional(
    v.union(v.literal("manual"), v.literal("automatic"), v.literal("either")),
  ),
  driveSide: v.optional(
    v.union(v.literal("left"), v.literal("right"), v.literal("either")),
  ),
  exteriorColor: v.optional(v.string()),
  mustHave: v.optional(v.string()),
  avoid: v.optional(v.string()),
});

export const marketValidator = v.object({
  countryCode: v.optional(v.string()),
  locality: v.optional(v.string()),
  radiusKm: v.optional(v.number()),
  deliveryMode: v.optional(deliveryModeValidator),
  allowedCountries: v.optional(v.array(v.string())),
  language: v.optional(v.string()),
});

export const moneyValidator = v.object({
  currency: v.string(),
  amountMinor: v.optional(v.number()),
  includesFees: v.boolean(),
});

export const sourcePreferencesValidator = v.object({
  includeDomains: v.optional(v.array(v.string())),
  excludeDomains: v.optional(v.array(v.string())),
});

// A marketplace's number is not always an asking price. Keeping its meaning
// alongside the amount prevents a live-auction bid or a market benchmark from
// masquerading as a fixed listing price in the dashboard or email.
export const listingFormatValidator = v.union(
  v.literal("classified"),
  v.literal("auction"),
  v.literal("market"),
  v.literal("unknown"),
);

export const listingPriceTypeValidator = v.union(
  v.literal("asking_price"),
  v.literal("current_bid"),
  v.literal("buy_now"),
  v.literal("market_context"),
  v.literal("unknown"),
);

export const sourceResultRoleValidator = v.union(
  v.literal("specific_listing"),
  v.literal("market_context"),
  v.literal("unknown"),
);

export const sourceContextValidator = v.object({
  sourceId: v.string(),
  sourceLabel: v.string(),
  listingFormat: listingFormatValidator,
  expectedPriceType: listingPriceTypeValidator,
  resultRole: sourceResultRoleValidator,
});

export const sourcePlanStatusValidator = v.union(
  v.literal("sources_found"),
  v.literal("no_sources"),
  v.literal("unavailable"),
  v.literal("skipped"),
);

export const sourcePlanEntryValidator = v.object({
  sourceId: v.string(),
  sourceLabel: v.string(),
  domains: v.array(v.string()),
  listingFormat: listingFormatValidator,
  expectedPriceType: listingPriceTypeValidator,
  status: sourcePlanStatusValidator,
  resultCount: v.number(),
  detail: v.string(),
});

// This bounded plan records the sources selected for one known-car pass. It
// makes discovery explainable without retaining every raw web search result.
export const sourcePlanValidator = v.object({
  searchedAt: v.number(),
  sourceCount: v.number(),
  entries: v.array(sourcePlanEntryValidator),
});

export const availabilityValidator = v.union(
  v.literal("available"),
  v.literal("unknown"),
  v.literal("unavailable"),
);

export const sellerTrustValidator = v.union(
  v.literal("unknown"),
  v.literal("reviewed"),
  v.literal("caution"),
);

// Discovery may surface useful context (market pages, editorials, or forum
// threads) alongside a real offer. Keep that distinction explicit so only a
// specific, inspectable listing can become a buyer-facing lead.
export const listingKindValidator = v.union(
  v.literal("specific_listing"),
  v.literal("research"),
  v.literal("unknown"),
);

export const candidateDispositionValidator = v.union(
  v.literal("potential_lead"),
  v.literal("research"),
  v.literal("source_unavailable"),
);

export const sourceInspectionValidator = v.union(
  v.literal("inspected"),
  v.literal("limited"),
  v.literal("user_reported_unavailable"),
);

export const feedbackKindValidator = v.union(
  v.literal("good_lead"),
  v.literal("wrong_style"),
  v.literal("too_expensive"),
  v.literal("too_far"),
  v.literal("not_trusted"),
);

export const verificationResultValidator = v.object({
  passed: v.boolean(),
  confidence: v.number(),
  flags: v.array(v.string()),
  contactEmail: v.string(),
  // These values come from the listing source, not from the model. They make
  // the dashboard more useful without turning a source image into a claim of
  // inspection or verification.
  listingTitle: v.optional(v.string()),
  listingImageUrl: v.optional(v.string()),
  extractedValue: v.optional(v.number()),
  matchDetail: v.optional(v.string()),
  listingPriceMinor: v.optional(v.number()),
  listingCurrency: v.optional(v.string()),
  priceType: v.optional(listingPriceTypeValidator),
  normalizedPriceMinor: v.optional(v.number()),
  normalizedCurrency: v.optional(v.string()),
  estimatedTotalMinor: v.optional(v.number()),
  availability: v.optional(availabilityValidator),
  sellerTrust: v.optional(sellerTrustValidator),
  listingKind: v.optional(listingKindValidator),
  sourceContext: v.optional(sourceContextValidator),
  matchReasons: v.optional(v.array(v.string())),
});
