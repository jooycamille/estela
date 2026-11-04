import { z } from "zod";
import { listTheme, type ListTheme } from "../shared/lists.ts";
import type { AreaGroup, TravelStyle, ItineraryItem, Link, ListEntry, ListSuggestion, StayItem, Trip, TripList, TripPlace } from "../shared/types.ts";
import { aiEnabled, extract } from "./ai.ts";
import { activityLinks } from "./bookingLinks.ts";
import { db, itemStart, newId, now } from "./db.ts";
import { GENERIC_STYLE_IDEAS, IDEAS, mapsSearch, RESTAURANTS, STYLE_IDEAS, type Idea, type StyleIdea } from "./listIdeas.ts";
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

/** Where a list's ideas apply: its countries and cities, and the months you're in each country. */
/** Does a city-specific idea apply? It's one of the list's cities, or close by (Manila ideas for a stay in Antipolo). */
function nearScope(city: string, cc: string, cities: LatLon[], cityKeys: Set<string>) {
  if (!cityKeys.size || cityKeys.has(fold(city))) return true;
  const at = cityCentre(city, cc);
  return !!at && cities.some((c) => distanceKm(c, at) < 60);
}

function ideaScope(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const cities = listCities(list, trip, items);
  const stays = tripCities(trip, items);
  const monthsIn = (cc: string) => {
    const here = stays.filter((c) => c.countryCode === cc);
    return here.length ? new Set(here.flatMap((c) => [...monthsBetween(c.from, c.to)])) : monthsBetween(trip.startDate, trip.endDate);
  };
  const cityKeys = new Set(cities.map((c) => fold(c.city)));
  const countries = list.place ? [list.place.countryCode] : [...new Set([...cities.map((c) => c.countryCode), ...(trip.places ?? []).map((p) => p.countryCode)])];
  return { cities, cityKeys, countries, monthsIn };
}

// Styles that suit each list theme come first in its "things to do" (food lists lead with food activities).
const THEME_STYLES: Partial<Record<ListTheme, TravelStyle[]>> = {
  food: ["food"], drinks: ["food", "nightlife"], nightlife: ["nightlife"], shopping: ["shopping"], nature: ["nature", "adventure"],
};

