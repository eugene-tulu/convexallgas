"use node";

// Thin wrapper around OpenStreetMap's Nominatim geocoder.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - Free, no API key
//   - Real User-Agent required ("Proxy/0.1 (contact: ...)" is acceptable)
//   - Max 1 request per second — we don't batch inside a single call, so
//     callers shouldn't fan out without rate limiting themselves.
const USER_AGENT = "Proxy/0.1 (hackathon demo; https://basic-hippopotamus-995.convex.site)";

export type GeocodeResult = { lat: number; lng: number; displayName: string } | null;

/**
 * Geocode a free-text location string via Nominatim.
 * Returns null on any failure (network, 404, empty result) so callers can
 * log a `geocode_failed` event and continue without coordinates.
 */
export async function geocodeLocation(query: string): Promise<GeocodeResult> {
  if (!query || !query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`geocodeLocation: ${res.status} ${res.statusText} for "${query}"`);
      return null;
    }
    const data = (await res.json()) as Array<{
      lat?: string | number;
      lon?: string | number;
      display_name?: string;
    }>;
    const hit = data[0];
    if (!hit || hit.lat == null || hit.lon == null) return null;
    const lat = typeof hit.lat === "string" ? parseFloat(hit.lat) : hit.lat;
    const lng = typeof hit.lon === "string" ? parseFloat(hit.lon) : hit.lon;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, displayName: hit.display_name ?? query };
  } catch (e) {
    console.warn(`geocodeLocation failed for "${query}": ${(e as Error).message}`);
    return null;
  }
}
