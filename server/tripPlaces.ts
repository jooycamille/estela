import type { FlightItem, ItineraryItem, StayItem, Trip } from "../shared/types.ts";
import { getAirport, type Airport } from "./airports.ts";
import { cityInAddress, countryName, mainCity, nearestCity } from "./places.ts";

// Where the traveller actually is during a trip, worked out from the flights.

export interface Stop {
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  from: string; // YYYY-MM-DD (arrival)
  to: string; // YYYY-MM-DD (departure, or trip end)
}
export interface Transit {
  iata: string;
  city: string;
  country: string;
  countryCode: string;
  date: string;
}

const HOUR = 3600_000;
const ms = (t: string) => new Date(`${t.slice(0, 16)}:00Z`).getTime(); // local wall times; only used for gaps

/** Great-circle distance in km (to spot long-haul flights). */
export function distanceKm(a: Pick<Airport, "lat" | "lon">, b: Pick<Airport, "lat" | "lon">) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function stopsFromStays(trip: Trip, items: ItineraryItem[]): Stop[] {
  const countries = [...new Set((trip.places ?? []).map((p) => p.countryCode))];
  if (!countries.length) return [];
  const stops: Stop[] = [];
  const stays = items.filter((i): i is StayItem => i.kind === "stay").sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  for (const s of stays) {
    const c = (s.address && cityInAddress(s.address, countries)) || (s.lat !== undefined && s.lon !== undefined ? nearestCity(s.lat, s.lon, countries) : undefined);
    if (!c) continue;
    const last = stops.at(-1);
    if (last?.city === c.city) continue;
    if (last) last.to = s.checkIn.slice(0, 10);
    stops.push({ city: c.city, country: countryName(c.countryCode), countryCode: c.countryCode, lat: c.lat, lon: c.lon, from: stops.length ? s.checkIn.slice(0, 10) : trip.startDate, to: trip.endDate });
  }
  return stops;
}

/** Only countries or regions chosen, no cities or stays: each country's largest city, for typical weather. */
export function assumedStops(trip: Trip): (Stop & { assumed: true })[] {
  const countries = [...new Set((trip.places ?? []).map((p) => p.countryCode))].slice(0, 4);
  return countries.flatMap((cc) => {
    const c = mainCity(cc);
    return c ? [{ city: c.city, country: countryName(cc), countryCode: cc, lat: c.lat, lon: c.lon, from: trip.startDate, to: trip.endDate, assumed: true as const }] : [];
  });
}

/**
 * Stops (cities you stay in) and transits (connections under 24 hours). The final flight home is not a stop: a
 * last arrival in the country the trip started from ends the trip.
 */
export function tripPlaces(trip: Trip, items: ItineraryItem[]) {
  const flights = items
    .filter((i): i is FlightItem => i.kind === "flight")
    .sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  const stops: Stop[] = [];
  const transits: Transit[] = [];
  const homeCountry = getAirport(flights[0]?.from ?? "")?.countryCode;

  flights.forEach((f, i) => {
    const airport = getAirport(f.to);
    if (!airport) return;
    const arrival = f.arrivalTime ?? f.departureTime;
    const next = flights[i + 1];
    const isLast = !next;
    if (isLast && airport.countryCode === homeCountry) return; // flying home
    const leave = next?.departureTime ?? `${trip.endDate}T23:59`;
    if (next && ms(leave) - ms(arrival) < 24 * HOUR) {
      transits.push({ iata: airport.iata, city: airport.city, country: airport.country, countryCode: airport.countryCode, date: arrival.slice(0, 10) });
      return;
    }
    const last = stops.at(-1);
    if (last && last.city === airport.city && last.to >= arrival.slice(0, 10)) last.to = leave.slice(0, 10);
    else
      stops.push({
        city: airport.city,
        country: airport.country,
        countryCode: airport.countryCode,
        lat: airport.lat,
        lon: airport.lon,
        from: arrival.slice(0, 10),
        to: leave.slice(0, 10),
      });
  });

  // No flights yet: where you're staying says where you'll be (each stay until the next, covering the whole trip).
  if (!flights.length) stops.push(...stopsFromStays(trip, items));
  // Nothing to go on but the chosen destinations: cities get weather (they have coordinates), all give countries.
  if (!stops.length && !flights.length) {
    for (const p of trip.places ?? []) {
      if (p.type === "city" && p.lat !== undefined && p.lon !== undefined) {
        stops.push({ city: p.name, country: countryName(p.countryCode), countryCode: p.countryCode, lat: p.lat, lon: p.lon, from: trip.startDate, to: trip.endDate });
      }
    }
  }
  const planned = (trip.places ?? []).map((p) => p.countryCode);
  const countries = [...new Set([...stops.map((p) => p.countryCode), ...transits.map((p) => p.countryCode), ...planned])].filter((c) => c !== homeCountry);
  const longHaul = flights.filter((f) => {
    const a = getAirport(f.from), b = getAirport(f.to);
    return a && b && distanceKm(a, b) > 5000;
  });
  return { stops, transits, countries, homeCountry, flights, longHaul };
}
