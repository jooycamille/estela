import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActivityItem, ItineraryItem, ListEntry, ListSuggestion, Trip, TripList } from "../shared/types.ts";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-bydate-")), "db.json");
const { db } = await import("../server/db.ts");
const { daySuggestions, planByDate } = await import("../server/lists.ts");

const trip = { id: "t", name: "Made-up trip", destination: "Mexico City", startDate: "2027-03-01", endDate: "2027-03-08", places: [{ type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }] } as unknown as Trip;
const tour = (id: string, day: string, title: string, includes: { title: string; lat?: number; lon?: number }[]) =>
  ({ id, tripId: "t", kind: "activity", title, start: `${day}T09:00`, includes }) as unknown as ActivityItem;
const pick = (id: string, lat: number, lon: number, more: Partial<ListEntry> = {}): ListEntry => ({ id, title: `Zefir ${id} gardens`, kind: "place", section: "see", lat, lon, done: false, addedAt: "2027-01-01", ...more });

function setUp(entries: ListEntry[]) {
  const list = { id: "l", tripId: "t", auto: true, name: "Mexico City", emoji: "🇲🇽", place: { type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }, entries } as unknown as TripList;
  db.lists = [list];
  return list;
}
const items: ItineraryItem[] = [
  tour("a", "2027-03-02", "Made-up old town walk", [{ title: "Madeup Square", lat: 19.43, lon: -99.13 }, { title: "Madeup Palace", lat: 19.435, lon: -99.14 }]),
  tour("b", "2027-03-05", "Made-up canal trip", [{ title: "Madeup Canal", lat: 19.26, lon: -99.1 }]),
];

test("a pick near a tour is suggested on that tour's date, one that isn't stays in its area", () => {
  const list = setUp([pick("near", 19.432, -99.132), pick("far", 19.36, -99.2), pick("alsofar", 19.361, -99.201)]);
  const { byDate, areasLeft } = planByDate(list, trip, items);
  assert.deepEqual(byDate.map((c) => [c.day, c.tour, c.nearby.map((n) => n.id)]), [
    ["2027-03-02", "Made-up old town walk", ["near"]],
    ["2027-03-05", "Made-up canal trip", []],
  ]);
  assert.equal(byDate[0].nearby[0].near, "Madeup Square");
  assert.ok(byDate[0].nearby[0].km < 1);
  assert.deepEqual(areasLeft.flatMap((g) => g.entries.map((e) => e.id)).sort(), ["alsofar", "far"]);
});

test("each pick is suggested once, on the nearest tour", () => {
  const twoTours = [...items, tour("c", "2027-03-07", "Made-up food walk", [{ title: "Madeup Market", lat: 19.433, lon: -99.133 }])];
  const list = setUp([pick("between", 19.4331, -99.1331)]);
  const { byDate } = planByDate(list, trip, twoTours);
  assert.deepEqual(byDate.filter((c) => c.nearby.length).map((c) => c.tour), ["Made-up food walk"]);
});

test("a pick that's a stop on a tour isn't suggested as an extra", () => {
  const list = setUp([pick("stop", 19.43, -99.13, { title: "Madeup Square" })]);
  const { byDate, areasLeft } = planByDate(list, trip, items);
  assert.equal(byDate.flatMap((c) => c.nearby).length, 0);
  assert.equal(areasLeft.length, 0);
});

test("a planned pick moves to its date, with a card of its own if nothing else is on", () => {
  const list = setUp([pick("withtour", 19.432, -99.132, { day: "2027-03-02" }), pick("alone", 19.36, -99.2, { day: "2027-03-04" })]);
  const { byDate } = planByDate(list, trip, items);
  assert.deepEqual(byDate.map((c) => [c.day, c.planned.map((p) => p.id), c.nearby.length]), [
    ["2027-03-02", ["withtour"], 0],
    ["2027-03-04", ["alone"], 0],
    ["2027-03-05", [], 0],
  ]);
});

test("food and places not on the map aren't suggested", () => {
  const list = setUp([pick("dish", 19.432, -99.132, { kind: "thing" }), { ...pick("unmapped", 0, 0), lat: undefined, lon: undefined }]);
  assert.equal(planByDate(list, trip, items).byDate.flatMap((c) => c.nearby).length, 0);
});

const timed = (id: string, start: string, end: string | undefined, stop = { title: "Madeup Square", lat: 19.43, lon: -99.13 }) =>
  ({ ...tour(id, start.slice(0, 10), `Made-up tour ${id}`, [stop]), start, end }) as unknown as ActivityItem;
const flight = (departureTime: string, arrivalTime: string) => ({ id: "f", tripId: "t", kind: "flight", flightNumber: "XX1", from: "AAA", to: "BBB", departureTime, arrivalTime, changes: [] }) as unknown as ItineraryItem;
const suggested = (all: ItineraryItem[]) => planByDate(setUp([pick("near", 19.432, -99.132)]), trip, all);

