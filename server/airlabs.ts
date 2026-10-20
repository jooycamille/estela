import type { FlightLive, FlightScheduleLeg, FlightStatusCode } from "../shared/types.ts";
import { now } from "./db.ts";
import { recordUsage } from "./settings.ts";

// AirLabs (airlabs.co, API v9).
//  - /routes?flight_iata=…  regular weekly schedule for a flight number (airports, local times, days, duration):
//    one request answers "CM764 on 21 Dec" for any future date, as long as the flight runs that weekday.
//  - /flight?flight_iata=…  the nearest actual flight: estimated times, delays, gates, status (for the day of travel).

export class AirLabsError extends Error {}

interface Route {
  flight_iata?: string;
  airline_iata?: string;
  dep_iata?: string;
  arr_iata?: string;
  dep_time?: string; // "13:23", airport-local
  arr_time?: string;
  dep_time_utc?: string;
  arr_time_utc?: string;
  duration?: number; // minutes
  days?: string[]; // ["mon", "tue", …]
  dep_terminals?: string[] | null;
  arr_terminals?: string[] | null;
  aircraft_icao?: string;
}
interface Flight {
  flight_iata?: string;
  dep_iata?: string;
  arr_iata?: string;
  dep_time?: string; // "2026-12-21 13:23", local
  arr_time?: string;
  dep_estimated?: string;
  arr_estimated?: string;
  dep_terminal?: string | null;
  dep_gate?: string | null;
  arr_terminal?: string | null;
  arr_gate?: string | null;
  status?: string;
  dep_delayed?: number;
  aircraft_icao?: string;
  airline_name?: string;
  dep_name?: string;
  dep_city?: string;
  arr_name?: string;
  arr_city?: string;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const local = (s?: string | null) => (s ? s.slice(0, 16).replace(" ", "T") : undefined);
const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Local arrival date: via the UTC offsets when given (handles long-haul and date-line flights), else "earlier clock = next day". */
function arrivalDate(date: string, r: Route) {
  if (!r.arr_time || !r.dep_time) return date;
  if (r.duration && r.dep_time_utc && r.arr_time_utc) {
    const norm = (m: number) => ((m + 720 + 1440 * 2) % 1440) - 720; // offset in [-12h, +12h)
    const depOffset = norm(minutes(r.dep_time) - minutes(r.dep_time_utc));
    const arrOffset = norm(minutes(r.arr_time) - minutes(r.arr_time_utc));
    const arrLocalMinutes = minutes(r.dep_time) - depOffset + r.duration + arrOffset;
    return addDays(date, Math.floor(arrLocalMinutes / 1440));
  }
  return r.arr_time < r.dep_time ? addDays(date, 1) : date;
}

const STATUS: Record<string, FlightStatusCode> = { scheduled: "scheduled", "en-route": "departed", landed: "landed", cancelled: "cancelled", diverted: "diverted" };

export function airlabs(apiKey: string) {
  async function call<T>(endpoint: string, params: Record<string, string>): Promise<T | undefined> {
    const base = process.env.AIRLABS_TEST_BASE ?? "https://airlabs.co"; // override for tests
    const res = await fetch(`${base}/api/v9/${endpoint}?${new URLSearchParams({ api_key: apiKey, ...params })}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { response?: T; error?: { message?: string; code?: string } };
    const err = body.error;
    if (!err) {
      recordUsage("airlabs", 1);
      return body.response;
    }
    const text = `${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
    if (/not.?found|no data/.test(text)) {
      recordUsage("airlabs", 1);
      return undefined;
    }
    if (/api.?key|unauthori[sz]ed|forbidden|expired|unknown_api/.test(text)) throw new AirLabsError("The AirLabs API key was rejected — check it in Flight data settings.");
    if (/limit|exceed|too many/.test(text)) throw new AirLabsError("AirLabs limit reached (monthly allowance or rate limit). Try again later.");
    if (/plan|upgrade|not available|subscription/.test(text)) throw new AirLabsError("Your AirLabs plan doesn't include this data.");
    throw new AirLabsError(`AirLabs: ${err.message ?? err.code}`);
  }

  return {
    name: "airlabs",

    async schedule(flightNumber: string, date: string): Promise<FlightScheduleLeg[]> {
      const routes = (await call<Route[]>("routes", { flight_iata: flightNumber })) ?? [];
      const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
      const matching = routes.filter((r) => (r.flight_iata ?? flightNumber).toUpperCase() === flightNumber && (!r.days?.length || r.days.includes(weekday)));
      if (routes.length && !routes.some((r) => r.dep_time)) {
        throw new AirLabsError("Your AirLabs plan doesn't include schedule times for routes (AeroDataBox's free plan does).");
      }
      return matching.flatMap((r): FlightScheduleLeg[] => {
        if (!r.dep_iata || !r.arr_iata || !r.dep_time) return [];
        return [{
          flightNumber,
          from: r.dep_iata,
          to: r.arr_iata,
          departureTime: `${date}T${r.dep_time.slice(0, 5)}`,
          arrivalTime: r.arr_time ? `${arrivalDate(date, r)}T${r.arr_time.slice(0, 5)}` : undefined,
          departureTerminal: r.dep_terminals?.length === 1 ? r.dep_terminals[0] : undefined,
          arrivalTerminal: r.arr_terminals?.length === 1 ? r.arr_terminals[0] : undefined,
          aircraft: r.aircraft_icao,
          basis: "weekly",
        }];
      });
    },

    /** Live status for the nearest flight with this number (only spends a request around the travel date). */
    async lookup(flight: { flightNumber: string; departureTime: string; from: string }): Promise<FlightLive | null> {
      const date = flight.departureTime.slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (date > addDays(today, 1) || date < addDays(today, -1)) return null;
      const f = await call<Flight>("flight", { flight_iata: flight.flightNumber });
      if (!f || local(f.dep_time)?.slice(0, 10) !== date || (flight.from && f.dep_iata && f.dep_iata !== flight.from)) return null;
      const dep = local(f.dep_estimated ?? f.dep_time);
      let status = STATUS[f.status ?? ""] ?? "unknown";
      if (status === "scheduled" && (f.dep_delayed ?? 0) > 0) status = "delayed";
      return {
        status,
        departureTime: dep,
        arrivalTime: local(f.arr_estimated ?? f.arr_time),
        departureTerminal: f.dep_terminal ?? undefined,
        departureGate: f.dep_gate ?? undefined,
        arrivalTerminal: f.arr_terminal ?? undefined,
        arrivalGate: f.arr_gate ?? undefined,
        checkedAt: now(),
        provider: "airlabs",
      };
    },
  };
}
