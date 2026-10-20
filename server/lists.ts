import { z } from "zod";
import { listTheme, type ListTheme } from "../shared/lists.ts";
import type { AreaGroup, ItineraryItem, Link, ListEntry, ListSuggestion, StayItem, Trip, TripList, TripPlace } from "../shared/types.ts";
import { aiEnabled, extract } from "./ai.ts";
import { activityLinks } from "./bookingLinks.ts";
import { db, itemStart } from "./db.ts";
import { IDEAS, mapsSearch, type Idea } from "./listIdeas.ts";
import { searchLodging } from "./lodging.ts";
import { cityCentre, countryName } from "./places.ts";
import { distanceKm, tripPlaces } from "./tripPlaces.ts";

// Your own lists ("Mexico Eats", "Mexico Places"): suggestions for each, finding places on the map, and grouping
// nearby places from all your lists so one day can cover them.

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
type LatLon = { lat: number; lon: number };

/** The cities you'll be in (with their centres and dates), from your flights or chosen destinations. */
function tripCities(trip: Trip, items: ItineraryItem[]) {
  return tripPlaces(trip, items).stops.map((s) => ({ ...s, ...(cityCentre(s.city, s.countryCode) ?? { lat: s.lat, lon: s.lon }) }));
}

/** Where a list is about: its city, or the trip's cities in its country, or every trip city. */
function listCities(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const cities = tripCities(trip, items);
  const p = list.place;
  if (p?.type === "city") {
    const centre = p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : cityCentre(p.name, p.countryCode);
    return centre ? [{ city: p.name, countryCode: p.countryCode, ...centre }] : [];
  }
  return p ? cities.filter((c) => c.countryCode === p.countryCode) : cities;
}

/** Choices for "what's this list about?": the trip's countries and cities (with map centres). */
export function listPlaceOptions(trip: Trip, items: ItineraryItem[]): TripPlace[] {
  const cities = tripCities(trip, items);
  const out: TripPlace[] = [];
  const add = (p: TripPlace) => {
    if (!out.some((o) => o.type === p.type && fold(o.name) === fold(p.name) && o.countryCode === p.countryCode)) out.push(p);
  };
  const { homeCountry } = tripPlaces(trip, items);
  for (const cc of [...new Set([...cities.map((c) => c.countryCode), ...(trip.places ?? []).map((p) => p.countryCode)])]) {
    if (cc === homeCountry) continue;
    add({ type: "country", name: countryName(cc), countryCode: cc });
    for (const c of cities.filter((c) => c.countryCode === cc)) add({ type: "city", name: c.city, countryCode: cc, lat: c.lat, lon: c.lon });
    for (const p of (trip.places ?? []).filter((p) => p.countryCode === cc && p.type !== "country")) add(p);
  }
  return out;
}

// ---------- Finding entries on the map ----------

/** Looks a place up near the list's cities; fills in address, area and coordinates when there's a confident match. */
export async function locateEntry(entry: ListEntry, list: TripList, trip: Trip, items: ItineraryItem[]): Promise<ListEntry> {
  if (entry.kind !== "place" || entry.lat !== undefined) return entry;
  const query = entry.title.replace(/\(.*?\)/g, "").replace(/\s*[:–—-]\s.*$/, "").trim();
  const words = fold(query).split(" ").filter((w) => w.length >= 4);
  for (const c of listCities(list, trip, items).slice(0, 2)) {
    const found = await searchLodging(query, c, "any").catch(() => []);
    const hit = found.find((r) => r.name && words.some((w) => fold(r.name!).includes(w)) && distanceKm(r, c) < 80);
    if (hit) return { ...entry, address: entry.address ?? hit.address, area: hit.area, lat: hit.lat, lon: hit.lon };
  }
  return entry;
}

// ---------- Suggestions ----------

const monthsBetween = (from: string, to: string) => {
  const months = new Set<number>();
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) months.add(d.getUTCMonth() + 1);
  return months;
};

function themeMatches(idea: Idea, theme: ListTheme) {
  if (idea.themes.includes(theme)) return true;
  return theme === "general" && idea.themes.includes("sights");
}

