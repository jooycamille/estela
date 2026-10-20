import type { FlightItem, ItineraryItem, Trip } from "../shared/types.ts";
import { getAirport, type Airport } from "./airports.ts";
import { countryName } from "./places.ts";

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

  // No flights yet: use the chosen destinations — cities get weather (they have coordinates), all give countries.
  if (!flights.length) {
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
