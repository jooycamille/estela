import type { DayLeg, DayLegs, ItineraryItem, Trip, TripList } from "../shared/types.ts";
import { activityDays } from "../shared/days.ts";
import { stayFor } from "../shared/stays.ts";
import { itemStart } from "./db.ts";
import { dayPlans } from "./lists.ts";
import { legBetween, saveRoutes } from "./routing.ts";
import { tripMap } from "./tripMap.ts";

// For each day, how far it is between stops, as the itinerary shows them: from one booking to the next (in time order),
// and through the day's planned places (in walking order) from where you sleep and back.

const NEW_ROUTES = 16; // routes asked for the first time in one visit; the rest come next time

export async function dayLegs(trip: Trip, items: ItineraryItem[], lists: TripList[]): Promise<DayLegs> {
  const map = await tripMap(trip, items, lists);
  const pos = new Map(map.points.map((p) => [p.id, { lat: p.lat, lon: p.lon }]));
  const plans = dayPlans(trip, items);
  const budget = { left: NEW_ROUTES };
  const out: DayLegs = {};
  const add = async (day: string, from: string, to: string, a?: { lat: number; lon: number }, b?: { lat: number; lon: number }) => {
    if (!a || !b) return;
    const leg: DayLeg | undefined = await legBetween(a, b, budget, trip.getAround);
    if (leg) (out[day] ??= {})[`${from}>${to}`] = leg;
  };

  const days = new Set<string>(Object.keys(plans));
  const sorted = [...items].sort((a, b) => itemStart(a).localeCompare(itemStart(b)));
  const byDay = new Map<string, ItineraryItem[]>();
  for (const i of sorted) {
    for (const d of i.kind === "activity" ? activityDays(i) : [itemStart(i).slice(0, 10)]) byDay.set(d, [...(byDay.get(d) ?? []), i]);
  }
  for (const d of byDay.keys()) days.add(d);

  for (const day of [...days].sort()) {
    // Between bookings that follow each other (not across a flight: that's its own journey).
    const cards = byDay.get(day) ?? [];
    for (let n = 0; n + 1 < cards.length; n++) {
      const [a, b] = [cards[n], cards[n + 1]];
      if (a.kind === "flight" || b.kind === "flight") continue;
      await add(day, a.id, b.id, pos.get(a.id), pos.get(b.id));
    }
    // Through the planned places, from the night's stay and back to it.
    const places = (plans[day]?.entries ?? []).filter((e) => pos.has(e.id));
    if (!places.length) continue;
    const stay = stayFor(trip, items, day);
    const home = stay && pos.get(stay.id);
    await add(day, "stay", places[0].id, home, pos.get(places[0].id));
    for (let n = 0; n + 1 < places.length; n++) await add(day, places[n].id, places[n + 1].id, pos.get(places[n].id), pos.get(places[n + 1].id));
    await add(day, places.at(-1)!.id, "stay", pos.get(places.at(-1)!.id), home);
  }
  saveRoutes();
  return out;
}
