import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localApps } from "./localApps.ts";
import { safetyTips } from "./safetyTips.ts";
import type { EssentialKind, EssentialPlace, Essentials, StayEssentials, StayItem } from "../shared/types.ts";
import { DATA_DIR } from "./db.ts";
import { googleEnabled } from "./googlePlaces.ts";
import { nominatim, searchLodging, viewbox, type NominatimPlace } from "./lodging.ts";
import { decodePlusCode, PLUS_CODE } from "./pluscode.ts";
import { distanceKm } from "./tripPlaces.ts";

// Pharmacies, hospitals/clinics, police and ATMs near where you're staying, from OpenStreetMap (Nominatim; data ©
// OpenStreetMap contributors). Requests go through the same queue as the lodging lookup (≥1.1 s apart) and results
// are cached for a week in data/essentials-cache.json, so this only hits the map service once per stay.

type LatLon = { lat: number; lon: number };

// Each kind: what to search for, and which OSM tags count.
const KINDS: { kind: EssentialKind; query: string; types: RegExp }[] = [
  { kind: "pharmacy", query: "pharmacy", types: /^(pharmacy|chemist)$/ },
  { kind: "hospital", query: "hospital", types: /^hospital$/ },
  { kind: "clinic", query: "clinic", types: /^(clinic|doctors)$/ },
  { kind: "police", query: "police", types: /^police$/ },
  { kind: "atm", query: "atm", types: /^(atm|bank)$/ },
];
// Map entries that are tagged as health places or ATMs but aren't useful in an emergency.
const NOT_REALLY = /bitcoin|cripto|crypto|\bEPS\b|consultor|seguros?\b|insurance|veterinar/i;
// Words in a stay's name that don't identify a particular place.
const GENERIC_STAY_WORDS = new Set(["home", "house", "hotel", "hostel", "apartment", "apartamento", "the", "and", "with", "near", "family", "villa", "casa", "room", "stay", "condo", "unit", "inn"]);
const REAL_CARE = /hospital|cl[ií]nica|clinic|sanatorio|m[eé]dic|policl|salud|urgenc|emergenc/i;

// National emergency numbers for the countries Estela knows well (112 also works from most mobiles worldwide).
const EMERGENCY: Record<string, { number: string; note?: string }> = {
  MX: { number: "911", note: "Police, ambulance and fire" },
  PA: { number: "911", note: "Police, ambulance and fire" },
  CO: { number: "123", note: "Police, ambulance and fire" },
  US: { number: "911" },
  CA: { number: "911" },
  AU: { number: "000" },
  NZ: { number: "111" },
  SG: { number: "999", note: "Police · 995 for ambulance and fire" },
  PH: { number: "911" },
  GB: { number: "999" },
};
export const emergencyFor = (countryCode?: string) => (countryCode ? EMERGENCY[countryCode] : undefined) ?? { number: "112", note: "Works from most mobiles; check the local number" };

const CACHE_PATH = join(DATA_DIR, "essentials-cache.json");
const WEEK = 7 * 24 * 3600_000;
type CacheEntry = { at: number; value: StayEssentials };
let cache: Record<string, CacheEntry> = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
const saveCache = () => writeFileSync(CACHE_PATH, JSON.stringify(cache), { mode: 0o600 });

/** Where a stay is: its saved map position, a Plus Code, its address, or its name — nearest to the city. */
async function locateStay(stay: StayItem, near: LatLon): Promise<{ at: LatLon; how: "exact" | "approximate" } | undefined> {
  if (stay.lat !== undefined && stay.lon !== undefined) return { at: { lat: stay.lat, lon: stay.lon }, how: "exact" };
  const address = stay.address ?? "";
  const close = (p: LatLon) => distanceKm(p, near) < 150;
  // 1. The property by name ("Ph Bay Tower" is on the map even when its street, "Calle 5", is ambiguous).
  // Every distinctive word must match: "Home in Antipolo" says nothing a hotel called "Antipolo …" could confirm.
  const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const addressWords = new Set(plain(address).split(/\W+/));
  const words = plain(stay.name).split(/\W+/).filter((w) => w.length >= 3 && !GENERIC_STAY_WORDS.has(w) && !addressWords.has(w));
  // Also without short prefixes ("Ph Bay Tower" → "Bay Tower"; PH = a Panamanian building prefix).
  const names = [...new Set([stay.name, stay.name.split(/\s+/).filter((w) => w.length > 2).join(" ")])];
  for (const n of words.length ? names : []) {
    const byName = (await searchLodging(n, near).catch(() => [])).find((r) => r.kind === "property" && close(r) && words.every((w) => plain(r.name!).includes(w)));
    if (byName) return { at: byName, how: "exact" };
  }
  // 2. A Plus Code.
  const plus = address.match(PLUS_CODE)?.[1];
  if (plus) {
    // "8Q7X+2C, Sample Town, Antioquia": the town after the code is the reference point.
    const town = address.replace(PLUS_CODE, "").replace(/^[\s,]+/, "");
    const ref = (await searchLodging(town, near).catch(() => []))[0] ?? near;
    const at = decodePlusCode(plus, ref);
    if (at && close(at)) return { at, how: "exact" };
  }
  // 3. The street address: close, but only as exact as the map's house numbers.
  // A long address may not be on the map whole, so try dropping details from the front ("Unit 2, Sample St, …").
  const parts = address.replace(PLUS_CODE, "").split(",").map((p) => p.trim()).filter(Boolean);
  for (let drop = 0; drop < Math.min(parts.length - 1, 4); drop++) {
    const q = parts.slice(drop).join(", ");
    if (q.replace(/[\s,]/g, "").length < 4) continue;
    const hit = (await searchLodging(q, near).catch(() => [])).find(close);
    if (hit) return { at: hit, how: drop === 0 && (hit.kind === "property" || hit.precise) ? "exact" : "approximate" };
  }
  return undefined;
}

