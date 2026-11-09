import type { ItineraryItem, MapFlight, MapPoint, Trip, TripList, TripMapData } from "../shared/types.ts";
import { activityDays } from "../shared/days.ts";
import { getAirport } from "./airports.ts";
import { dayPlaces } from "./dayInfo.ts";
import { stayPosition } from "./essentials.ts";
import { searchLodging } from "./lodging.ts";

// Everything on a trip that has a place: where you sleep, what you've booked, places saved in guides and lists, and
// the flights between. Stays without a saved position are looked up (a few per visit, then remembered).

const NEW_LOOKUPS = 6; // stays and activities looked up for the first time, per visit (the map service asks for one a second)

type LatLon = { lat: number; lon: number };
const found = new Map<string, LatLon | null>(); // an activity's Where, looked up: kept while the server runs

const km = (a: LatLon, b: LatLon) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));

/** A place named in an activity's Where ("Plaza Inventada", "Museo de Arte, Centro"), nearest to where you are that day. */
async function placeNear(text: string, near: LatLon): Promise<LatLon | undefined> {
  const hits = await searchLodging(text, near, "any").catch(() => []);
  const hit = hits.find((h) => km(h, near) < 80);
  return hit && { lat: hit.lat, lon: hit.lon };
}

export async function tripMap(trip: Trip, items: ItineraryItem[], lists: TripList[]): Promise<TripMapData> {
  const points: MapPoint[] = [];
  const flights: MapFlight[] = [];
  let missing = 0;
  const where = dayPlaces(trip, items);
  let lookups = 0;
  for (const i of items) {
    if (i.kind === "flight") {
      const a = getAirport(i.from), b = getAirport(i.to);
      if (a && b) flights.push({ id: i.id, title: `${i.flightNumber} ${a.iata} → ${b.iata}`, day: i.departureTime.slice(0, 10), from: { code: a.iata, lat: a.lat, lon: a.lon }, to: { code: b.iata, lat: b.lat, lon: b.lon } });
    } else if (i.kind === "stay") {
      const day = i.checkIn.slice(0, 10);
      const near = where[day] ?? Object.values(where)[0];
      const fresh = i.lat === undefined && lookups < NEW_LOOKUPS;
      const at = near || i.lat !== undefined ? await stayPosition(i, near ?? { lat: i.lat!, lon: i.lon! }) : undefined;
      if (fresh) lookups++;
      if (at) points.push({ id: i.id, kind: "stay", title: i.name, lat: at.lat, lon: at.lon, day, until: i.checkOut.slice(0, 10), sub: i.address });
      else missing++;
    } else {
      if (i.category === "transfer") continue; // a ride goes between places; it isn't one
      const day = activityDays(i)[0];
      // Where it happens: the place picked for it, else its Where looked up on the map (near where you are that day).
      let at = i.lat !== undefined && i.lon !== undefined ? { lat: i.lat, lon: i.lon } : undefined;
      if (!at && i.location && where[day]) {
        const key = `${i.location}|${where[day].lat.toFixed(1)},${where[day].lon.toFixed(1)}`;
        if (found.has(key)) at = found.get(key) ?? undefined;
        else if (lookups < NEW_LOOKUPS) {
          lookups++;
          at = await placeNear(i.location, where[day]);
          found.set(key, at ?? null);
        }
      }
      if (at) points.push({ id: i.id, kind: "activity", title: i.title, lat: at.lat, lon: at.lon, day, sub: i.location });
      // And the places a tour takes you to.
      // (Not one that's the activity's own place: its Where, added as a stop, at the same spot.)
      const stops = (i.includes ?? []).filter((p) => p.lat !== undefined && p.lon !== undefined && !(at && km(at, { lat: p.lat, lon: p.lon! }) < 0.3) && p.title !== i.location);
      stops.forEach((p, n) => points.push({ id: `${i.id}:${n}`, kind: "activity", title: p.title, lat: p.lat!, lon: p.lon!, day, sub: `With ${i.title}` }));
      if (!at && !stops.length) missing++;
    }
  }
  for (const l of lists) {
    for (const e of l.entries) {
      if (e.lat === undefined || e.lon === undefined) continue;
      points.push({ id: e.id, kind: "place", title: e.title, lat: e.lat, lon: e.lon, day: e.day, sub: e.area ?? l.name, listId: l.id, done: e.done || undefined });
    }
  }
  return { points, flights, missing };
}
