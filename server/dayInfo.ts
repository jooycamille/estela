import tzlookup from "tz-lookup";
import type { ItineraryItem, StayItem, Trip } from "../shared/types.ts";
import { getAirport } from "./airports.ts";
import { stayFor } from "../shared/stays.ts";
import { cityInAddress, nearestCity } from "./places.ts";
import { assumedStops, tripPlaces } from "./tripPlaces.ts";
import { dailyForecast, type DayWeather } from "./weather.ts";

// Where you are on each day of a trip, that place's time zone, and (within about two weeks) its forecast.
// Used by the itinerary's weather, the time differences, Today and the calendar.

export interface DayPlace {
  city?: string;
  lat: number;
  lon: number;
  tz?: string; // IANA zone, e.g. "America/Bogota"
}

export interface DayInfo extends DayPlace {
  weather?: DayWeather;
}

export const zoneAt = (lat: number, lon: number): string | undefined => {
  try {
    return tzlookup(lat, lon);
  } catch {
    return undefined;
  }
};

const tripDays = (trip: Trip) => {
  const out: string[] = [];
  for (let d = new Date(`${trip.startDate}T12:00:00Z`); d <= new Date(`${trip.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/**
 * Where you are each day: the stay you sleep in that night (its map position, or the town in its address), else the
 * city the flights put you in, else the trip's main destination. A travel day counts where you end up.
 */
export function dayPlaces(trip: Trip, items: ItineraryItem[]): Record<string, DayPlace> {
  const countries = [...new Set((trip.places ?? []).map((p) => p.countryCode))];
  const { stops } = tripPlaces(trip, items);
  const fallback = stops.length ? stops : assumedStops(trip);
  const stays = items.filter((i): i is StayItem => i.kind === "stay");
  const out: Record<string, DayPlace> = {};
  let previous: DayPlace | undefined;
  for (const day of tripDays(trip)) {
    const stay = stayFor(trip, stays, day);
    let place: DayPlace | undefined;
    if (stay && stay.lat !== undefined && stay.lon !== undefined) {
      place = { city: nearestCity(stay.lat, stay.lon, countries)?.city, lat: stay.lat, lon: stay.lon };
    } else if (stay?.address) {
      const c = cityInAddress(stay.address, countries);
      if (c) place = { city: c.city, lat: c.lat, lon: c.lon };
    }
    if (!place) {
      const stop = [...fallback].reverse().find((s) => s.from <= day && day <= s.to);
      if (stop) place = { city: stop.city, lat: stop.lat, lon: stop.lon };
    }
    place ??= previous;
    if (!place) continue;
    out[day] = { ...place, tz: zoneAt(place.lat, place.lon) };
    previous = place;
  }
  return out;
}

/** Each airport on the trip's flights and its time zone, so flight times can be shown in both places' terms. */
export function airportZones(items: ItineraryItem[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of items) {
    if (i.kind !== "flight") continue;
    for (const code of [i.from, i.to]) {
      const a = getAirport(code);
      const tz = a && zoneAt(a.lat, a.lon);
      if (tz) out[a.iata] = tz;
    }
  }
  return out;
}

/** Day by day, with the forecast for days within its reach (one request per place, shared and kept for hours). */
export async function dayInfo(trip: Trip, items: ItineraryItem[]): Promise<Record<string, DayInfo>> {
  const places = dayPlaces(trip, items);
  const out: Record<string, DayInfo> = {};
  const forecasts = new Map<string, Promise<Record<string, DayWeather> | undefined>>();
  // From yesterday (in UTC terms, it may still be today where you are) to the end of the forecast.
  const from = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const reach = new Date(Date.now() + 16 * 86400_000).toISOString().slice(0, 10);
  for (const [day, p] of Object.entries(places)) {
    out[day] = { ...p };
    if (day < from || day > reach) continue; // past, or too far ahead to forecast
    const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
    if (!forecasts.has(key)) forecasts.set(key, dailyForecast(p.lat, p.lon).catch(() => undefined));
    const weather = (await forecasts.get(key))?.[day];
    if (weather) out[day].weather = weather;
  }
  return out;
}
