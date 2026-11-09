import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DayLeg } from "../shared/types.ts";
import { DATA_DIR } from "./db.ts";

// Walking and driving times between two places, from the OpenStreetMap community's routing servers (FOSSGIS,
// routing.openstreetmap.de: OSRM over OpenStreetMap data). Asked one at a time, and each answer is kept on this Mac, so
// a route is only ever asked for once. No public transport: each leg links to directions that can show it.

type LatLon = { lat: number; lon: number };
type Route = { minutes: number; km: number } | null; // null: no route (an island, a gap in the map)

const BASE = "https://routing.openstreetmap.de";
const UA = "Estela-travel-app/0.1 (https://github.com/jooycamille/hey-joy)";
const PATH = join(DATA_DIR, "routes-cache.json");
const KEEP = 60 * 24 * 3600_000; // roads change slowly

let cache: Record<string, { at: number; route: Route }> = (() => {
  try {
    return existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : {};
  } catch {
    return {};
  }
})();
let dirty = false;
const flush = () => {
  if (!dirty) return;
  dirty = false;
  writeFileSync(PATH, JSON.stringify(cache));
};

const at = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`; // ~10 m: the same place, the same route
export const straightKm = (a: LatLon, b: LatLon) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

let last = 0;
let queue: Promise<unknown> = Promise.resolve();

/** One route, from the cache or the server (politely: one request at a time, a moment apart). */
function route(profile: "foot" | "car", a: LatLon, b: LatLon): Promise<Route | undefined> {
  const key = `${profile}|${at(a)}|${at(b)}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < KEEP) return Promise.resolve(hit.route);
  const run = async (): Promise<Route | undefined> => {
    const wait = 300 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(`${BASE}/routed-${profile}/route/v1/driving/${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}?overview=false&alternatives=false&steps=false`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return undefined; // busy or down: try again another time
      const body = (await res.json()) as { code?: string; routes?: { duration: number; distance: number }[] };
      const r = body.code === "Ok" && body.routes?.[0];
      const value: Route = r ? { minutes: Math.max(1, Math.round(r.duration / 60)), km: Math.round(r.distance / 100) / 10 } : null;
      cache[key] = { at: Date.now(), route: value };
      dirty = true;
      return value;
    } catch {
      return undefined;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

const known = (profile: "foot" | "car", a: LatLon, b: LatLon) => !!cache[`${profile}|${at(a)}|${at(b)}`];

const WALK_MAX = 25; // minutes: further than this on foot, it's shown by car (with a link to public transport)

const directions = (a: LatLon, b: LatLon, mode: "walking" | "driving" | "transit") =>
  `https://www.google.com/maps/dir/?api=1&origin=${at(a)}&destination=${at(b)}&travelmode=${mode}`;

/**
 * How to get from one place to the next: on foot when it's a short walk, else by car. `budget` counts the requests
 * still allowed in this visit (cached routes are free); undefined when it isn't known (yet).
 */
export async function legBetween(a: LatLon, b: LatLon, budget: { left: number }, getAround: "transit" | "car" = "transit"): Promise<DayLeg | undefined> {
  const straight = straightKm(a, b);
  if (straight < 0.05) return undefined; // the same place
  const ask = async (profile: "foot" | "car") => {
    if (!known(profile, a, b)) {
      if (budget.left <= 0) return undefined;
      budget.left--;
    }
    return route(profile, a, b);
  };
  if (straight <= 2.5) {
    const walk = await ask("foot");
    if (walk === undefined) return undefined;
    if (walk && walk.minutes <= WALK_MAX) return { mode: "walk", ...walk, url: directions(a, b, "walking") };
  }
  const car = await ask("car");
  if (!car) return undefined;
  if (getAround === "car") return { mode: "drive", ...car, url: directions(a, b, "driving"), transitUrl: directions(a, b, "transit") };
  // No public transport timetables here: an estimate from the road route (buses and trains are slower, with a walk and
  // a wait at each end), rounded to 5 minutes. Its link opens real times.
  const minutes = Math.max(10, Math.round((car.minutes * 1.6 + 10) / 5) * 5);
  return { mode: "transit", minutes, km: car.km, url: directions(a, b, "transit"), driveUrl: directions(a, b, "driving") };
}

export const saveRoutes = flush;
