import type { ItineraryItem, StayItem, Trip } from "./types.ts";

// Where you sleep each night. Two bookings can cover the same night (a change of plan, a night kept as a backup, a
// stay split between two places); then you choose which is your base, and everything that starts or ends the day at
// "your stay" (the day's route, weather, Today) uses that one.

/** The stays covering a night (checked in that day or before, checking out after it), earliest check-in first. */
export const staysOn = (items: ItineraryItem[], day: string): StayItem[] =>
  items
    .filter((i): i is StayItem => i.kind === "stay" && i.checkIn.slice(0, 10) <= day && i.checkOut.slice(0, 10) > day)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

/** The stay for a night: the one you chose when several overlap, else the only (or first) one. */
export function stayFor(trip: Pick<Trip, "nightStay">, items: ItineraryItem[], day: string): StayItem | undefined {
  const all = staysOn(items, day);
  return all.find((s) => s.id === trip.nightStay?.[day]) ?? all[0];
}

/** The nights in a row where the same stays overlap (from `day`), so one choice covers all of them. */
export function overlapNights(items: ItineraryItem[], day: string): string[] {
  const key = (d: string) => staysOn(items, d).map((s) => s.id).join("|");
  const same = key(day);
  const out: string[] = [];
  const step = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  let d = day;
  while (key(step(d, -1)) === same) d = step(d, -1);
  for (; key(d) === same && out.length < 60; d = step(d, 1)) out.push(d);
  return out;
}
