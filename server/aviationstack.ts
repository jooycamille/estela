import type { FlightLive, FlightScheduleLeg, FlightStatusCode } from "../shared/types.ts";
import { now } from "./db.ts";
import { recordUsage } from "./settings.ts";

// Aviationstack (apilayer). Free plan: ~100 requests/month, may require plain HTTP, 1 request/minute on /flightsFuture.
// Future schedules are searched by departure airport (not flight number), so a lookup is:
//   1. /flights?flight_iata=…   → which airport the flight number departs from (and today's live status)
//   2. /flightsFuture?iataCode=…&type=departure&date=…&airline_iata=… → that day's schedule, filtered to the flight

export class AviationstackError extends Error {}

interface AvsMovement {
  airport?: string;
  iata?: string;
  iataCode?: string;
  terminal?: string | null;
  gate?: string | null;
  scheduled?: string | null; // /flights: "2026-12-21T13:23:00+00:00" (local wall time, despite the offset)
  estimated?: string | null;
  actual?: string | null;
  scheduledTime?: string | null; // /flightsFuture: "13:23"
}
interface AvsFlight {
  flight_date?: string;
  flight_status?: string;
  departure?: AvsMovement;
  arrival?: AvsMovement;
  airline?: { name?: string; iata?: string; iataCode?: string };
  flight?: { iata?: string; number?: string; iataNumber?: string };
  aircraft?: { modelText?: string; iata?: string } | null;
}

const STATUS: Record<string, FlightStatusCode> = {
  scheduled: "scheduled", active: "departed", landed: "landed", cancelled: "cancelled", incident: "unknown", diverted: "diverted",
};

