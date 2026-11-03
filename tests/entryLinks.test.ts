import assert from "node:assert/strict";
import { test } from "node:test";
import type { ListEntry, Trip, TripList } from "../shared/types.ts";
import { entryLinks } from "../server/lists.ts";

const trip = { id: "t", name: "T", destination: "Medellín", startDate: "2027-03-01", endDate: "2027-03-10", purpose: "leisure", party: "solo", styles: [], places: [{ type: "city", name: "Medellín", countryCode: "CO", lat: 6.25, lon: -75.56 }] } as unknown as Trip;
const list = { id: "l", tripId: "t", name: "Medellín", emoji: "🇨🇴", auto: true, place: { type: "city", name: "Medellín", countryCode: "CO", lat: 6.25, lon: -75.56 }, entries: [], createdAt: "" } as TripList;
const entry = (kind: ListEntry["kind"], title: string, extra: Partial<ListEntry> = {}) => ({ id: "e", title, kind, done: false, addedAt: "", ...extra }) as ListEntry;

test("saved entries get links: where to try food, tours for things to do, a map for places", () => {
  const food = entryLinks(entry("thing", "Bandeja paisa"), list, trip, [])!;
  assert.equal(food[0].label, "Where to try it");
  assert.match(food[0].url, /google\.com\/maps\/search\/.*Bandeja%20paisa%20near%20Medell/);
  assert.deepEqual(entryLinks(entry("activity", "Salsa class"), list, trip, [])!.map((l) => l.label), ["GetYourGuide", "Viator"]);
  assert.equal(entryLinks(entry("place", "Hatoviejo"), list, trip, [])![0].label, "Map");
  assert.equal(entryLinks(entry("place", "Hatoviejo", { lat: 6.2, lon: -75.5 }), list, trip, []), undefined); // map link comes from its coordinates
});