function ruleIdeas(list: TripList, trip: Trip, items: ItineraryItem[], theme: ListTheme): ListSuggestion[] {
  const cities = listCities(list, trip, items);
  // Seasonal ideas follow when you're actually in that country (no 6 January ideas if you've left by then).
  const stays = tripCities(trip, items);
  const monthsIn = (cc: string) => {
    const here = stays.filter((c) => c.countryCode === cc);
    return here.length ? new Set(here.flatMap((c) => [...monthsBetween(c.from, c.to)])) : monthsBetween(trip.startDate, trip.endDate);
  };
  const cityKeys = new Set(cities.map((c) => fold(c.city)));
  const countries = list.place ? [list.place.countryCode] : [...new Set([...cities.map((c) => c.countryCode), ...(trip.places ?? []).map((p) => p.countryCode)])];
  const out: (ListSuggestion & { seasonal: boolean })[] = [];
  for (const cc of countries) {
    const firstCity = cities.find((c) => c.countryCode === cc)?.city;
    const months = monthsIn(cc);
    for (const idea of IDEAS[cc] ?? []) {
      if (!themeMatches(idea, theme)) continue;
      if (idea.months && !idea.months.some((m) => months.has(m))) continue;
      // City-specific ideas only for the cities you're going to (when we know them).
      if (idea.city && cityKeys.size && !cityKeys.has(fold(idea.city))) continue;
      const where = idea.city ?? firstCity ?? countryName(cc);
      const links: Link[] =
        idea.kind === "place"
          ? [{ label: "Map", url: mapsSearch(`${idea.title}, ${where}`) }]
          : theme === "food" || theme === "drinks"
            ? [{ label: "Where to try it", url: mapsSearch(`${idea.title} near ${where}`) }]
            : [];
      out.push({ title: idea.title, kind: idea.kind, detail: idea.detail, city: idea.city, tag: idea.tag, links, source: "rules", seasonal: !!idea.months });
    }
  }
  // Things that only fit your dates first, then places and things taken in turn (so neither crowds the other out).
  const seasonal = out.filter((s) => s.seasonal);
  const places = out.filter((s) => !s.seasonal && s.kind === "place");
  const things = out.filter((s) => !s.seasonal && s.kind === "thing");
  const mixed = [...seasonal];
  while (places.length || things.length) mixed.push(...[places.shift(), things.shift()].filter((x) => !!x));
  return mixed.map(({ seasonal: _s, ...s }) => s);
}

const ClaudeIdeas = z.object({
  suggestions: z.array(
    z.object({
      title: z.string().describe("Name of the place, dish, drink or experience"),
      kind: z.enum(["place", "thing"]).describe("place = somewhere specific to go; thing = something to try or do anywhere"),
      city: z.string().nullable(),
      detail: z.string().describe("Why it's worth it and a practical tip, under 35 words"),
      tag: z.string().nullable().describe("Optional 1–3 word label, e.g. Christmas, Book ahead, Day trip, Kid-friendly"),
    }),
  ),
});

const claudeCache = new Map<string, { at: number; value: ListSuggestion[] }>();

async function claudeIdeas(list: TripList, trip: Trip, items: ItineraryItem[], theme: ListTheme): Promise<ListSuggestion[] | null> {
  if (!aiEnabled()) return null;
  const key = `${list.id}|${list.name}|${list.place?.name}|${list.entries.map((e) => e.title).join(",")}|${(list.dismissed ?? []).join(",")}`;
  const hit = claudeCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.value;
  const cities = listCities(list, trip, items);
  const parts = trip.parts?.map((p) => `${p.name} (${p.from} to ${p.to}): ${p.party}${p.companions ? ` with ${p.companions}` : ""}${p.kids && p.kids !== "none" ? ", kids along" : ""}`);
  const prompt = `List: "${list.name}" (theme: ${theme})
About: ${list.place ? `${list.place.name}, ${countryName(list.place.countryCode)}` : "anywhere on the trip"}
Cities and dates: ${cities.map((c) => ("from" in c ? `${c.city} (${c.from} to ${c.to})` : c.city)).join("; ") || trip.destination}
Trip: ${trip.startDate} to ${trip.endDate}, ${trip.purpose}, styles: ${trip.styles.join(", ") || "not given"}
Travelling: ${parts?.join("; ") || trip.party}
Already on the list: ${list.entries.map((e) => e.title).join("; ") || "(nothing yet)"}
Not interested in: ${(list.dismissed ?? []).join("; ") || "(none)"}`;
  const result = await extract(
    ClaudeIdeas,
    `You suggest additions to a traveller's personal list. Give 8 to 12 ideas that fit the list's theme and place: a mix of
specific, well-established named places (restaurants, markets, cafés, sights, neighbourhoods) and things to try or do.
Only name places you are confident exist and are long-running; never invent. Prefer local favourites over tourist traps,
include season-specific ideas when the dates fit (e.g. Christmas), and fit who they travel with. Don't repeat what's
already on the list or what they're not interested in. No prices or opening hours.`,
    prompt,
    "low",
  ).catch(() => null);
  if (!result) return null;
  const value = result.suggestions.map((s): ListSuggestion => {
    const where = s.city ?? cities[0]?.city ?? "";
    return {
      title: s.title,
      kind: s.kind,
      detail: s.detail,
      city: s.city ?? undefined,
      tag: s.tag ?? undefined,
      source: "claude",
      links: [{ label: s.kind === "place" ? "Map" : "Where to try it", url: mapsSearch(s.kind === "place" ? `${s.title}, ${where}` : `${s.title} near ${where}`) }],
    };
  });
  claudeCache.set(key, { at: Date.now(), value });
  return value;
}

