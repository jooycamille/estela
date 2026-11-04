import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-noflights-")), "db.json");
const { db } = await import("../server/db.ts");
const { assumedStops, tripPlaces } = await import("../server/tripPlaces.ts");
const { ruleSuggestions } = await import("../server/suggestions.ts");
const { guideSuggestions, ensureGuides } = await import("../server/lists.ts");

const trip = { id: "ph", name: "Philippines", destination: "Philippines", places: [{ type: "country", name: "Philippines", countryCode: "PH" }], parts: [], startDate: "2028-03-01", endDate: "2028-03-20", purpose: "leisure", party: "family", styles: ["food", "nature"], ownerId: "me", members: [] } as never;
const stay = { id: "s", tripId: "ph", kind: "stay", name: "Home", address: "12 Sample St, Sample Village, Antipolo, Calabarzon, Philippines", checkIn: "2028-03-05T15:00", checkOut: "2028-03-08T12:00" } as never;

test("without flights, a stay's address says where you'll be, for the whole trip", () => {
  const { stops } = tripPlaces(trip, [stay]);
  assert.deepEqual(stops.map((s) => [s.city, s.countryCode, s.from, s.to]), [["Antipolo", "PH", "2028-03-01", "2028-03-20"]]);
});

test("with only a country, weather falls back to its largest city, marked as assumed", () => {
  assert.equal(tripPlaces(trip, []).stops.length, 0);
  const [stop] = assumedStops(trip);
  assert.equal(stop.countryCode, "PH");
  assert.equal(stop.assumed, true);
});

test("no flights: tips offer flight searches, from your usual airport, to the nearest big airport", () => {
  db.trips.push({ id: "older", ownerId: "me", startDate: "2020-01-01" } as never, { id: "recent", ownerId: "me", startDate: "2026-12-01" } as never);
  db.items.push({ id: "f1", tripId: "older", kind: "flight", from: "SYD", to: "SIN", departureTime: "2020-01-01T09:00" } as never, { id: "f2", tripId: "recent", kind: "flight", from: "MEL", to: "SYD", departureTime: "2026-12-01T09:00" } as never);
  const tip = ruleSuggestions(trip, [stay])[0];
  assert.equal(tip.title, "Find flights to Manila (MNL)");
  assert.deepEqual(tip.links?.map((l) => l.label), ["Google Flights", "Skyscanner", "Kayak"]);
  assert.match(tip.links![1].url, /\/mel\/mnl\/280301\/280320\/$/);
});

test("a guide for a stay near Manila includes Manila's ideas; countries without a guide get searches", () => {
  db.trips.push(trip);
  db.items.push(stay);
  ensureGuides(trip, [stay]);
  const guide = db.lists.find((l) => l.tripId === "ph" && l.auto)!;
  assert.equal(guide.name, "Antipolo");
  const g = guideSuggestions(guide, trip, [stay]).guide;
  assert.ok(g.restaurants.some((r) => r.title === "Toyo Eatery"));
  assert.ok(g.sights.some((r) => r.title === "Intramuros"));
  assert.ok(g.food.some((r) => r.title === "Adobo"));

  const elsewhere = { ...(trip as object), id: "pt", places: [{ type: "country", name: "Portugal", countryCode: "PT" }], destination: "Portugal" } as never;
  db.trips.push(elsewhere);
  ensureGuides(elsewhere, []);
  const pt = db.lists.find((l) => l.tripId === "pt" && l.auto)!;
  const p = guideSuggestions(pt, elsewhere, []).guide;
  assert.equal(p.restaurants[0].title, "Top-rated restaurants in Portugal");
  assert.equal(p.food[0].title, "Local dishes in Portugal");
  assert.equal(p.sights[0].title, "Top sights in Portugal");
});