function toPlace(p: NominatimPlace & { extratags?: Record<string, string> }, kind: EssentialKind, from: LatLon): EssentialPlace {
  const a = p.address ?? {};
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  return {
    name: p.name || (kind === "atm" ? "ATM" : kind[0].toUpperCase() + kind.slice(1)),
    kind,
    address: [street, a.neighbourhood ?? a.suburb].filter(Boolean).join(", ") || undefined,
    lat: +p.lat,
    lon: +p.lon,
    km: Math.round(distanceKm({ lat: +p.lat, lon: +p.lon }, from) * 10) / 10,
    open247: p.extratags?.opening_hours === "24/7" || undefined,
    phone: p.extratags?.phone ?? p.extratags?.["contact:phone"] ?? undefined,
  };
}

async function nearby(at: LatLon, k: (typeof KINDS)[number]): Promise<EssentialPlace[]> {
  // Within ~1.5 km first; widen to ~5 km, then ~15 km (countryside stays) if there's nothing closer.
  for (const d of [0.014, 0.045, 0.14]) {
    const found = await nominatim<(NominatimPlace & { extratags?: Record<string, string> })[]>(
      `/search?q=${k.query}&format=jsonv2&addressdetails=1&extratags=1&limit=20&viewbox=${viewbox(at.lat, at.lon, d)}&bounded=1`,
    ).catch(() => []);
    const places = found
      .filter((p) => k.types.test(p.type ?? "") && !NOT_REALLY.test(p.name ?? ""))
      .map((p) => toPlace(p, k.kind, at))
      // Hospitals and clinics with a care-sounding name first (OSM has some odd tags), then nearest.
      .sort((a, b) =>
        (k.kind === "hospital" || k.kind === "clinic" ? Number(REAL_CARE.test(b.name)) - Number(REAL_CARE.test(a.name)) : 0) || a.km - b.km,
      );
    const seen = new Set<string>();
    const unique = places.filter((p) => (seen.has(`${p.name}|${p.km}`) ? false : (seen.add(`${p.name}|${p.km}`), true)));
    if (unique.length) return unique.slice(0, 3);
  }
  return [];
}

export async function stayEssentials(stay: StayItem, near: LatLon): Promise<StayEssentials> {
  const key = `v2|${googleEnabled() ? "g" : "o"}|${stay.id}|${stay.name}|${stay.address ?? ""}|${stay.lat ?? ""},${stay.lon ?? ""}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < WEEK) return { ...hit.value, stayName: stay.name };
  const empty = Object.fromEntries(KINDS.map((k) => [k.kind, []])) as unknown as StayEssentials["places"];
  const located = await locateStay(stay, near);
  if (!located) return { stayId: stay.id, stayName: stay.name, located: "not-found", places: empty };
  const places = { ...empty };
  for (const k of KINDS) places[k.kind] = await nearby(located.at, k);
  const value: StayEssentials = {
    stayId: stay.id,
    stayName: stay.name,
    located: located.how,
    places,
    directionsFrom: `${located.at.lat.toFixed(5)},${located.at.lon.toFixed(5)}`,
  };
  cache[key] = { at: Date.now(), value };
  saveCache();
  return value;
}

export async function essentialsFor(stays: StayItem[], near: LatLon, countryCode?: string, city?: string): Promise<Essentials> {
  const out: StayEssentials[] = [];
  for (const s of stays) out.push(await stayEssentials(s, near));
  return { emergency: emergencyFor(countryCode), stays: out, tips: safetyTips(countryCode, city), apps: localApps(countryCode, city) };
}

const positions = new Map<string, LatLon | null>();

/**
 * A stay's map position for the trip map: its own, one already found for its essentials, or a fresh lookup (kept
 * while the server runs). Undefined when it can't be found.
 */
export async function stayPosition(stay: StayItem, near: LatLon): Promise<LatLon | undefined> {
  if (stay.lat !== undefined && stay.lon !== undefined) return { lat: stay.lat, lon: stay.lon };
  const key = `${stay.id}|${stay.name}|${stay.address ?? ""}`;
  if (positions.has(key)) return positions.get(key) ?? undefined;
  const known = Object.values(cache).find((c) => c.value.stayId === stay.id && c.value.stayName === stay.name && c.value.directionsFrom)?.value.directionsFrom;
  if (known) {
    const [lat, lon] = known.split(",").map(Number);
    positions.set(key, { lat, lon });
    return { lat, lon };
  }
  const found = await locateStay(stay, near).catch(() => undefined);
  positions.set(key, found?.at ?? null);
  return found?.at;
}