/** "Find more" searches for the list's theme in its cities. */
function finders(theme: ListTheme, cities: { city: string }[]): Link[] {
  return cities.slice(0, 3).flatMap(({ city }) => {
    switch (theme) {
      case "food":
        return [
          { label: `Top restaurants · ${city}`, url: mapsSearch(`best restaurants in ${city}`) },
          { label: `Food tours · ${city}`, url: activityLinks(`${city} food tour`)[0].url },
        ];
      case "drinks":
        return [{ label: `Cafés & bars · ${city}`, url: mapsSearch(`best cafes and bars in ${city}`) }];
      case "shopping":
        return [{ label: `Markets & shops · ${city}`, url: mapsSearch(`markets in ${city}`) }];
      case "nightlife":
        return [{ label: `Nightlife · ${city}`, url: mapsSearch(`bars and live music in ${city}`) }];
      case "nature":
        return [{ label: `Parks & nature · ${city}`, url: mapsSearch(`parks and nature near ${city}`) }];
      default:
        return [
          { label: `Top sights · ${city}`, url: mapsSearch(`top attractions in ${city}`) },
          { label: `Tours · ${city}`, url: activityLinks(`${city}`)[0].url },
        ];
    }
  });
}

export async function listSuggestions(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const theme = listTheme(list.name, list.emoji);
  const taken = new Set([...list.entries.map((e) => fold(e.title)), ...(list.dismissed ?? []).map(fold)]);
  const fresh = (s: ListSuggestion) => !taken.has(fold(s.title));
  const ai = ((await claudeIdeas(list, trip, items, theme)) ?? []).filter(fresh);
  const seen = new Set(ai.map((s) => fold(s.title)));
  const rules = ruleIdeas(list, trip, items, theme).filter((s) => fresh(s) && !seen.has(fold(s.title)));
  return {
    theme,
    suggestions: [...ai, ...rules].slice(0, 16),
    finders: finders(theme, listCities(list, trip, items)),
    ai: aiEnabled(),
  };
}

// ---------- Grouping nearby places, and day plans ----------

type Located = AreaGroup["entries"][number] & LatLon;

const NEAR_KM = 2.5; // places within this of each other make a comfortable day on foot / short rides

/** Complete-linkage clustering: every place in a group is within NEAR_KM of every other. */
function cluster(points: Located[]): Located[][] {
  let groups = points.map((p) => [p]);
  const span = (a: Located[], b: Located[]) => Math.max(...a.flatMap((x) => b.map((y) => distanceKm(x, y))));
  for (;;) {
    let best: [number, number, number] | undefined;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = span(groups[i], groups[j]);
        if (d <= NEAR_KM && (!best || d < best[2])) best = [i, j, d];
      }
    if (!best) return groups;
    const [i, j] = best;
    groups = [...groups.filter((_, k) => k !== i && k !== j), [...groups[i], ...groups[j]]];
  }
}

/** Nearest-neighbour walking order, starting from `start` (e.g. where you're staying) or the outermost place. */
function walkingOrder<T extends LatLon>(places: T[], start?: LatLon): T[] {
  if (places.length < 2) return places;
  const centre = { lat: places.reduce((s, p) => s + p.lat, 0) / places.length, lon: places.reduce((s, p) => s + p.lon, 0) / places.length };
  const left = [...places];
  let at: LatLon = start ?? left.reduce((far, p) => (distanceKm(p, centre) > distanceKm(far, centre) ? p : far));
  const out: T[] = [];
  while (left.length) {
    const next = left.reduce((best, p) => (distanceKm(p, at) < distanceKm(best, at) ? p : best));
    out.push(next);
    left.splice(left.indexOf(next), 1);
    at = next;
  }
  return out;
}

