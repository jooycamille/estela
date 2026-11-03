import tzlookup from "tz-lookup";
import { getAirport } from "./airports.ts";

// Flight times are the airport's own wall-clock times ("2026-12-21T13:23" in Panama). Reminders need real moments,
// so this finds each airport's time zone from its coordinates and converts.

export function airportTimeZone(iata: string): string | undefined {
  const a = getAirport(iata);
  if (!a) return undefined;
  try {
    return tzlookup(a.lat, a.lon);
  } catch {
    return undefined;
  }
}

/** Minutes the zone is ahead of UTC at a given moment (e.g. -300 for Bogotá). */
function offsetMinutes(utcMs: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

/** "2026-12-21T13:23" in "America/Panama" → the UTC moment, as an ISO string. */
export function wallTimeToUtc(wall: string, timeZone: string): string {
  const [d, t = "00:00"] = wall.slice(0, 16).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  // Twice, so daylight-saving changes between the guess and the answer are accounted for.
  let utc = guess - offsetMinutes(guess, timeZone) * 60_000;
  utc = guess - offsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc).toISOString();
}
