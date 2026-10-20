import type { FlightChange, FlightItem, FlightLive, FlightScheduleLeg, FlightStatusCode } from "../shared/types.ts";
import { db, now, save } from "./db.ts";
import { airlabs } from "./airlabs.ts";
import { aviationstack } from "./aviationstack.ts";
import { flightServices, recordUsage, usage, type AeroDataBoxRoute, type FlightDataConfig } from "./settings.ts";

/** A flight data provider: latest status for a booked flight, and the schedule for a flight number on a date. */
interface FlightProvider {
  name: string;
  lookup(flight: FlightItem): Promise<FlightLive | null>;
  schedule(flightNumber: string, date: string): Promise<FlightScheduleLeg[]>;
}

// ---------- AeroDataBox (via RapidAPI) ----------
// Free tier available: https://rapidapi.com/aedbx-aedbx/api/aerodatabox

const AERODATABOX_STATUS: Record<string, FlightStatusCode> = {
  Expected: "scheduled",
  CheckIn: "on_time",
  Boarding: "boarding",
  GateClosed: "boarding",
  Departed: "departed",
  EnRoute: "departed",
  Approaching: "departed",
  Delayed: "delayed",
  Arrived: "landed",
  Landed: "landed",
  Canceled: "cancelled",
  CanceledUncertain: "cancelled",
  Diverted: "diverted",
};

interface AdbMovement {
  airport?: { iata?: string; name?: string; shortName?: string; municipalityName?: string };
  scheduledTime?: { local?: string };
  revisedTime?: { local?: string };
  predictedTime?: { local?: string };
  terminal?: string;
  gate?: string;
}
interface AdbFlight {
  number?: string;
  status?: string;
  airline?: { name?: string };
  aircraft?: { model?: string };
  departure?: AdbMovement;
  arrival?: AdbMovement;
}

// "2026-11-03 08:15+11:00" -> "2026-11-03T08:15"
const adbLocal = (s?: string) => (s ? s.slice(0, 16).replace(" ", "T") : undefined);

// AeroDataBox is sold through three routes with the same API but different hosts and key headers.
const ROUTES: Record<AeroDataBoxRoute, { base: string; headers: (key: string) => Record<string, string> }> = {
  rapidapi: { base: "https://aerodatabox.p.rapidapi.com", headers: (k) => ({ "X-RapidAPI-Key": k, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }) },
  apimarket: { base: "https://prod.api.market/api/v1/aedbx/aerodatabox", headers: (k) => ({ "x-api-market-key": k }) },
  direct: { base: "https://api.aerodatabox.com", headers: (k) => ({ "X-Api-Key": k }) },
};
const UNITS_PER_LOOKUP = 2; // "Flight Status (single day)" is a Tier 2 endpoint

export class FlightDataError extends Error {}

