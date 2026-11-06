import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-booked-")), "db.json");
const { guideSuggestions, sameOuting, samePlaceName } = await import("../server/lists.ts");
const { db } = await import("../server/db.ts");

const places = ["Mexico City", "Mexico", "Panama City", "Panama"];

test("an idea matches a booking worded differently", () => {
  assert.ok(sameOuting("Hot-air balloon over Teotihuacan", "Sunrise Hot Air Balloon Ride with Guided Visits to Teotihuacan", places));
  assert.ok(sameOuting("Teotihuacan pyramids", "Balloon Ride with Guided Visits to Teotihuacan", places));
  assert.ok(sameOuting("Mexican cooking class with a market visit", "Mexico City Home Cooking Class", places));
  assert.ok(sameOuting("Visit an Emberá community on the Chagres River", "Embera Village Day Trip", places));
  assert.ok(sameOuting("Lucha libre at Arena México", "Lucha Libre Night Out", places));
});

test("sharing a city or ordinary words isn't a match", () => {
  assert.ok(!sameOuting("Casco Viejo", "Panamá Viejo ruins", places)); // "viejo" only means "old"
  assert.ok(!samePlaceName("Casco Viejo", "Panamá Viejo", places));
  assert.ok(!sameOuting("Mexico City Metropolitan Cathedral", "Mexico City E-Bike Tour with Snacks", places));
  assert.ok(!sameOuting("Mexican market walking tour", "Lucha Libre Night Out", places));
  assert.ok(!sameOuting("Sunday bike ride on Paseo de la Reforma", "Mexico City E-Bike Tour with Snacks", places));
  assert.ok(!sameOuting("Sunset boat ride on the canal", "Hot Air Balloon Ride", places));
});

test("the guide leaves out what you've booked in that city, and keeps food and other cities' ideas", () => {
  const tripId = "booked-trip";
  const trip = {
    id: tripId, name: "Test", destination: "Mexico City", startDate: "2028-03-01", endDate: "2028-03-10", purpose: "leisure", party: "solo", styles: ["food", "culture", "adventure"],
    places: [{ type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }], ownerId: "x", members: [], createdAt: "2028-01-01T00:00:00Z",
  } as never;
  const list = { id: "l1", tripId, name: "Mexico City", emoji: "🇲🇽", auto: true, place: { type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }, entries: [], createdAt: "2028-01-01T00:00:00Z" } as never;
  const before = guideSuggestions(list, trip, []);
  const all = (g: typeof before) => [...g.guide.activities, ...g.guide.sights].map((s) => s.title);
  const idea = all(before).find((t) => /balloon/i.test(t));
  assert.ok(idea, "the Mexico guide suggests a balloon ride");
  const foodBefore = before.guide.food.map((s) => s.title);

  const activity = (title: string, start: string) => ({ kind: "activity", id: title, tripId, source: "email", title, start, createdAt: "2028-01-01T00:00:00Z" }) as never;
  const after = guideSuggestions(list, trip, [activity("Sunrise Hot Air Balloon Ride", "2028-03-04T05:00")]);
  assert.ok(!all(after).includes(idea));
  assert.ok(after.bookedIdeas?.includes(idea));
  assert.deepEqual(after.guide.food.map((s) => s.title), foodBefore);

  const savedPick = { ...(list as object), entries: [{ id: "e1", title: idea, kind: "activity", done: false, addedAt: "2028-01-01T00:00:00Z" }, { id: "e2", title: "Tacos al pastor", kind: "thing", done: false, addedAt: "2028-01-01T00:00:00Z" }] } as never;
  const picks = guideSuggestions(savedPick, trip, [activity("Balloon flight and tacos", "2028-03-04T05:00")]);
  assert.deepEqual(picks.bookedPicks?.map((p) => p.id), ["e1"]);
  assert.equal(db.items.length, 0); // only read
});

test("a place listed in a tour matches its own name, not its neighbours", () => {
  assert.ok(samePlaceName("Frida Kahlo Museum", "Museo Frida Kahlo", places));
  assert.ok(samePlaceName("Zócalo & Metropolitan Cathedral", "Zocalo", places));
  assert.ok(!samePlaceName("Bosque de Chapultepec", "Chapultepec Castle", places));
  assert.ok(!samePlaceName("Mexico City Metropolitan Cathedral", "Mexico City", places));
});