function routeUrl(places: LatLon[], start?: LatLon) {
  const stops = [...(start ? [start] : []), ...places];
  if (stops.length < 2) return undefined;
  const ll = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const spread = Math.max(...stops.map((a) => Math.max(...stops.map((b) => distanceKm(a, b)))));
  return (
    `https://www.google.com/maps/dir/?api=1&origin=${ll(stops[0])}&destination=${ll(stops.at(-1)!)}` +
    (stops.length > 2 ? `&waypoints=${stops.slice(1, -1).map(ll).join("%7C")}` : "") +
    (spread <= 3 ? "&travelmode=walking" : "")
  );
}

const tripLists = (tripId: string) => db.lists.filter((l) => l.tripId === tripId);

function located(tripId: string, filter: (e: ListEntry) => boolean): Located[] {
  return tripLists(tripId).flatMap((l) =>
    l.entries
      .filter((e): e is ListEntry & LatLon => e.lat !== undefined && e.lon !== undefined && filter(e))
      .map((e) => ({ ...e, listId: l.id, listEmoji: l.emoji, listName: l.name })),
  );
}

/** Where you sleep on a night, if the stay has a map position. */
function stayOn(items: ItineraryItem[], day: string): LatLon | undefined {
  const stay = items.find((i): i is StayItem => i.kind === "stay" && i.checkIn.slice(0, 10) <= day && i.checkOut.slice(0, 10) > day);
  return stay?.lat !== undefined && stay.lon !== undefined ? { lat: stay.lat, lon: stay.lon } : undefined;
}

const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** Unplanned places from all your lists, grouped by area, each with the best days to go. */
export function areaGroups(trip: Trip, items: ItineraryItem[]): AreaGroup[] {
  const cities = tripCities(trip, items);
  const busy = new Map<string, number>();
  for (const i of items) {
    const day = itemStart(i).slice(0, 10);
    busy.set(day, (busy.get(day) ?? 0) + (i.kind === "flight" ? 10 : i.kind === "activity" ? 2 : 0));
  }
  for (const e of located(trip.id, (e) => !!e.day)) busy.set(e.day!, (busy.get(e.day!) ?? 0) + 1);

  // Biggest groups pick their days first; each suggestion makes that day a little less attractive for the next group.
  return cluster(located(trip.id, (e) => !e.done && !e.day))
    .sort((a, b) => b.length - a.length)
    .map((entries): AreaGroup => {
      const centre = { lat: entries.reduce((s, p) => s + p.lat, 0) / entries.length, lon: entries.reduce((s, p) => s + p.lon, 0) / entries.length };
      const city = cities.filter((c) => distanceKm(c, centre) < 80).sort((a, b) => distanceKm(a, centre) - distanceKm(b, centre))[0];
      const areas = entries.map((e) => e.area).filter((a): a is string => !!a);
      const area = areas.sort((a, b) => areas.filter((x) => x === b).length - areas.filter((x) => x === a).length)[0] ?? `Around ${entries[0].title}`;
      const range = city ? daysBetween(city.from, city.to) : daysBetween(trip.startDate, trip.endDate);
      const suggestedDays = range
        .map((day, i) => ({ day, score: (busy.get(day) ?? 0) + (i === 0 || i === range.length - 1 ? 3 : 0) }))
        .sort((a, b) => a.score - b.score || a.day.localeCompare(b.day))
        .slice(0, 3)
        .map((d) => d.day)
        .sort();
      for (const d of suggestedDays) busy.set(d, (busy.get(d) ?? 0) + 1);
      const ordered = walkingOrder(entries);
      return { area, city: city?.city, entries: ordered, suggestedDays, routeUrl: routeUrl(ordered) };
    });
}

/** Places planned for each day, in walking order from where you're staying, with a route link. */
export function dayPlans(trip: Trip, items: ItineraryItem[]) {
  const out: Record<string, { entries: AreaGroup["entries"]; routeUrl?: string }> = {};
  const all = tripLists(trip.id).flatMap((l) => l.entries.filter((e) => e.day).map((e) => ({ ...e, listId: l.id, listEmoji: l.emoji, listName: l.name })));
  for (const day of [...new Set(all.map((e) => e.day!))]) {
    const onDay = all.filter((e) => e.day === day);
    const withPos = onDay.filter((e): e is Located => e.lat !== undefined && e.lon !== undefined);
    const stay = stayOn(items, day);
    const ordered = walkingOrder(withPos, stay);
    out[day] = { entries: [...ordered, ...onDay.filter((e) => e.lat === undefined)], routeUrl: routeUrl(ordered, stay) };
  }
  return out;
}
