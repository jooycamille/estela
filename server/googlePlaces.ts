import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";
import type { LodgingResult } from "./lodging.ts";

// Optional: search addresses and places with Google Places (Text Search, New) when GOOGLE_MAPS_API_KEY is set.
// OpenStreetMap stays the fallback (no key, over the monthly limit, an error, or nothing found). The limit keeps you
// inside Google's free allowance: change it with GOOGLE_MAPS_MONTHLY_LIMIT.

const URL_SEARCH = "https://places.googleapis.com/v1/places:searchText";
// Billed by the most expensive field requested: these are all "Text Search Pro".
const FIELDS = "places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents";
const USAGE_PATH = () => join(DATA_DIR, "google-usage.json");
const cache = new Map<string, { at: number; value: LodgingResult[] }>();

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  addressComponents?: { longText?: string; types?: string[] }[];
}

export const googleEnabled = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);
const monthlyLimit = () => Number(process.env.GOOGLE_MAPS_MONTHLY_LIMIT) || 1000;

function usage() {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const u = existsSync(USAGE_PATH()) ? (JSON.parse(readFileSync(USAGE_PATH(), "utf8")) as { month: string; used: number }) : undefined;
    return u?.month === month ? u : { month, used: 0 };
  } catch {
    return { month, used: 0 };
  }
}

function toResult(p: GooglePlace): LodgingResult | undefined {
  if (!p.formattedAddress || !p.location) return undefined;
  const types = p.types ?? [];
  // A business or landmark has a name of its own; for a plain address, Google's "name" just repeats the street.
  const named = types.includes("establishment") || types.includes("point_of_interest");
  const part = (...wanted: string[]) => p.addressComponents?.find((c) => c.types?.some((t) => wanted.includes(t)))?.longText;
  return {
    name: named ? p.displayName?.text : undefined,
    address: p.formattedAddress,
    lat: p.location.latitude,
    lon: p.location.longitude,
    kind: named ? "property" : "address",
    area: part("neighborhood", "sublocality_level_1", "sublocality", "locality"),
    source: "google",
    // Pinpointed to a building, not just a street or an area.
    precise: named || types.some((t) => t === "street_address" || t === "premise" || t === "subpremise"),
  };
}

/** Up to 6 matches, near a position when there is one. Null when Google can't be used; throws on an API error. */
export async function googleSearch(query: string, near?: { lat: number; lon: number }): Promise<LodgingResult[] | null> {
  if (!googleEnabled()) return null;
  const key = `${query}|${near?.lat},${near?.lon}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
  const u = usage();
  if (u.used >= monthlyLimit()) {
    console.warn(`Google Maps: monthly limit of ${monthlyLimit()} searches reached; using OpenStreetMap until next month.`);
    return null;
  }
  writeFileSync(USAGE_PATH(), JSON.stringify({ ...u, used: u.used + 1 }), { mode: 0o600 });
  const res = await fetch(URL_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 6,
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50_000 } } } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  // The error's reason, never the request (which carries the key).
  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
  const body = (await res.json()) as { places?: GooglePlace[] };
  const value = (body.places ?? []).flatMap((p) => toResult(p) ?? []);
  cache.set(key, { at: Date.now(), value });
  return value;
}
