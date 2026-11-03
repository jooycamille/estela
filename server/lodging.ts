import type { FlightItem, ItineraryItem, Trip } from "../shared/types.ts";
import { getAirport } from "./airports.ts";
import { cityCentre } from "./places.ts";

// Property ↔ address lookup for stays, via OpenStreetMap's Nominatim (data © OpenStreetMap contributors, ODbL).
// Nominatim's usage policy: an identifying User-Agent, at most 1 request/second, results cached, and searches only
// on an explicit user action (no search-as-you-type) — the UI searches when you press Find or Enter.
// Coverage follows OSM: hotels are usually there; private homes and some house numbers aren't, so free text stays.

export interface LodgingResult {
  name?: string; // property name, when the place has one
  address: string;
  lat: number;
  lon: number;
  kind: "property" | "address";
  area?: string; // neighbourhood or suburb
}

export interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  display_name: string;
  address?: Record<string, string>;
}

const BASE = "https://nominatim.openstreetmap.org";
const UA = "HeyJoy/0.1 (personal trip planner)";
const cache = new Map<string, { at: number; value: unknown }>();
let queue: Promise<unknown> = Promise.resolve();
let last = 0;

/** One request at a time, at least 1.1 s apart (Nominatim policy), cached for a day. */
export function nominatim<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return Promise.resolve(hit.value as T);
  const run = async () => {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const value = (await res.json()) as T;
    cache.set(path, { at: Date.now(), value });
    return value;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

const LODGING = /^(?:hotel|hostel|guest_house|motel|apartment|apartments|chalet|resort|camp_site|residential|house|dormitory)$/;

/** "Calle Durango 87, Roma Norte, Mexico City, 06700, Mexico" */
function formatAddress(p: NominatimPlace, typedNumber?: string) {
  const a = p.address ?? {};
  const number = a.house_number ?? typedNumber;
  const road = a.road ?? a.pedestrian ?? a.footway;
  // Colombian-style numbers ("7-50") read "Carrera 43A #7-50".
  const street = [road, number && /-/.test(number) ? `#${number}` : number].filter(Boolean).join(" ");
  const parts = [street, a.neighbourhood ?? a.suburb ?? a.quarter, a.city ?? a.town ?? a.village ?? a.municipality, a.postcode, a.country];
  const out = [...new Set(parts.filter((x): x is string => !!x))].join(", ");
  return out || p.display_name;
}

/** "Colonia Del Carmen, Coyoacán": neighbourhood plus borough, when they differ. */
function areaName(a: Record<string, string>) {
  const hood = a.neighbourhood ?? a.suburb ?? a.quarter;
  const district = a.city_district ?? a.borough;
  const f = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (hood && district && !f(district).includes(f(hood)) && !f(hood).includes(f(district))) return `${hood}, ${district}`;
  return hood ?? district ?? a.town ?? a.village ?? a.city;
}

// Places worth calling "the property": accommodation and named buildings — not shops, bus stops or streets.
const PROPERTY_CATEGORIES = new Set(["tourism", "building"]);
// For lists ("Mexico Eats", "Mexico Places"): restaurants, shops, parks, sights, neighbourhoods too.
const PLACE_CATEGORIES = new Set(["tourism", "building", "amenity", "shop", "leisure", "historic", "craft", "place", "boundary", "natural", "man_made", "club"]);

function toResult(p: NominatimPlace, typedNumber?: string, scope: "lodging" | "any" = "lodging"): LodgingResult {
  // (Not LODGING.test(type) on its own: streets are type "residential" too.)
  const named = !!p.name && (scope === "any" ? PLACE_CATEGORIES : PROPERTY_CATEGORIES).has(p.category ?? "");
  const a = p.address ?? {};
  const isRoad = p.category === "highway";
  return {
    name: named ? p.name : undefined,
    address: formatAddress(p, isRoad ? typedNumber : undefined),
    lat: +p.lat,
    lon: +p.lon,
    kind: named ? "property" : "address",
    area: areaName(a),
  };
}

/** Where you'll be on a date: the airport you last landed at, or a chosen destination city. */
export function positionOn(trip: Trip, items: ItineraryItem[], day: string) {
  const landed = items
    .filter((i): i is FlightItem => i.kind === "flight")
    .filter((f) => (f.arrivalTime ?? f.departureTime).slice(0, 10) <= day)
    .sort((a, b) => (a.arrivalTime ?? a.departureTime).localeCompare(b.arrivalTime ?? b.departureTime))
    .at(-1);
  const airport = landed && getAirport(landed.to);
  // The city itself, not its airport (Medellín's airport is 20 km away in Rionegro).
  if (airport) return cityCentre(airport.city, airport.countryCode) ?? { lat: airport.lat, lon: airport.lon };
  const city = trip.places?.find((p) => p.lat !== undefined);
  return city ? { lat: city.lat!, lon: city.lon! } : undefined;
}

// Spanish/Latin American street abbreviations (Colombian addresses like "Cra 43A #7-50" especially).
const STREET_WORDS: [RegExp, string][] = [
  [/\b(?:cra|kra|cr|kr|carr)\.?(?=\s|\d)/i, "Carrera"], [/\b(?:cll|cl)\.?(?=\s|\d)/i, "Calle"], [/\b(?:avda|av)\.?(?=\s|\d)/i, "Avenida"],
  [/\b(?:tv|trans|transv)\.?(?=\s|\d)/i, "Transversal"], [/\b(?:dg|diag)\.?(?=\s|\d)/i, "Diagonal"], [/\bcirc\.?(?=\s|\d)/i, "Circular"],
];
const expandStreet = (q: string) => STREET_WORDS.reduce((s, [re, word]) => s.replace(re, word), q);

export const viewbox = (lat: number, lon: number, d: number) => `${lon - d},${lat + d},${lon + d},${lat - d}`;

/**
 * Search a property name or an address within ~40 km of where you'll be. Only searches further afield when there's
 * no location to go on, or when you name a place ("Hotel X, Cartagena") — otherwise unrelated matches far away would
 * just confuse (e.g. streets in Spain for a Colombian address).
 */
export async function searchLodging(query: string, near?: { lat: number; lon: number }, scope: "lodging" | "any" = "lodging"): Promise<LodgingResult[]> {
  const q = expandStreet(query.trim());
  if (q.length < 3) return [];
  const search = async (text: string) => {
    const base = `/search?q=${encodeURIComponent(text)}&format=jsonv2&addressdetails=1&limit=10`;
    let found = near ? await nominatim<NominatimPlace[]>(`${base}&viewbox=${viewbox(near.lat, near.lon, 0.4)}&bounded=1`) : [];
    if (!found.length && (!near || text.includes(","))) found = await nominatim<NominatimPlace[]>(base);
    return found;
  };
  // "Carrera 43A #7-50": the house number (incl. Colombian "#7-50") is kept even if OSM only knows the street.
  // A house number is a Colombian-style "#7-50", or a number after a street *name* ("Durango 87") — not the
  // number that is part of a street's name ("Calle 16", "Carrera 41").
  const STREET_KEYWORD = /^(?:calle|carrera|avenida|transversal|diagonal|circular|street|st|avenue|ave|road|rd)$/i;
  const tokens = q.split(",")[0].trim().split(/\s+/);
  const lastNumberAt = tokens.reduce((at, t, i) => (/^\d+[a-z]?(?:-\d+)?$/i.test(t) ? i : at), -1);
  const typedNumber =
    q.match(/#\s*(\d+\s*[a-z]?\s*-\s*\d+)/i)?.[1]?.replace(/\s+/g, "") ??
    (lastNumberAt > 0 && !STREET_KEYWORD.test(tokens[lastNumberAt - 1]) ? tokens[lastNumberAt] : undefined);
  let places = await search(q);
  if (typedNumber) {
    // Also search just the street ("Carrera 43A", "Durango") — OSM often lacks house numbers — keeping the number.
    const [streetPart, ...rest] = q.split(",");
    const street = streetPart.replace(/#.*$/, "").replace(new RegExp(`\\s+${typedNumber.replace(/[-]/g, "\\-")}\\s*$`), "").trim();
    if (street.length >= 3 && street !== streetPart.trim()) {
      // Locals often drop the street type ("Durango 87" for Calle Durango): try "Calle …" too.
      const variants = STREET_KEYWORD.test(street.split(/\s+/)[0]) ? [street] : [`Calle ${street}`, street];
      for (const v of variants) {
        const streets = (await search([v, ...rest].join(","))).filter((p) => p.category === "highway");
        places = [...places, ...streets];
        if (streets.length) break;
      }
    }
  }
  const seen = new Set<string>();
  return places
    .map((p) => toResult(p, typedNumber, scope))
    // Named places first, then addresses — each nearest to where you'll be first.
    .sort((a, b) => {
      const named = Number(b.kind === "property") - Number(a.kind === "property");
      if (named || !near) return named;
      return (a.lat - near.lat) ** 2 + (a.lon - near.lon) ** 2 - ((b.lat - near.lat) ** 2 + (b.lon - near.lon) ** 2);
    })
    .filter((r) => {
      const id = `${r.name ?? ""}|${r.address}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Hotels, hostels and guest houses at a location — "which property is at this address?": anything within ~150 m,
 * plus ones on the same street (when OSM lacks the house number, the point is just somewhere on the street).
 */
export async function propertiesAt(lat: number, lon: number, address?: string): Promise<LodgingResult[]> {
  // "Calle Durango 87, Roma Norte, …" → "calle durango"
  const road = address ? fold(address.split(",")[0].replace(/\s+#.*$/, "").replace(/\s+\d+[a-z]?(?:-\d+)?$/i, "")) : "";
  const near = (phrase: string, d: number) =>
    nominatim<NominatimPlace[]>(`/search?q=${encodeURIComponent(phrase)}&format=jsonv2&addressdetails=1&limit=20&viewbox=${viewbox(lat, lon, d)}&bounded=1`);
  const found = [...(await near("hotel", 0.0015)), ...(await near("hostel", 0.0015)), ...(await near("guest house", 0.0015))];
  // "hotel, Calle Durango" finds the hotels on that street (within ~2 km).
  if (road) found.push(...(await near(`hotel, ${address!.split(",")[0].replace(/\s+#.*$/, "").replace(/\s+\d+[a-z]?(?:-\d+)?$/i, "")}`, 0.02)));
  const dist = (p: NominatimPlace) => (+p.lat - lat) ** 2 + (+p.lon - lon) ** 2;
  const close = 0.0015 ** 2;
  const onStreet = (p: NominatimPlace) => !!road && fold(p.address?.road ?? "") === road;
  const seen = new Set<string>();
  return found
    .filter((p) => p.name && LODGING.test(p.type ?? "") && (dist(p) <= close * 2 || onStreet(p)))
    // Same street first, then nearest.
    .sort((a, b) => Number(onStreet(b)) - Number(onStreet(a)) || dist(a) - dist(b))
    .map((p) => toResult(p))
    .filter((r) => (r.name && !seen.has(fold(r.name)) ? (seen.add(fold(r.name)), true) : false))
    .slice(0, 5);
}