const aeroDataBox = (route: AeroDataBoxRoute, apiKey: string): FlightProvider => {
  async function fetchLegs(flightNumber: string, date: string): Promise<AdbFlight[]> {
    const { headers } = ROUTES[route];
    const base = process.env.AERODATABOX_BASE_URL ?? ROUTES[route].base; // override for tests
    // dateLocalRole=Departure: only flights *departing* that day (the default also matches arrivals).
    const url = `${base}/flights/number/${encodeURIComponent(flightNumber)}/${date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false`;
    const res = await fetch(url, { headers: headers(apiKey), signal: AbortSignal.timeout(15_000) });
    if (res.status !== 401 && res.status !== 403 && res.status < 500) recordUsage("aerodatabox", UNITS_PER_LOOKUP);
    if (res.status === 204 || res.status === 404) return [];
    if (res.status === 401 || res.status === 403) throw new FlightDataError("The flight data API key was rejected — check it in Flight data settings.");
    if (res.status === 429) throw new FlightDataError("Flight data limit reached (monthly allowance or 1 request/second). Try again later.");
    if (res.status === 400) return []; // e.g. date outside the plan's range
    if (!res.ok) throw new FlightDataError(`Flight data service error (${res.status}).`);
    return (await res.json()) as AdbFlight[];
  }
  const airportName = (a?: AdbMovement["airport"]) => a?.municipalityName ?? a?.shortName ?? a?.name;

  return {
    name: "aerodatabox",
    async schedule(flightNumber, date) {
      return (await fetchLegs(flightNumber, date))
        .filter((f) => f.departure?.airport?.iata && f.arrival?.airport?.iata && f.departure.scheduledTime?.local)
        .map((f) => ({
          flightNumber,
          airline: f.airline?.name,
          from: f.departure!.airport!.iata!,
          fromName: airportName(f.departure!.airport),
          to: f.arrival!.airport!.iata!,
          toName: airportName(f.arrival!.airport),
          departureTime: adbLocal(f.departure!.scheduledTime!.local)!,
          arrivalTime: adbLocal(f.arrival!.scheduledTime?.local),
          departureTerminal: f.departure!.terminal,
          arrivalTerminal: f.arrival!.terminal,
          aircraft: f.aircraft?.model,
        }));
    },
    async lookup(flight) {
      const flights = await fetchLegs(flight.flightNumber, flight.departureTime.slice(0, 10));
      // Codeshares/multi-leg: prefer the leg departing from the booked airport.
      const leg =
        flights.find((f) => f.departure?.airport?.iata?.toUpperCase() === flight.from.toUpperCase()) ?? flights[0];
      if (!leg) return null;
      const dep = leg.departure ?? {};
      const arr = leg.arrival ?? {};
      const depTime = adbLocal(dep.revisedTime?.local ?? dep.predictedTime?.local ?? dep.scheduledTime?.local);
      let status = AERODATABOX_STATUS[leg.status ?? ""] ?? "unknown";
      const scheduled = adbLocal(dep.scheduledTime?.local);
      if ((status === "scheduled" || status === "on_time") && depTime && scheduled && depTime > scheduled) status = "delayed";
      return {
        status,
        departureTime: depTime,
        arrivalTime: adbLocal(arr.revisedTime?.local ?? arr.predictedTime?.local ?? arr.scheduledTime?.local),
        departureTerminal: dep.terminal,
        departureGate: dep.gate,
        arrivalTerminal: arr.terminal,
        arrivalGate: arr.gate,
        checkedAt: now(),
        provider: "aerodatabox",
      };
    },
  };
};

// ---------- Mock provider (no API key; for development) ----------
// Deterministic per flight so results are stable; use simulateChange() to test alerts.

const mockOverrides = new Map<string, Partial<FlightLive>>();

// A few sample schedules so the lookup flow can be tried without an API key. Times are local;
// "+1" means the next day. Unknown flight numbers return nothing (the user enters details manually).
type MockLeg = [from: string, fromName: string, dep: string, to: string, toName: string, arr: string, depT?: string, arrT?: string];
const MOCK_SCHEDULES: Record<string, { airline: string; aircraft: string; legs: MockLeg[] }> = {
  QF1: { airline: "Qantas", aircraft: "Airbus A380", legs: [["SYD", "Sydney", "15:35", "SIN", "Singapore", "20:55", "1", "1"], ["SIN", "Singapore", "22:30", "LHR", "London", "05:20+1", "1", "3"]] },
  SQ232: { airline: "Singapore Airlines", aircraft: "Airbus A350-900", legs: [["SYD", "Sydney", "23:55", "SIN", "Singapore", "06:05+1", "1", "3"]] },
  SQ221: { airline: "Singapore Airlines", aircraft: "Airbus A380", legs: [["SIN", "Singapore", "20:10", "SYD", "Sydney", "06:15+1", "3", "1"]] },
  BA15: { airline: "British Airways", aircraft: "Boeing 777-300ER", legs: [["LHR", "London", "21:15", "SIN", "Singapore", "17:45+1", "5", "1"], ["SIN", "Singapore", "19:15+1", "SYD", "Sydney", "05:20+2", "1", "1"]] },
  QF401: { airline: "Qantas", aircraft: "Boeing 737-800", legs: [["SYD", "Sydney", "06:00", "MEL", "Melbourne", "07:35", "3", "1"]] },
  JQ501: { airline: "Jetstar", aircraft: "Airbus A321neo", legs: [["MEL", "Melbourne", "06:00", "SYD", "Sydney", "07:25", "4", "2"]] },
  VA811: { airline: "Virgin Australia", aircraft: "Boeing 737-800", legs: [["SYD", "Sydney", "07:00", "MEL", "Melbourne", "08:35", "2", "3"]] },
  EK413: { airline: "Emirates", aircraft: "Airbus A380", legs: [["SYD", "Sydney", "21:15", "DXB", "Dubai", "05:20+1", "1", "3"]] },
  UA870: { airline: "United Airlines", aircraft: "Boeing 787-9", legs: [["SFO", "San Francisco", "23:00", "SYD", "Sydney", "07:15+2", "I", "1"]] },
};

function mockTime(date: string, hhmm: string) {
  const [time, plus] = hhmm.split("+");
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(plus ?? 0));
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