/** Things to do that match the trip's travel styles, for the list's place, taking turns between styles. */
function styleIdeas(list: TripList, trip: Trip, items: ItineraryItem[], theme: ListTheme): ListSuggestion[] {
  const styles = [...trip.styles].sort(
    (a, b) => Number((THEME_STYLES[theme] ?? []).includes(b)) - Number((THEME_STYLES[theme] ?? []).includes(a)),
  );
  if (!styles.length) return [];
  const { cities, cityKeys, countries, monthsIn } = ideaScope(list, trip, items);
  const perStyle = new Map<TravelStyle, ListSuggestion[]>(styles.map((st) => [st, []]));
  const used = new Set<string>();
  const add = (idea: StyleIdea, style: TravelStyle, where: string) => {
    if (used.has(idea.title)) return;
    used.add(idea.title);
    perStyle.get(style)!.push({
      title: idea.title,
      kind: "activity",
      style,
      detail: idea.detail,
      city: idea.city,
      tag: idea.tag,
      source: "rules",
      links: activityLinks(`${where} ${idea.search}`).slice(0, 2),
    });
  };
  for (const cc of countries) {
    const months = monthsIn(cc);
    const where = cities.find((c) => c.countryCode === cc)?.city ?? countryName(cc);
    for (const idea of STYLE_IDEAS[cc] ?? []) {
      // Filed under its main style (listed first) among the trip's styles.
      const style = idea.styles.find((st) => styles.includes(st));
      if (!style) continue;
      if (idea.months && !idea.months.some((m) => months.has(m))) continue;
      if (idea.city && !nearScope(idea.city, cc, cities, cityKeys)) continue;
      add(idea, style, idea.city ?? where);
    }
  }
  // Styles with little specific to suggest get a general idea, searched in the list's city.
  const where = cities[0]?.city ?? (list.place ? list.place.name : "");
  for (const style of styles)
    if (perStyle.get(style)!.length === 0)
      for (const idea of GENERIC_STYLE_IDEAS.filter((i) => i.styles[0] === style || (i.styles.includes(style) && !styles.includes(i.styles[0])))) add({ ...idea, title: where ? `${idea.title} in ${where}` : idea.title }, style, where);
  // Take turns so every style is represented.
  const queues = styles.map((st) => [...perStyle.get(st)!]);
  const out: ListSuggestion[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

function ruleIdeas(list: TripList, trip: Trip, items: ItineraryItem[], theme: ListTheme): ListSuggestion[] {
  const { cities, cityKeys, countries, monthsIn } = ideaScope(list, trip, items);
  // Seasonal ideas follow when you're actually in that country (no 6 January ideas if you've left by then).
  const out: (ListSuggestion & { seasonal: boolean })[] = [];
  for (const cc of countries) {
    const firstCity = cities.find((c) => c.countryCode === cc)?.city;
    const months = monthsIn(cc);
    for (const idea of IDEAS[cc] ?? []) {
      if (!themeMatches(idea, theme)) continue;
      if (idea.months && !idea.months.some((m) => months.has(m))) continue;
      // City-specific ideas only for the cities you're going to (when we know them).
      if (idea.city && !nearScope(idea.city, cc, cities, cityKeys)) continue;
      const where = idea.city ?? firstCity ?? countryName(cc);
      const links: Link[] =
        idea.kind === "place"
          ? [{ label: "Map", url: mapsSearch(`${idea.title}, ${where}`) }]
          : theme === "food" || theme === "drinks"
            ? [{ label: "Where to try it", url: mapsSearch(`${idea.title} near ${where}`) }]
            : [];
      out.push({ title: idea.title, kind: idea.kind, price: idea.price, detail: idea.detail, city: idea.city, tag: idea.tag, links, source: "rules", seasonal: !!idea.months });
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
  const booked = alreadyBooked(list, trip, items);
  const ai = ((await claudeIdeas(list, trip, items, theme)) ?? []).filter(fresh).filter(booked.unbooked);
  const seen = new Set(ai.map((s) => fold(s.title)));
  const rules = ruleIdeas(list, trip, items, theme).filter((s) => fresh(s) && !seen.has(fold(s.title))).filter(booked.unbooked);
  const shown = new Set([...ai, ...rules].map((s) => fold(s.title)));
  return {
    theme,
    suggestions: [...ai, ...rules].slice(0, 16),
    styles: trip.styles,
    styleIdeas: styleIdeas(list, trip, items, theme).filter((s) => fresh(s) && !shown.has(fold(s.title))).filter(booked.unbooked).slice(0, 12),
    bookedIdeas: [...new Set(booked.hidden)],
    bookedPicks: booked.bookedPicks,
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
    busy.set(day, (busy.get(day) ?? 0) + (i.kind === "flight" ? 10 : i.kind === "activity" && i.category !== "transfer" ? 2 : 0));
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

// ---------- Destination guides (made automatically, one per city you stay in) ----------

const flagOf = (cc: string) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
const samePlace = (a?: TripPlace, b?: TripPlace) => !!a && !!b && a.type === b.type && a.countryCode === b.countryCode && fold(a.name) === fold(b.name);

/** The places a trip's guides are for: cities from your flights, else the destinations you chose. */
function guideDestinations(trip: Trip, items: ItineraryItem[]): (TripPlace & { from?: string; to?: string })[] {
  const cities = tripCities(trip, items);
  const out: (TripPlace & { from?: string; to?: string })[] = [];
  for (const c of cities) {
    const existing = out.find((o) => fold(o.name) === fold(c.city) && o.countryCode === c.countryCode);
    if (existing) existing.to = c.to;
    else out.push({ type: "city", name: c.city, countryCode: c.countryCode, lat: c.lat, lon: c.lon, from: c.from, to: c.to });
  }
  if (out.length) return out;
  return (trip.places ?? []).map((p) => ({ ...p }));
}

/** Creates a guide for each destination that lacks one; drops empty guides for places no longer on the trip. */
export function ensureGuides(trip: Trip, items: ItineraryItem[]): boolean {
  const dests = guideDestinations(trip, items);
  let changed = false;
  for (const d of dests) {
    if (db.lists.some((l) => l.tripId === trip.id && l.auto && samePlace(l.place, d))) continue;
    const { from: _f, to: _t, ...place } = d;
    db.lists.push({ id: newId(), tripId: trip.id, auto: true, name: d.name, emoji: flagOf(d.countryCode), place, entries: [], createdAt: now() });
    changed = true;
  }
  const before = db.lists.length;
  db.lists = db.lists.filter((l) => !(l.tripId === trip.id && l.auto && !l.entries.length && !dests.some((d) => samePlace(l.place, d))));
  if (db.lists.length !== before) changed = true;
  // Guides in trip order (by arrival), before your own lists.
  const order = (l: TripList) => (l.auto ? dests.findIndex((d) => samePlace(l.place, d)) : 1000);
  const mine = db.lists.filter((l) => l.tripId === trip.id).sort((a, b) => order(a) - order(b));
  const others = db.lists.filter((l) => l.tripId !== trip.id);
  db.lists = [...others, ...mine];
  return changed;
}

/** Stays in a guide's city: those that start while you're there (or, without flights, that mention the city). */
export function guideStays(list: TripList, trip: Trip, items: ItineraryItem[]): StayItem[] {
  const dest = guideDestinations(trip, items).find((d) => samePlace(d, list.place));
  const stays = items.filter((i): i is StayItem => i.kind === "stay");
  if (dest?.from && dest.to) return stays.filter((s) => s.checkIn.slice(0, 10) >= dest.from! && s.checkIn.slice(0, 10) < dest.to!);
  const key = fold(list.place?.name ?? "");
  return stays.filter((s) => fold(`${s.address ?? ""} ${s.name}`).includes(key));
}

// How well an idea suits the trip's travel styles (list themes ↔ styles).
const THEME_TO_STYLE: Partial<Record<ListTheme, TravelStyle>> = { food: "food", drinks: "food", sights: "culture", nature: "nature", nightlife: "nightlife", shopping: "shopping" };
// Matching any of your styles moves an idea up; otherwise the curated order (most essential first) stands.
const styleScore = (trip: Trip, themes: ListTheme[] = [], styles: TravelStyle[] = []) =>
  Number(themes.some((t) => THEME_TO_STYLE[t] && trip.styles.includes(THEME_TO_STYLE[t]!)) || styles.some((s) => trip.styles.includes(s)));

// ---------- Already in the itinerary ----------

// Kinds of activity where one booking covers the idea, whatever each is called ("Mexican cooking class with a market
// visit" and "Traditional Cooking Class – Hands-On").
const SAME_KIND_OF_ACTIVITY = [
  /balloon/, /cooking (?:class|lesson|workshop)/, /lucha libre/, /food (?:walking )?tour/, /e ?bike|bike tour/, /snorkel/, /kayak/, /zip ?lin/,
  /horse ?back|horse riding/, /rafting/, /surf(?:ing)? (?:class|lesson)/, /scuba|\bdiving\b/, /whale/, /salsa (?:class|lesson)/, /wine tasting/, /temazcal/,
];
// Words any two tours might share. What's left names the actual thing (Teotihuacan, Embera, San Blas).
const ORDINARY_WORDS = new Set(`
  tour tours trip trips from with over into near around visit visits guided guide small group private shared full half
  experience adventure excursion activity class lesson workshop cooking culinary traditional local authentic hands recipe
  city town village center centre historic area community island islands hopping beach river lake park waterfall waterfalls
  springs caves canal locks market museum night sunset sunrise morning evening sunday rooftop walking bike ride boat rowing
  picnic ceremony quiet ecological tacos churros tequila mezcal dinner lunch breakfast drinks food street boozy
  the and for your this that best top must see
`.split(/\s+/).filter(Boolean));

const titleKey = (t: string) => fold(t).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// What names the actual thing: not ordinary tour words, nor the trip's own places ("Mexico" also covers "Mexican").
function distinctiveWords(title: string, placeNames: string[]) {
  const places = placeNames.flatMap((p) => titleKey(p).split(" ")).filter((w) => w.length >= 4);
  return titleKey(title).split(" ").filter((w) => w.length >= 4 && !ORDINARY_WORDS.has(w) && !places.some((p) => w.startsWith(p.slice(0, 5))));
}

/** Is this idea the same thing as something on the itinerary? Pass the trip's own place names, which say nothing. */
export function sameOuting(idea: string, booked: string, placeNames: string[] = []) {
  const [a, b] = [titleKey(idea), titleKey(booked)];
  if (a === b) return true;
  if (SAME_KIND_OF_ACTIVITY.some((kind) => kind.test(a) && kind.test(b))) return true;
  const words = new Set(distinctiveWords(booked, placeNames));
  return distinctiveWords(idea, placeNames).some((w) => words.has(w));
}

/**
 * Is this idea a place you've listed as part of a tour? Stricter than sameOuting, because you named the exact place: all
 * of the shorter name's words must be in the longer ("Museo Frida Kahlo" and "Frida Kahlo Museum", but not
 * "Chapultepec Castle" and "Bosque de Chapultepec").
 */
export function samePlaceName(idea: string, included: string, placeNames: string[] = []) {
  if (titleKey(idea) === titleKey(included)) return true;
  const [a, b] = [distinctiveWords(idea, placeNames), distinctiveWords(included, placeNames)];
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length > 0 && short.every((w) => long.includes(w));
}

/** What's on the itinerary for this list's place: activities, and places from any list that have a day. */
function bookedHere(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const stops = tripCities(trip, items).filter((c) =>
    list.place?.type === "city" ? fold(c.city) === fold(list.place.name) : !list.place || c.countryCode === list.place.countryCode,
  );
  // Only while you're in this place: a cooking class in another city doesn't cover this one.
  const during = (day: string) => stops.length === 0 || stops.some((c) => (!c.from || c.from <= day) && (!c.to || day <= c.to));
  const activities = items.flatMap((i) => (i.kind === "activity" && i.category !== "transfer" && during(i.start.slice(0, 10)) ? [i.title] : []));
  const included = items.flatMap((i) =>
    i.kind === "activity" && during(i.start.slice(0, 10)) ? (i.includes ?? []).map((place) => ({ place: place.title, tour: i.title })) : [],
  );
  const planned = tripLists(trip.id).flatMap((l) => l.entries.filter((e) => e.day && e.kind !== "thing" && during(e.day)).map((e) => e.title));
  const placeNames = [
    ...tripCities(trip, items).flatMap((c) => [c.city, countryName(c.countryCode)]),
    ...(trip.places ?? []).flatMap((p) => [p.name, countryName(p.countryCode)]),
    ...(list.place ? [list.place.name, countryName(list.place.countryCode)] : []),
  ];
  return { activities, planned, included, placeNames };
}

function alreadyBooked(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const { activities, planned, included, placeNames } = bookedHere(list, trip, items);
  const covers = (title: string, among: string[]) => among.find((b) => sameOuting(title, b, placeNames));
  const inTour = (title: string) => included.find((i) => samePlaceName(title, i.place, placeNames))?.tour;
  const hidden: string[] = [];
  return {
    /** Ideas you've booked or planned already. Food is left alone: tacos on a tour doesn't mean you've tried the dish. */
    unbooked: (s: ListSuggestion) => {
      if (s.kind === "thing" || !(covers(s.title, [...activities, ...planned]) || inTour(s.title))) return true;
      hidden.push(s.title);
      return false;
    },
    hidden,
    /** Your saved picks that have since been booked (the booking is the one on the itinerary). */
    bookedPicks: list.entries.flatMap((e) => {
      const tour = e.kind === "thing" ? undefined : inTour(e.title);
      const as = tour ?? (e.kind === "thing" ? undefined : covers(e.title, activities));
      return as ? [{ id: e.id, title: e.title, bookedAs: as, inTour: !!tour }] : [];
    }),
  };
}

export function guideSuggestions(list: TripList, trip: Trip, items: ItineraryItem[]) {
  const taken = new Set([...list.entries.map((e) => fold(e.title)), ...(list.dismissed ?? []).map(fold)]);
  const fresh = (s: ListSuggestion) => !taken.has(fold(s.title));
  const city = list.place?.type === "city" ? list.place.name : undefined;
  const ideaThemes = new Map((IDEAS[list.place?.countryCode ?? ""] ?? []).map((i) => [i.title, i.themes]));

  // Restaurants: well-known places for the city, then food markets and halls from the guide.
  const cc = list.place?.countryCode ?? "";
  const here = list.place?.lat !== undefined && list.place.lon !== undefined ? { lat: list.place.lat, lon: list.place.lon } : undefined;
  // Restaurants for the city, or nearby (Manila's for a stay in Antipolo); for a whole country, its main listing.
  const curated = Object.entries(RESTAURANTS)
    .filter(([k]) => {
      const at = cityCentre(k, cc);
      return !!at && (!here || distanceKm(at, here) < 60);
    })
    .flatMap(([, list]) => list)
    .map((r, i) => ({ r, i, score: styleScore(trip, [], r.styles) - (r.styles?.includes("luxury") && trip.styles.includes("budget") ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ r }): ListSuggestion => ({
      title: r.title, kind: "place", price: r.price, detail: r.detail, city, tag: r.tag, source: "rules",
      links: [{ label: "Map", url: mapsSearch(`${r.title}, ${city}`) }],
    }));
  const foodIdeas = ruleIdeas(list, trip, items, "food");
  const markets = foodIdeas.filter((s) => s.kind === "place");
  const restaurants = [...curated, ...markets.filter((m) => !curated.some((c) => fold(c.title) === fold(m.title)))].filter(fresh);
  const food = foodIdeas.filter((s) => s.kind === "thing").filter(fresh);

  // Must-visit: sights and nature spots, best match for your styles first (keeping the curated order otherwise).
  const eatTitles = new Set(restaurants.map((r) => r.title));
  const seen = new Set<string>();
  const sights = [...ruleIdeas(list, trip, items, "sights"), ...ruleIdeas(list, trip, items, "nature")]
    .filter((s) => s.kind === "place" && !eatTitles.has(s.title) && !seen.has(s.title) && (seen.add(s.title), true))
    .map((s, i) => ({ s, i, score: styleScore(trip, ideaThemes.get(s.title)) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ s }) => s)
    .filter(fresh);

  const booked = alreadyBooked(list, trip, items);
  const activities = styleIdeas(list, trip, items, "general").filter(fresh).filter(booked.unbooked);

  // No built-in guide for this country: useful searches rather than empty sections.
  const where = city ?? (cc ? countryName(cc) : trip.destination);
  const search = (title: string, kind: ListSuggestion["kind"], detail: string, query: string, label: string): ListSuggestion => ({ title, kind, detail, source: "rules", links: [{ label, url: mapsSearch(query) }] });
  if (!IDEAS[cc]) {
    if (!restaurants.length) restaurants.push(search(`Top-rated restaurants in ${where}`, "place", "Opens a map search so you can compare ratings, photos and prices, then add your favourites.", `best restaurants in ${where}`, "Search restaurants"));
    if (!food.length) food.push(search(`Local dishes in ${where}`, "thing", "Search what to try here, then add the dishes you want with + Add your own.", `traditional food in ${where}`, "Search local food"));
    if (!sights.length) sights.push(search(`Top sights in ${where}`, "place", "Opens a map search for the best-known attractions here.", `top attractions in ${where}`, "Search sights"));
  }
  const visibleSights = sights.filter(booked.unbooked);
  const stays = guideStays(list, trip, items);
  const near = stays.map((s) => ({ label: `Restaurants near ${s.name}`, url: mapsSearch(`restaurants near ${s.address ?? s.name}`) }));
  return {
    theme: "guide",
    guide: { restaurants: restaurants.slice(0, 10), food: food.slice(0, 12), activities: activities.slice(0, 12), sights: visibleSights.slice(0, 12) },
    bookedIdeas: [...new Set(booked.hidden)],
    bookedPicks: booked.bookedPicks,
    suggestions: [],
    styles: trip.styles,
    styleIdeas: [],
    finders: [...near, ...finders("food", city ? [{ city }] : []), ...finders("sights", city ? [{ city }] : [])],
    ai: aiEnabled(),
  };
}

// ---------- Links on saved entries ----------

/** "Where to try it" for food, tour searches for things to do, and a map search for places not yet on the map. */
export function entryLinks(entry: ListEntry, list: TripList, trip: Trip, items: ItineraryItem[]): Link[] | undefined {
  const where = list.place?.type === "city" ? list.place.name : listCities(list, trip, items)[0]?.city ?? (list.place ? countryName(list.place.countryCode) : "");
  if (entry.kind === "thing") return [{ label: "Where to try it", url: mapsSearch(`${entry.title} near ${where}`) }];
  if (entry.kind === "activity") return activityLinks(`${where} ${entry.title}`).slice(0, 2);
  if (entry.lat === undefined) return [{ label: "Map", url: mapsSearch(`${entry.title}, ${where}`) }];
  return undefined; // places on the map get a Map link from their coordinates
}

/** Gives links to saved entries that don't have any (e.g. added before links were kept). Returns whether anything changed. */
export function fillEntryLinks(trip: Trip, items: ItineraryItem[]): boolean {
  let changed = false;
  for (const list of db.lists.filter((l) => l.tripId === trip.id))
    for (const e of list.entries)
      if (!e.links?.length) {
        const links = entryLinks(e, list, trip, items);
        if (links) {
          e.links = links;
          changed = true;
        }
      }
  return changed;
}
