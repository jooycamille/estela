import { readFileSync } from "node:fs";
import type { TripPlace } from "../shared/types.ts";

// Destination search: countries (from the runtime's ISO region list), states/provinces and cities (GeoNames,
// CC BY 4.0 — rebuild server/data/places.json with `npm run places`).

type RegionRow = [name: string, ascii: string, countryCode: string];
type CityRow = [name: string, ascii: string, countryCode: string, region: string, population: number, lat: number, lon: number];
const data = JSON.parse(readFileSync(new URL("./data/places.json", import.meta.url), "utf8")) as { regions: RegionRow[]; cities: CityRow[] };

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
export const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};
const COUNTRIES: { code: string; name: string }[] = [];
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = countryName(code);
    if (name !== code && !/unknown/i.test(name)) COUNTRIES.push({ code, name });
  }
const ALIASES: Record<string, string> = { usa: "US", america: "US", uk: "GB", england: "GB", britain: "GB", uae: "AE", holland: "NL", "south korea": "KR", korea: "KR", "czech republic": "CZ" };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const countryIdx = COUNTRIES.map((c) => ({ ...c, key: fold(c.name) }));
const regionIdx = data.regions.map((r) => ({ r, key: fold(r[1] || r[0]) }));
const cityIdx = data.cities.map((c) => ({ c, key: fold(c[1] || c[0]) }));

const countryPlace = (code: string): TripPlace => ({ type: "country", name: countryName(code), countryCode: code });
const regionPlace = (r: RegionRow): TripPlace => ({ type: "region", name: r[0], countryCode: r[2] });
const cityPlace = (c: CityRow): TripPlace => ({ type: "city", name: c[0], countryCode: c[2], region: c[3] || undefined, lat: c[5], lon: c[6] });

/** Countries, states/regions and cities matching the query, best first. */
export function searchPlaces(query: string, limit = 10): TripPlace[] {
  const q = fold(query);
  if (!q) return [];
  const scored: { place: TripPlace; score: number }[] = [];
  const starts = (key: string) => key.startsWith(q) || key.includes(` ${q}`);

  const aliased = ALIASES[q];
  if (aliased) scored.push({ place: countryPlace(aliased), score: 1000 });
  for (const c of countryIdx) {
    if (c.key === q) scored.push({ place: countryPlace(c.code), score: 900 });
    else if (starts(c.key)) scored.push({ place: countryPlace(c.code), score: 600 });
  }
  for (const { r, key } of regionIdx) {
    if (key === q) scored.push({ place: regionPlace(r), score: 750 });
    else if (q.length >= 3 && starts(key)) scored.push({ place: regionPlace(r), score: 400 });
  }
  for (const { c, key } of cityIdx) {
    const exact = key === q;
    if (!exact && !(q.length >= 2 && starts(key))) continue;
    // Bigger cities rank higher among cities (≈0 at 15k people, ~110 at 1M, ~200 at 30M), but a prefix match on a
    // city never outranks a country, and a small town never outranks a state with the exact name.
    const size = Math.max(0, Math.log10(Math.max(c[4], 1)) - 4.2) * 60;
    scored.push({ place: cityPlace(c), score: (exact ? 650 : 350) + Math.min(size, 240) });
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(({ place }) => {
      const id = `${place.type}|${place.name}|${place.region ?? ""}|${place.countryCode}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit)
    .map((s) => s.place);
}

/** Best-effort conversion of an old free-text destination ("Mexico, Panama and Colombia") into places. */
export function matchDestination(text: string): TripPlace[] {
  return text
    .split(/,|\band\b|&|\//i)
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap((t) => {
      const best = searchPlaces(t, 1)[0];
      return best && fold(best.name) === fold(t) ? [best] : [];
    });
}

/** "Mexico City, Panama and Medellín" */
export function describePlaces(places: TripPlace[]) {
  const names = places.map((p) => p.name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Centre of a city by name and country (the most populous match), e.g. for searches "in Medellín". */
export function cityCentre(name: string, countryCode: string): { lat: number; lon: number } | undefined {
  const key = fold(name);
  const c = data.cities.find((r) => r[2] === countryCode && (fold(r[0]) === key || fold(r[1] || r[0]) === key));
  return c ? { lat: c[5], lon: c[6] } : undefined; // cities are sorted by population, so the first match is the main one
}