const mock: FlightProvider = {
  name: "mock",
  async schedule(flightNumber, date) {
    const entry = MOCK_SCHEDULES[flightNumber];
    if (!entry) return [];
    return entry.legs.map(([from, fromName, dep, to, toName, arr, depT, arrT]) => ({
      flightNumber,
      airline: entry.airline,
      aircraft: entry.aircraft,
      from, fromName, to, toName,
      departureTime: mockTime(date, dep),
      arrivalTime: mockTime(date, arr),
      departureTerminal: depT,
      arrivalTerminal: arrT,
    }));
  },
  async lookup(flight) {
    const hash = [...flight.flightNumber].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const gate = `${"ABCD"[hash % 4]}${(hash % 40) + 1}`;
    return {
      status: "on_time",
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      departureTerminal: String((hash % 3) + 1),
      departureGate: gate,
      checkedAt: now(),
      provider: "mock",
      ...mockOverrides.get(flight.id),
    };
  },
};

export function simulateChange(flight: FlightItem) {
  const shift = (t: string | undefined, mins: number) => {
    if (!t) return t;
    const d = new Date(`${t}:00Z`);
    d.setUTCMinutes(d.getUTCMinutes() + mins);
    return d.toISOString().slice(0, 16);
  };
  const delay = 45 + Math.floor(Math.random() * 90);
  mockOverrides.set(flight.id, {
    status: "delayed",
    departureTime: shift(flight.departureTime, delay),
    arrivalTime: shift(flight.arrivalTime, delay),
    departureGate: `G${Math.floor(Math.random() * 30) + 1}`,
  });
}

const instances = new Map<string, FlightProvider>();

/** A client for one configured service (cached per key/settings). */
export function serviceProvider(c: FlightDataConfig): FlightProvider {
  const key = `${c.provider}|${c.route}|${c.apiKey}|${c.allowHttp}`;
  let p = instances.get(key);
  if (!p) {
    p = c.provider === "aviationstack" ? aviationstack(c.apiKey, !!c.allowHttp)
      : c.provider === "airlabs" ? airlabs(c.apiKey)
      : aeroDataBox(c.route ?? "rapidapi", c.apiKey);
    instances.set(key, p);
  }
  return p;
}

const withinAllowance = (c: FlightDataConfig) => {
  const { used, limit } = usage(c.provider);
  return used < limit;
};

/**
 * Look up a schedule using the configured services in order (primary first). A service that errors, has used its
 * monthly allowance, or doesn't know the flight hands over to the next one. Returns which service answered.
 */
export async function scheduleFromServices(flightNumber: string, date: string): Promise<{ legs: FlightScheduleLeg[]; provider: string }> {
  const services = flightServices();
  if (!services.length) return { legs: await mock.schedule(flightNumber, date), provider: "mock" };
  let firstError: unknown;
  let anyAnswered = false;
  for (const c of services.filter(withinAllowance)) {
    try {
      const legs = await serviceProvider(c).schedule(flightNumber, date);
      anyAnswered = true;
      if (legs.length) return { legs, provider: c.provider };
    } catch (err) {
      firstError ??= err;
      console.warn(`Flight lookup via ${c.provider} failed:`, (err as Error).message);
    }
  }
  if (anyAnswered) return { legs: [], provider: services[0].provider };
  if (firstError) throw firstError;
  throw new FlightDataError("Every flight data service has used its monthly allowance.");
}

/** The active flight data: the configured services with fallback (or the demo data when none are set up). */
export function getProvider(): FlightProvider {
  const services = flightServices();
  if (!services.length) return mock;
  return {
    name: services[0].provider,
    schedule: async (flightNumber, date) => (await scheduleFromServices(flightNumber, date)).legs,
    async lookup(flight) {
      let firstError: unknown;
      for (const c of services.filter(withinAllowance)) {
        try {
          const live = await serviceProvider(c).lookup(flight);
          if (live) return live;
        } catch (err) {
          firstError ??= err;
        }
      }
      if (firstError) throw firstError;
      return null;
    },
  };
}

// ---------- Change detection ----------

const TRACKED: [keyof FlightLive, string][] = [
  ["status", "Status"],
  ["departureTime", "Departure time"],
  ["arrivalTime", "Arrival time"],
  ["departureTerminal", "Departure terminal"],
  ["departureGate", "Departure gate"],
  ["arrivalTerminal", "Arrival terminal"],
];