const local = (s?: string | null) => (s ? s.slice(0, 16) : undefined);
const fnOf = (f: AvsFlight) => (f.flight?.iata ?? f.flight?.iataNumber ?? "").replace(/\s/g, "").toUpperCase();

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function aviationstack(apiKey: string, allowHttp: boolean) {
  let lastFutureCall = 0;
  let httpsRefused = false; // once the plan refuses HTTPS, go straight to HTTP (each attempt costs a request)
  const recentCache = new Map<string, { at: number; data: AvsFlight[] }>();

  async function call(endpoint: string, params: Record<string, string>): Promise<AvsFlight[]> {
    const query = new URLSearchParams({ access_key: apiKey, ...params });
    const testBase = process.env.AVIATIONSTACK_TEST_BASE; // tests: a local stand-in, told which scheme was attempted
    const get = (scheme: string) =>
      testBase
        ? fetch(`${testBase}/v1/${endpoint}?${query}`, { headers: { "x-test-scheme": scheme } })
        : fetch(`${scheme}://api.aviationstack.com/v1/${endpoint}?${query}`, { signal: AbortSignal.timeout(15_000) });
    // Errors come as { code: 105, type: "https_access_restricted", info: "…" } (older docs: { code: "…", message: "…" }).
    type Body = { data?: AvsFlight[]; error?: { code?: string | number; type?: string; info?: string; message?: string } };
    const errType = (b: Body) => (b.error ? String(b.error.type ?? b.error.code ?? "") : "");
    let body: Body;
    if (httpsRefused && allowHttp) {
      body = (await (await get("http")).json()) as Body;
    } else {
      body = (await (await get("https")).json()) as Body;
      if (errType(body) === "https_access_restricted" || body.error?.code === 105) {
        httpsRefused = true;
        if (!allowHttp) {
          throw new AviationstackError(
            "Your Aviationstack plan only allows unencrypted HTTP. Allow HTTP in Flight data settings (your key is then sent unencrypted), or use AeroDataBox.",
          );
        }
        recordUsage("aviationstack", 1);
        body = (await (await get("http")).json()) as Body;
      }
    }
    const code = errType(body);
    if (!body.error || /limit|too_many/.test(code)) recordUsage("aviationstack", 1);
    if (code === "invalid_access_key" || code === "missing_access_key" || code === "inactive_user") {
      throw new AviationstackError("The Aviationstack API key was rejected — check it in Flight data settings.");
    }
    if (code === "usage_limit_reached" || code === "rate_limit_reached" || code === "too_many_requests") {
      throw new AviationstackError("Aviationstack limit reached (monthly allowance or 1 request/minute for schedules). Try again later.");
    }
    if (code === "function_access_restricted") {
      throw new AviationstackError("Your Aviationstack plan doesn't include this (future schedules may need a paid plan).");
    }
    if (body.error) throw new AviationstackError(`Aviationstack: ${body.error.info ?? body.error.message ?? code ?? "unknown error"}`);
    return body.data ?? [];
  }

  /** Recent/today's flights for this number: gives the route, and live status for today's flight (cached 10 min). */
  async function recent(flightNumber: string) {
    const hit = recentCache.get(flightNumber);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
    const data = await call("flights", { flight_iata: flightNumber, limit: "10" });
    recentCache.set(flightNumber, { at: Date.now(), data });
    return data;
  }
  const rateLimitWait = () => 61_000 - (Date.now() - lastFutureCall); // free plan: 1 request/minute on /flightsFuture

  return {
    name: "aviationstack",

    async schedule(flightNumber: string, date: string): Promise<FlightScheduleLeg[]> {
      const today = new Date().toISOString().slice(0, 10);
      // Check the schedule rate limit before spending a request on the route lookup.
      if (date > today && !recentCache.has(flightNumber) && rateLimitWait() > 0) {
        throw new AviationstackError(`Aviationstack allows one schedule lookup a minute — try again in ${Math.ceil(rateLimitWait() / 1000)} seconds.`);
      }
      const flights = await recent(flightNumber);
      const sameDay = flights.filter((f) => f.flight_date === date && fnOf(f) === flightNumber);
      const toLeg = (f: AvsFlight): FlightScheduleLeg | undefined => {
        const dep = local(f.departure?.scheduled);
        if (!dep || !f.departure?.iata || !f.arrival?.iata) return;
        return {
          flightNumber,
          airline: f.airline?.name,
          from: f.departure.iata,
          fromName: f.departure.airport,
          to: f.arrival.iata,
          toName: f.arrival.airport,
          departureTime: dep,
          arrivalTime: local(f.arrival.scheduled),
          departureTerminal: f.departure.terminal ?? undefined,
          arrivalTerminal: f.arrival.terminal ?? undefined,
        };
      };
      if (sameDay.length) return sameDay.map(toLeg).filter((l) => l !== undefined);
      if (date <= today) return [];

      // Future date: look up the departure airport's schedule for that day.
      const known = flights.find((f) => fnOf(f) === flightNumber && f.departure?.iata);
      if (!known?.departure?.iata) return []; // flight number not seen recently; can't tell which airport to search
      const wait = rateLimitWait();
      if (wait > 0) throw new AviationstackError(`Aviationstack allows one schedule lookup a minute — try again in ${Math.ceil(wait / 1000)} seconds.`);
      lastFutureCall = Date.now();
      const airline = known.airline?.iata ?? flightNumber.slice(0, 2);
      const schedule = await call("flightsFuture", { iataCode: known.departure.iata, type: "departure", date, airline_iata: airline });
      return schedule
        .filter((f) => fnOf(f) === flightNumber)
        .flatMap((f): FlightScheduleLeg[] => {
          const depTime = f.departure?.scheduledTime?.slice(0, 5);
          const arrTime = f.arrival?.scheduledTime?.slice(0, 5);
          const to = (f.arrival?.iataCode ?? known.arrival?.iata ?? "").toUpperCase();
          if (!depTime || !to) return [];
          return [{
            flightNumber,
            airline: f.airline?.name ?? known.airline?.name,
            from: known.departure!.iata!,
            fromName: known.departure!.airport,
            to,
            toName: to === known.arrival?.iata ? known.arrival?.airport : undefined,
            departureTime: `${date}T${depTime}`,
            arrivalTime: arrTime ? `${arrTime < depTime ? addDays(date, 1) : date}T${arrTime}` : undefined,
            departureTerminal: f.departure?.terminal ?? undefined,
            arrivalTerminal: f.arrival?.terminal ?? undefined,
            aircraft: f.aircraft?.modelText,
          }];
        });
    },

    /** Live status is only available for today's (and recent) flights on Aviationstack. */
    async lookup(flight: { flightNumber: string; departureTime: string; from: string }): Promise<FlightLive | null> {
      const date = flight.departureTime.slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      if (date > addDays(today, 1) || date < addDays(today, -1)) return null; // no live data yet: don't spend a request
      const f = (await recent(flight.flightNumber)).find(
        (x) => x.flight_date === date && fnOf(x) === flight.flightNumber && (!flight.from || x.departure?.iata === flight.from),
      );
      if (!f) return null;
      const scheduled = local(f.departure?.scheduled);
      const dep = local(f.departure?.actual ?? f.departure?.estimated ?? f.departure?.scheduled);
      let status = STATUS[f.flight_status ?? ""] ?? "unknown";
      if (status === "scheduled" && dep && scheduled && dep > scheduled) status = "delayed";
      return {
        status,
        departureTime: dep,
        arrivalTime: local(f.arrival?.actual ?? f.arrival?.estimated ?? f.arrival?.scheduled),
        departureTerminal: f.departure?.terminal ?? undefined,
        departureGate: f.departure?.gate ?? undefined,
        arrivalTerminal: f.arrival?.terminal ?? undefined,
        arrivalGate: f.arrival?.gate ?? undefined,
        checkedAt: now(),
        provider: "aviationstack",
      };
    },
  };
}
