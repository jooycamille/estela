import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-booked-")), "db.json");
const { guideSuggestions, sameOuting } = await import("../server/lists.ts");
const { db } = await import("../server/db.ts");

const places = ["Mexico City", "Mexico", "Panama City", "Panama"];

test("an idea matches a booking worded differently", () => {
  assert.ok(sameOuting("Hot-air balloon over Teotihuacan", "From Mexico City: Hot Air Balloon Ride, Guided Visits to Teotihuacan and Guadalupe", places));
  assert.ok(sameOuting("Teotihuacan pyramids", "Hot Air Balloon Ride, Guided Visits to Teotihuacan", places));
  assert.ok(sameOuting("Mexican cooking class with a market visit", "Traditional Mexico City Cooking Class – Hands-On Culinary Experience", places));
  assert.ok(sameOuting("Visit an Emberá community on the Chagres River", "Waterfall and Embera Village Tour with lunch", places));
  assert.ok(sameOuting("Lucha libre at Arena México", "Lucha Libre Experience – Tacos, Tequila, Mezcal Tour Mexico City", places));
});

test("sharing a city or ordinary words isn't a match", () => {
  assert.ok(!sameOuting("Mexico City Metropolitan Cathedral", "Mexico City E-Bike Tour – Tacos and Churros Experience", places));
  assert.ok(!sameOuting("Mexican market walking tour", "Lucha Libre Experience – Tacos, Tequila, Mezcal Tour Mexico City", places));
  assert.ok(!sameOuting("Sunday bike ride on Paseo de la Reforma", "Mexico City E-Bike Tour – Tacos and Churros Experience", places));
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

const { samePlaceName } = await import("../server/lists.ts");

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
  assert.ok(after.bookedIdeas?.includes("Palacio de Bellas Artes"));

  const mine = { id: "m", tripId, name: "My places", emoji: "📍", entries: [
    { id: "e1", title: "Bellas Artes Palacio", kind: "place", done: false, addedAt: "2028-01-01T00:00:00Z" },
    { id: "e2", title: "Quiet Garden", kind: "place", done: false, addedAt: "2028-01-01T00:00:00Z" },
  ], createdAt: "2028-01-01T00:00:00Z" } as never;
  const own = await listSuggestions(mine, trip, [tour]);
  assert.deepEqual(own.bookedPicks?.map((p) => [p.id, p.bookedAs, p.inTour]), [["e1", "Sample Day Out", true]]);
});