function diff(flight: FlightItem, next: FlightLive): FlightChange[] {
  const prev: Partial<FlightLive> = flight.live ?? {
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
  };
  const changes: FlightChange[] = [];
  for (const [field, label] of TRACKED) {
    const before = prev[field] as string | undefined;
    const after = next[field] as string | undefined;
    // First lookup: only report deviations from the booked schedule, not newly assigned gates.
    if (!flight.live && field !== "departureTime" && field !== "arrivalTime" && field !== "status") continue;
    if (!flight.live && field === "status" && !["delayed", "cancelled", "diverted"].includes(after ?? "")) continue;
    if (after !== undefined && after !== before) {
      changes.push({ at: now(), field: label, from: before, to: after, acknowledged: false });
    }
  }
  return changes;
}

export async function refreshFlight(flight: FlightItem): Promise<FlightChange[]> {
  const live = await getProvider().lookup(flight);
  if (!live) return [];
  const changes = diff(flight, live);
  flight.live = live;
  flight.changes.push(...changes);
  save();
  return changes;
}

const HOUR = 3600_000;

/**
 * How often to re-check a flight, by hours until departure. Changes matter more (and happen more) close to
 * departure, and real flight-data plans are metered (the free plan is ~200 lookups a month).
 */
function recheckInterval(hoursToDeparture: number) {
  if (hoursToDeparture > 24) return 12 * HOUR; // 1–3 days out: twice a day
  if (hoursToDeparture > 6) return 3 * HOUR; // on the day
  return 30 * 60_000; // last 6 hours, and while in the air
}

/** Refresh flights that depart in the next 3 days or departed in the last 12 hours, each at its own cadence. */
export async function refreshDueFlights({ force = false, tripId }: { force?: boolean; tripId?: string } = {}) {
  const nowMs = Date.now();
  const real = getProvider().name !== "mock";
  // Keep the last 10% of each service's monthly allowance for lookups you do yourself.
  const nearLimit = flightServices().every((c) => {
    const { used, limit } = usage(c.provider);
    return used >= limit * 0.9;
  });
  if (real && !force && nearLimit) return { checked: 0, changed: 0, paused: true };
  const due = db.items.filter((i): i is FlightItem => {
    if (i.kind !== "flight" || (tripId && i.tripId !== tripId)) return false;
    if (i.live?.status === "landed" || i.live?.status === "cancelled") return false;
    const dep = new Date(i.departureTime).getTime(); // airport-local time read as server-local: fine for a window check
    if (dep < nowMs - 12 * HOUR || dep > nowMs + 3 * 24 * HOUR) return false;
    if (force || !i.live) return true;
    const interval = real ? recheckInterval((dep - nowMs) / HOUR) : 10 * 60_000;
    return nowMs - new Date(i.live.checkedAt).getTime() > interval;
  });
  let changed = 0;
  for (const flight of due) {
    try {
      changed += (await refreshFlight(flight)).length;
    } catch (err) {
      console.warn(`Flight refresh failed for ${flight.flightNumber}:`, (err as Error).message);
    }
  }
  return { checked: due.length, changed };
}

/** Demo status from before real flight data was connected would show made-up gates and times: drop it. */
function clearDemoStatus() {
  if (!flightServices().length) return;
  let cleared = 0;
  for (const i of db.items) {
    if (i.kind === "flight" && i.live?.provider === "mock") {
      i.live = undefined;
      i.changes = i.changes.filter((c) => c.acknowledged);
      cleared++;
    }
  }
  if (cleared) {
    save();
    console.log(`Cleared demo flight status from ${cleared} flight(s); real status will be fetched closer to departure.`);
  }
}

export function startFlightPoller() {
  clearDemoStatus();
  const minutes = Number(process.env.FLIGHT_POLL_MINUTES ?? 15);
  console.log(`Flight status: provider=${getProvider().name}, checking every ${minutes} min (each flight at its own cadence)`);
  const tick = () => refreshDueFlights().catch((e) => console.warn("Flight poll failed:", e));
  setInterval(tick, minutes * 60_000);
  setTimeout(tick, 5_000);
}

// Lookups are triggered while the user types, so cache them to protect the provider's quota.
const scheduleCache = new Map<string, { at: number; legs: FlightScheduleLeg[]; provider: string }>();

export async function lookupSchedule(flightNumber: string, date: string) {
  const key = `${flightNumber}|${date}`;
  const hit = scheduleCache.get(key);
  if (hit && Date.now() - hit.at < 24 * HOUR) return { legs: hit.legs, provider: hit.provider }; // schedules rarely change
  const result = await scheduleFromServices(flightNumber, date);
  if (result.legs.length) scheduleCache.set(key, { at: Date.now(), ...result });
  return result;
}