test("a tour that fills the day gets no suggestions, and says why", () => {
  const { byDate, areasLeft } = suggested([timed("a", "2027-03-02T05:00", "2027-03-02T19:00")]);
  assert.equal(byDate[0].nearby.length, 0);
  assert.equal(byDate[0].free?.room, 0);
  assert.deepEqual(areasLeft.flatMap((g) => g.entries.map((e) => e.id)), ["near"]);
});

test("a pick moves to the next nearest tour when the nearest one's day is full", () => {
  const { byDate } = suggested([timed("a", "2027-03-02T05:00", "2027-03-02T19:00"), timed("b", "2027-03-03T09:00", "2027-03-03T12:00", { title: "Madeup Palace", lat: 19.44, lon: -99.14 })]);
  assert.deepEqual(byDate.map((c) => c.nearby.map((n) => n.id)), [[], ["near"]]);
});

test("a morning tour leaves the rest of the day, an evening one the day before it", () => {
  const morning = suggested([timed("a", "2027-03-02T09:30", "2027-03-02T13:30")]).byDate[0];
  assert.deepEqual([morning.free?.from, morning.free?.to, morning.nearby.length], ["13:30", "21:00", 1]);
  const evening = suggested([timed("a", "2027-03-02T17:00", "2027-03-02T21:30")]).byDate[0];
  assert.deepEqual([evening.free?.from, evening.free?.to, evening.nearby.length], ["09:00", "17:00", 1]);
});

test("other bookings that day count too, not only the tour", () => {
  const ride = { ...timed("r", "2027-03-02T15:00", "2027-03-02T16:00"), includes: [] } as ActivityItem;
  assert.equal(suggested([timed("a", "2027-03-02T09:00", "2027-03-02T13:00"), ride]).byDate[0].nearby.length, 1); // 16:00-21:00 is left
  const late = { ...timed("d", "2027-03-02T14:30", "2027-03-02T21:00"), includes: [] } as ActivityItem;
  assert.equal(suggested([timed("a", "2027-03-02T09:00", "2027-03-02T13:00"), late]).byDate[0].nearby.length, 0);
});

test("a flight that day takes up the airport time as well", () => {
  const { byDate } = suggested([timed("a", "2027-03-02T09:00", "2027-03-02T12:00"), flight("2027-03-02T17:00", "2027-03-02T21:00")]);
  assert.equal(byDate[0].nearby.length, 0); // 12:00 to the airport at 14:00 is only two hours
  const landed = suggested([timed("a", "2027-03-02T18:00", "2027-03-02T20:00"), flight("2027-03-01T22:00", "2027-03-02T15:00")]);
  assert.equal(landed.byDate[0].nearby.length, 0); // landing at 15:00, out of the airport at 16:30
});

test("a tour with no end time still leaves the rest of the day", () => {
  const card = suggested([timed("a", "2027-03-02T10:00", undefined)]).byDate[0];
  assert.deepEqual([card.free?.from, card.nearby.length], ["13:00", 1]);
});

test("places you've put on a day use up its free time", () => {
  const list = setUp([pick("near", 19.432, -99.132), pick("one", 19.45, -99.15, { day: "2027-03-02" }), pick("two", 19.45, -99.15, { day: "2027-03-02" })]);
  const { byDate } = planByDate(list, trip, [timed("a", "2027-03-02T09:00", "2027-03-02T18:00")]); // only 18:00-21:00 free
  assert.equal(byDate[0].free?.room, 0);
  assert.equal(byDate[0].nearby.length, 0);
});

test("a full day isn't offered for a group of places either", () => {
  const short = { ...trip, startDate: "2027-03-02", endDate: "2027-03-04" } as Trip;
  const { areasLeft } = planByDate(setUp([pick("far", 19.36, -99.2)]), short, [timed("a", "2027-03-03T05:00", "2027-03-03T19:00")]);
  assert.ok(areasLeft[0].suggestedDays.length > 0);
  assert.ok(!areasLeft[0].suggestedDays.includes("2027-03-03"));
});

const thing = (id: string, more: Partial<ListEntry> = {}): ListEntry => ({ id, title: `Zefir ${id} class`, kind: "activity", done: false, addedAt: "2027-01-01", ...more });
const idea = (title: string, tag?: string): ListSuggestion => ({ title, kind: "activity", tag, source: "rules" });
const onDays = (cards: { day: string; things: { id: string }[]; ideas: { title: string }[] }[]) =>
  Object.fromEntries(cards.filter((c) => c.things.length || c.ideas.length).map((c) => [c.day, [...c.things.map((t) => t.id), ...c.ideas.map((i) => i.title)]]));

test("saved things to do go on the free days, not on full ones, and a free day gets a card of its own", () => {
  const short = { ...trip, startDate: "2027-03-02", endDate: "2027-03-03" } as Trip;
  const { byDate } = planByDate(setUp([thing("a"), thing("b")]), short, [timed("t", "2027-03-02T05:00", "2027-03-02T19:00")]);
  assert.deepEqual(onDays(byDate), { "2027-03-03": ["a", "b"] });
  assert.equal(byDate.find((c) => c.day === "2027-03-03")?.tour, undefined);
});

