// Jamanyo deliberately starts with a small, explainable source portfolio.
// This is not a claim that these are the only useful car marketplaces; it is
// the list whose navigation and price semantics we understand well enough to
// use as a first discovery pass. Other public sources still have a place in a
// bounded broad-web fallback or a buyer-submitted listing check.

export type ListingFormat = "classified" | "auction" | "market" | "unknown";
export type ListingPriceType =
  | "asking_price"
  | "current_bid"
  | "buy_now"
  | "market_context"
  | "unknown";
export type SourceResultRole = "specific_listing" | "market_context" | "unknown";

export type VehicleSourceProfile = {
  id: "classic" | "bring_a_trailer" | "hemmings";
  label: string;
  domains: readonly string[];
  listingFormat: ListingFormat;
  expectedPriceType: ListingPriceType;
  searchSuffix: string;
  directListingPathPrefixes: readonly string[];
  marketPathPrefixes: readonly string[];
  description: string;
};

export type SourceContext = {
  sourceId: string;
  sourceLabel: string;
  listingFormat: ListingFormat;
  expectedPriceType: ListingPriceType;
  resultRole: SourceResultRole;
};

export type SourcePreferencesLike = {
  includeDomains?: string[];
  excludeDomains?: string[];
};

export const VEHICLE_SOURCE_REGISTRY: readonly VehicleSourceProfile[] = [
  {
    id: "classic",
    label: "Classic.com",
    domains: ["classic.com"],
    listingFormat: "classified",
    expectedPriceType: "asking_price",
    searchSuffix: "for sale",
    directListingPathPrefixes: ["/veh/"],
    marketPathPrefixes: ["/m/"],
    description: "Collector-market context and individual vehicle records.",
  },
  {
    id: "bring_a_trailer",
    label: "Bring a Trailer",
    domains: ["bringatrailer.com"],
    listingFormat: "auction",
    expectedPriceType: "current_bid",
    searchSuffix: "live auction",
    directListingPathPrefixes: ["/listing/"],
    marketPathPrefixes: ["/auctions/"],
    description: "Live enthusiast auctions; the visible figure is normally a current bid.",
  },
  {
    id: "hemmings",
    label: "Hemmings",
    domains: ["hemmings.com"],
    listingFormat: "classified",
    expectedPriceType: "asking_price",
    searchSuffix: "classifieds for sale",
    directListingPathPrefixes: ["/classifieds/listing/", "/auction/"],
    marketPathPrefixes: ["/classifieds/cars-for-sale/"],
    description: "Classified and auction inventory with direct listing pages.",
  },
] as const;

function normalizedDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function hostnameForUrl(value: string): string | null {
  try {
    return normalizedDomain(new URL(value).hostname);
  } catch {
    return null;
  }
}

export function domainMatches(hostname: string, domain: string): boolean {
  const normalizedHost = normalizedDomain(hostname);
  const normalizedCandidate = normalizedDomain(domain);
  return (
    normalizedHost === normalizedCandidate ||
    normalizedHost.endsWith(`.${normalizedCandidate}`)
  );
}

function profileMatchesDomain(profile: VehicleSourceProfile, domain: string): boolean {
  return profile.domains.some((candidate) => domainMatches(domain, candidate));
}

export function selectVehicleSourceProfiles(
  preferences: SourcePreferencesLike | undefined,
): VehicleSourceProfile[] {
  const included = (preferences?.includeDomains ?? []).map(normalizedDomain);
  const excluded = (preferences?.excludeDomains ?? []).map(normalizedDomain);
  return VEHICLE_SOURCE_REGISTRY.filter((profile) => {
    if (excluded.some((domain) => profileMatchesDomain(profile, domain))) return false;
    return included.length === 0 || included.some((domain) => profileMatchesDomain(profile, domain));
  });
}

export function customIncludedDomains(
  preferences: SourcePreferencesLike | undefined,
): string[] {
  const included = [...new Set((preferences?.includeDomains ?? []).map(normalizedDomain))];
  return included.filter(
    (domain) => !VEHICLE_SOURCE_REGISTRY.some((profile) => profileMatchesDomain(profile, domain)),
  );
}

export function profileForUrl(url: string): VehicleSourceProfile | undefined {
  const hostname = hostnameForUrl(url);
  if (!hostname) return undefined;
  return VEHICLE_SOURCE_REGISTRY.find((profile) => profileMatchesDomain(profile, hostname));
}

export function classifySourceResult(
  profile: VehicleSourceProfile,
  url: string,
): SourceResultRole {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (profile.directListingPathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return "specific_listing";
    }
    if (profile.marketPathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return "market_context";
    }
    // Bring a Trailer's vehicle-family hubs vary by make/model path. Its
    // individual records are consistently under /listing/, so any other
    // in-site route is treated as navigation/context rather than a car offer.
    if (profile.id === "bring_a_trailer" && pathname !== "/") {
      return "market_context";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function sourceContextForUrl(
  profile: VehicleSourceProfile | undefined,
  url: string,
): SourceContext | undefined {
  if (!profile) return undefined;
  return {
    sourceId: profile.id,
    sourceLabel: profile.label,
    listingFormat: profile.listingFormat,
    expectedPriceType: profile.expectedPriceType,
    resultRole: classifySourceResult(profile, url),
  };
}

function searchText(value: unknown, limit = 80): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function vehicleSearchTerms(spec: Record<string, unknown>): string {
  const year =
    typeof spec.minYear === "number" && typeof spec.maxYear === "number"
      ? `${spec.minYear}-${spec.maxYear}`
      : typeof spec.minYear === "number"
        ? `${spec.minYear}+`
        : typeof spec.maxYear === "number"
          ? `before ${spec.maxYear}`
          : "";
  const terms = [
    year,
    searchText(spec.make),
    searchText(spec.model),
    searchText(spec.generation),
    searchText(spec.variant),
    spec.bodyStyle === "either" ? "" : searchText(spec.bodyStyle),
    spec.transmission === "either" ? "" : searchText(spec.transmission),
  ].filter(Boolean);
  return [...new Set(terms.map((term) => term.toLowerCase()))].join(" ").slice(0, 240);
}

export function buildVehicleSourceQuery(
  profile: VehicleSourceProfile,
  spec: Record<string, unknown>,
): string {
  const vehicle = vehicleSearchTerms(spec) || "enthusiast car";
  return `${vehicle} ${profile.searchSuffix}`.replace(/\s+/g, " ").trim();
}

export function isDirectListingUrl(profile: VehicleSourceProfile, url: string): boolean {
  return classifySourceResult(profile, url) === "specific_listing";
}