test("places in a tour are covered, in guides and on your own lists, only for that city's dates", async () => {
  const { listSuggestions } = await import("../server/lists.ts");
  const tripId = "tour-trip";
  const trip = {
    id: tripId, name: "Test", destination: "Mexico City", startDate: "2028-03-01", endDate: "2028-03-10", purpose: "leisure", party: "solo", styles: ["culture"],
    places: [{ type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }], ownerId: "x", members: [], createdAt: "2028-01-01T00:00:00Z",
  } as never;
  const place = { type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 };
  const guide = { id: "g", tripId, name: "Mexico City", emoji: "🇲🇽", auto: true, place, entries: [], createdAt: "2028-01-01T00:00:00Z" } as never;
  const tour = { kind: "activity", id: "t1", tripId, source: "manual", title: "Sample Day Out", start: "2028-03-04T08:00", createdAt: "2028-01-01T00:00:00Z", includes: [{ title: "Palacio de Bellas Artes" }] } as never;
  const sights = (g: { guide: { sights: { title: string }[] } }) => g.guide.sights.map((s) => s.title);
  assert.ok(sights(guideSuggestions(guide, trip, []) as never).includes("Palacio de Bellas Artes"));
  const after = guideSuggestions(guide, trip, [tour]);
  assert.ok(!sights(after as never).includes("Palacio de Bellas Artes"));
  assert.ok(!after.bookedIdeas?.includes("Palacio de Bellas Artes")); // listed in its own section instead
  assert.deepEqual(after.inItinerary?.map((p) => [p.title, p.tour, p.day]), [["Palacio de Bellas Artes", "Sample Day Out", "2028-03-04"]]);

  const mine = { id: "m", tripId, name: "My places", emoji: "📍", entries: [
    { id: "e1", title: "Bellas Artes Palacio", kind: "place", done: false, addedAt: "2028-01-01T00:00:00Z" },
    { id: "e2", title: "Quiet Garden", kind: "place", done: false, addedAt: "2028-01-01T00:00:00Z" },
  ], createdAt: "2028-01-01T00:00:00Z" } as never;
  const own = await listSuggestions(mine, trip, [tour]);
  assert.deepEqual(own.bookedPicks?.map((p) => [p.id, p.bookedAs, p.inTour]), [["e1", "Sample Day Out", true]]);
});

test("places in a tour show in the guide for where they are: nearest city on the map, else the tour's dates", () => {
  const tripId = "two-cities";
  const trip = {
    id: tripId, name: "Test", destination: "Mexico and Panama", startDate: "2028-03-01", endDate: "2028-03-20", purpose: "leisure", party: "solo", styles: [],
    ownerId: "x", members: [], createdAt: "2028-01-01T00:00:00Z",
  } as never;
  const flight = (id: string, from: string, to: string, day: string) => ({ kind: "flight", id, tripId, source: "manual", createdAt: "2028-01-01T00:00:00Z", changes: [], flightNumber: id, from, to, departureTime: `${day}T10:00`, arrivalTime: `${day}T16:00` });
  const items = [
    flight("XX1", "SYD", "MEX", "2028-03-01"), flight("XX2", "MEX", "PTY", "2028-03-10"), flight("XX3", "PTY", "SYD", "2028-03-20"),
    { kind: "activity", id: "t1", tripId, source: "manual", createdAt: "2028-01-01T00:00:00Z", title: "Mexico Day Out", start: "2028-03-05T08:00", includes: [
      { title: "Typed Ruins" },
      { title: "Mapped Museum", lat: 19.35, lon: -99.16 },
      { title: "Odd One Near Panama", lat: 8.98, lon: -79.52 },
    ] },
  ] as never[];
  const guide = (name: string, cc: string, lat: number, lon: number) => ({ id: name, tripId, name, emoji: "📍", auto: true, place: { type: "city", name, countryCode: cc, lat, lon }, entries: [], createdAt: "2028-01-01T00:00:00Z" }) as never;
  const mexico = guideSuggestions(guide("Mexico City", "MX", 19.43, -99.13), trip, items);
  const panama = guideSuggestions(guide("Panama City", "PA", 8.98, -79.52), trip, items);
  assert.deepEqual(mexico.inItinerary?.map((p) => p.title), ["Typed Ruins", "Mapped Museum"]);
  assert.deepEqual(panama.inItinerary?.map((p) => [p.title, p.tour, p.day]), [["Odd One Near Panama", "Mexico Day Out", "2028-03-05"]]);
});

test("each guide knows its dates, for filing a new place by day", async () => {
  const { guideDays } = await import("../server/lists.ts");
  const tripId = "guide-days";
  const trip = { id: tripId, name: "Test", destination: "x", startDate: "2028-03-01", endDate: "2028-03-20", purpose: "leisure", party: "solo", styles: [], ownerId: "x", members: [], createdAt: "2028-01-01T00:00:00Z" } as never;
  const flight = (id: string, from: string, to: string, day: string) => ({ kind: "flight", id, tripId, source: "manual", createdAt: "2028-01-01T00:00:00Z", changes: [], flightNumber: id, from, to, departureTime: `${day}T10:00`, arrivalTime: `${day}T16:00` });
  const items = [flight("XX1", "SYD", "MEX", "2028-03-01"), flight("XX2", "MEX", "PTY", "2028-03-10"), flight("XX3", "PTY", "SYD", "2028-03-20")] as never[];
  const guide = (id: string, name: string, countryCode: string) => ({ id, tripId, name, emoji: "📍", auto: true, place: { type: "city", name, countryCode }, entries: [], createdAt: "2028-01-01T00:00:00Z" });
  db.lists.push(guide("mx", "Mexico City", "MX") as never, guide("pa", "Panama City", "PA") as never, { ...guide("own", "Mine", "MX"), auto: false, place: undefined } as never);
  const days = guideDays(trip, items);
  db.lists = db.lists.filter((l) => l.tripId !== tripId);
  assert.deepEqual(days.map((d) => d.listId), ["mx", "pa"]);
  assert.ok(days[0].from! <= "2028-03-05" && "2028-03-05" <= days[0].to!);
  assert.ok(days[1].from! <= "2028-03-15" && "2028-03-15" <= days[1].to!);
});
