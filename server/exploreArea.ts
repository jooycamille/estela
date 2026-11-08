import type { ActivityItem, ExplorePlace, ExploreIdea, ExploreIdeas, ItineraryItem, Trip, TripList } from "../shared/types.ts";
import { nominatim } from "./lodging.ts";

// When a day just says a town ("Sample Town"), what's actually there: places to visit, things to do and where to eat, from
// OpenStreetMap. Only named places the map lists, so a small town may have few, and no ratings or opening hours.

type Found = { name?: string; category?: string; type?: string; addresstype?: string; lat: string; lon: string; display_name?: string };

const AREA_TYPES = new Set(["city", "town", "village", "hamlet", "municipality", "county", "suburb", "city_district", "state", "region", "island"]);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const firstPart = (s: string) => s.split(",")[0].trim();

/** A name and region, with nothing that points at one spot: no street number, plus code or long address. */
export const mightBeArea = (text: string) => !/\d/.test(text) && text.split(",").length <= 4;

async function isArea(text: string) {
  const [hit] = await nominatim<Found[]>(`/search?format=jsonv2&q=${encodeURIComponent(text)}&limit=1`);
  return !!hit && AREA_TYPES.has(hit.addresstype ?? hit.type ?? "");
}

/** Where on the trip a day names only a town or area, once each per day, with the list to save suggestions to. */
export async function broadPlaces(trip: Trip, items: ItineraryItem[], lists: TripList[], guideDays: { listId: string; from?: string; to?: string }[]): Promise<ExplorePlace[]> {
  const guideFor = (day: string) => guideDays.find((g) => (!g.from || g.from <= day) && (!g.to || day <= g.to))?.listId ?? lists.find((l) => l.auto)?.id;
  const candidates: (Omit<ExplorePlace, "listId"> & { text: string; listId?: string })[] = [
    ...items
      .filter((i): i is ActivityItem & { location: string; lat: number; lon: number } => i.kind === "activity" && i.category !== "transfer" && !!i.location && i.lat !== undefined && i.lon !== undefined)
      .map((a) => ({ day: a.start.slice(0, 10), name: firstPart(a.location), lat: a.lat, lon: a.lon, text: a.location })),
    ...lists.flatMap((l) =>
      l.entries
        .filter((e) => !!e.day && e.kind === "place" && e.address && e.lat !== undefined && e.lon !== undefined)
        .map((e) => ({ day: e.day!, name: firstPart(e.address!), lat: e.lat!, lon: e.lon!, text: e.address!, listId: l.id })),
    ),
  ];
  const guides = new Set(lists.filter((l) => l.auto).map((l) => fold(l.name)));
  const out: ExplorePlace[] = [];
  for (const c of candidates) {
    if (!mightBeArea(c.text) || guides.has(fold(c.name))) continue; // a city with a guide has all this already
    if (out.some((o) => o.day === c.day && fold(o.name) === fold(c.name))) continue;
    if (!(await isArea(c.text).catch(() => false))) continue;
    const listId = c.listId ?? guideFor(c.day);
    if (listId) out.push({ day: c.day, name: c.name, lat: c.lat, lon: c.lon, listId });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

const NEARBY = 0.03; // degrees either way, about 3 km: the town and what's just outside it
const EACH = 6;
const CHURCH = /catedral|cathedral|bas[ií]lica|iglesia|church|santuario|capilla|chapel/i;

/** Searches run one at a time, so a town's first look takes several seconds. They're kept for a day (see nominatim). */
export async function exploreIdeas(near: { lat: number; lon: number }, name: string): Promise<ExploreIdeas> {
  const box = [near.lon - NEARBY, near.lat + NEARBY, near.lon + NEARBY, near.lat - NEARBY].map((n) => n.toFixed(4)).join(",");
  const search = async (q: string, label: string, keep: (f: Found) => boolean = () => true): Promise<ExploreIdea[]> => {
    const found = await nominatim<Found[]>(`/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${box}&bounded=1&limit=10`).catch(() => [] as Found[]);
    return found.filter((f) => !!f.name?.trim() && keep(f)).map((f) => ({ title: f.name!.trim(), label, lat: Number(f.lat), lon: Number(f.lon), address: f.display_name }));
  };
  const sights = [...(await search("museum", "Museum")), ...(await search("church", "Church", (f) => CHURCH.test(f.name ?? ""))), ...(await search("park", "Park"))];
  const toDo = [...(await search("viewpoint", "Viewpoint")), ...(await search("attraction", "Attraction"))];
  const eat = [...(await search("restaurant", "Restaurant")), ...(await search("cafe", "Café"))];
  const once = (ideas: ExploreIdea[], taken: Set<string>) =>
    ideas.filter((i) => {
      const key = fold(i.title);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    }).slice(0, EACH);
  const taken = new Set<string>();
  const where = encodeURIComponent(name);
  return {
    sights: once(sights, taken),
    toDo: once(toDo, taken),
    eat: once(eat, taken),
    links: [
      { label: `Tours in ${name}`, url: `https://www.getyourguide.com/s/?q=${where}` },
      { label: "Restaurant ratings", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`restaurants in ${name}`)}` },
      { label: "Things to do on Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`things to do in ${name}`)}` },
    ],
  };
}
