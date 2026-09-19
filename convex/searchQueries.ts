type VehicleMarket = {
  locality?: string;
  countryCode?: string;
};

function plainSearchText(value: unknown, limit = 80): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * A deliberately simpler second search for a known vehicle. The first pass
 * is precise enough to avoid editorial pages; this pass is only used when it
 * returned nothing, so it avoids piling every preference into the query.
 * Verification still applies year, price, and condition requirements later.
 */
export function buildFallbackVehicleListingQuery(
  spec: Record<string, unknown>,
  market?: VehicleMarket,
): string {
  const vehicleTerms = [
    plainSearchText(spec.make),
    plainSearchText(spec.model),
    plainSearchText(spec.generation),
    plainSearchText(spec.variant),
    spec.bodyStyle === "either" ? "" : plainSearchText(spec.bodyStyle),
    spec.transmission === "either" ? "" : plainSearchText(spec.transmission),
  ].filter(Boolean);
  const uniqueTerms = [...new Set(vehicleTerms.map((term) => term.toLowerCase()))]
    .map((term) => term)
    .slice(0, 6);
  const location = [plainSearchText(market?.locality), plainSearchText(market?.countryCode)]
    .filter(Boolean)
    .join(" ");

  if (uniqueTerms.length === 0) return "";
  return [...uniqueTerms, "for sale", location]
    .filter(Boolean)
    .join(" ")
    .slice(0, 320);
}