test("your own things to do come before Joy's ideas, up to two on a date", () => {
  const short = { ...trip, startDate: "2027-03-03", endDate: "2027-03-03" } as Trip;
  const { byDate } = planByDate(setUp([thing("mine")]), short, [], [idea("Idea one"), idea("Idea two")]);
  assert.deepEqual(onDays(byDate), { "2027-03-03": ["mine", "Idea one"] });
});

test("places close by leave less room for things to do", () => {
  const short = { ...trip, startDate: "2027-03-02", endDate: "2027-03-02" } as Trip;
  const list = setUp([...[1, 2, 3, 4].map((n) => pick(`near${n}`, 19.432, -99.132)), thing("a")]);
  const { byDate } = planByDate(list, short, [timed("t", "2027-03-02T14:00", "2027-03-02T21:00")]); // 09:00-14:00 fits 3
  assert.deepEqual(onDays(byDate), {});
});

test("things already planned, done or booked aren't suggested again", () => {
  const short = { ...trip, startDate: "2027-03-03", endDate: "2027-03-03" } as Trip;
  const { byDate } = planByDate(setUp([thing("planned", { day: "2027-03-03" }), thing("done", { done: true })]), short, []);
  assert.deepEqual(onDays(byDate), {});
  assert.deepEqual(byDate[0].planned.map((p) => p.id), ["planned"]);
});

test("an idea only goes on a date it suits", () => {
  // 7 March 2027 is a Sunday, 8 March a Monday.
  const days = { ...trip, startDate: "2027-03-07", endDate: "2027-03-08" } as Trip;
  assert.deepEqual(onDays(planByDate(setUp([]), days, [], [idea("Market", "Sunday mornings")]).byDate), { "2027-03-07": ["Market"] });
  assert.deepEqual(onDays(planByDate(setUp([]), { ...days, startDate: "2027-03-08" } as Trip, [], [idea("Market", "Sunday mornings")]).byDate), {});
  const busy = [timed("t", "2027-03-08T14:00", "2027-03-08T21:00")];
  assert.deepEqual(onDays(planByDate(setUp([]), { ...days, startDate: "2027-03-08" } as Trip, busy, [idea("Long outing", "Day trip")]).byDate), {});
});

test("taking one suggestion doesn't send the others to other dates", () => {
  const days = { ...trip, startDate: "2027-03-01", endDate: "2027-03-08" } as Trip;
  const all = Array.from({ length: 12 }, (_, n) => idea(`Idea ${n}`));
  const dayOf = (cards: Record<string, string[]>, title: string) => Object.entries(cards).find(([, titles]) => titles.includes(title))?.[0];
  const before = onDays(planByDate(setUp([]), days, [], all).byDate);
  for (const taken of all) {
    const after = onDays(planByDate(setUp([]), days, [], all.filter((i) => i !== taken)).byDate);
    const moved = all.filter((i) => i !== taken && dayOf(before, i.title) && dayOf(after, i.title) && dayOf(before, i.title) !== dayOf(after, i.title));
    assert.ok(moved.length <= 1, `${taken.title} moved ${moved.map((i) => i.title)}`);
  }
});

test("something saved with a day in its name waits for that day", () => {
  const days = { ...trip, startDate: "2027-03-05", endDate: "2027-03-07" } as Trip; // Friday to Sunday
  assert.deepEqual(onDays(planByDate(setUp([thing("ride", { title: "Zefir Sunday ride" })]), days, []).byDate), { "2027-03-07": ["ride"] });
});

test("the itinerary gets each day's suggestions, and nothing for a full day", () => {
  const short = { ...trip, styles: [], startDate: "2027-03-02", endDate: "2027-03-03" } as unknown as Trip;
  setUp([pick("near", 19.432, -99.132), thing("mine")]);
  const days = daySuggestions(short, [timed("full", "2027-03-02T05:00", "2027-03-02T19:00"), timed("short", "2027-03-03T09:00", "2027-03-03T12:00", { title: "Madeup Palace", lat: 19.434, lon: -99.134 })]);
  assert.deepEqual(days.map((d) => [d.day, d.place, d.nearby.map((n) => n.id), d.things.map((n) => n.id)]), [["2027-03-03", "Mexico City", ["near"], ["mine"]]]);
});

test("a tour stop named by its street address reads as just the street", () => {
  const list = setUp([pick("near", 19.432, -99.132)]);
  const { byDate } = planByDate(list, trip, [tour("a", "2027-03-02", "Made-up class", [{ title: "Calle Inventada 12, Colonia Falsa, Mexico", lat: 19.43, lon: -99.13 }])]);
  assert.equal(byDate[0].nearby[0].near, "Calle Inventada 12");
});
