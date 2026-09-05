"use node";

// Thin wrapper around OpenStreetMap's Nominatim geocoder.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - Free, no API key
//   - Real User-Agent required — we use a generic "Proxy/0.1" with a
//     contact URL that comes from CONVEX_SITE_URL at runtime. If neither
//     the env var nor a literal fallback is set, the helper still works
//     but uses a non-URL contact identifier so Nominatim's policy check
//     doesn't break. Deployments should always set CONVEX_SITE_URL.
//   - Max 1 request per second — we don't batch inside a single call, so
//     callers shouldn't fan out without rate limiting themselves.
//   - 10s timeout via AbortController; a hung request would otherwise
//     hold the action until Convex's action timeout kills it.
import { env } from "./_generated/server";

function userAgent(): string {
  const site = env.CONVEX_SITE_URL ?? "";
  return site
    ? `Proxy/0.1 (hackathon demo; ${site})`
    : `Proxy/0.1 (hackathon demo; contact via convex deployment)`;
}

export type GeocodeResult = { lat: number; lng: number; displayName: string } | null;

const TIMEOUT_MS = 10_000;

/**
 * Geocode a free-text location string via Nominatim.
 * Returns null on any failure (network, 404, empty result, timeout) so
 * callers can log a `geocode_failed` event and continue without
 * coordinates.
 */
export async function geocodeLocation(query: string): Promise<GeocodeResult> {
  if (!query || !query.trim()) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
      },
      signal: controller.signal,
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
    if ((e as Error).name === "AbortError") {
      console.warn(`geocodeLocation: timed out after ${TIMEOUT_MS}ms for "${query}"`);
      return null;
    }
    console.warn(`geocodeLocation failed for "${query}": ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
