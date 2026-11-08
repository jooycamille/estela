import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityItem, ItineraryItem, Trip, TripList } from "../shared/types.ts";

// The map service, faked: this town is an area, everything else is one spot, and searches around it find made-up places.
const looked: string[] = [];
globalThis.fetch = (async (input: string | URL) => {
  const url = decodeURIComponent(String(input)).replace(/\+/g, " ");
  looked.push(url);
  const q = new URL(url).searchParams.get("q") ?? "";
  const hit = (name: string, type = "x") => ({ name, type, lat: "5.79", lon: "-75.78", display_name: `${name}, Madeuptown` });
  let body: unknown[] = [];
  if (q.startsWith("Madeuptown")) body = [{ name: "Madeuptown", addresstype: "town", type: "town", lat: "5.79", lon: "-75.78" }];
  else if (q.startsWith("Zefir")) body = [{ name: "Zefir", addresstype: "amenity", type: "cafe", lat: "5.79", lon: "-75.78" }];
  else if (q === "museum") body = [hit("Madeup Museum"), { ...hit(""), name: "" }];
  else if (q === "church") body = [hit("Catedral Madeup"), hit("Madeup Hall")];
  else if (q === "park") body = [hit("Parque Madeup")];
  else if (q === "viewpoint") body = [hit("Mirador Madeup")];
  else if (q === "attraction") body = [hit("Mirador Madeup"), hit("Madeup Steps")];
  else if (q === "restaurant") body = [hit("Casa Madeup")];
  else if (q === "cafe") body = [hit("Cafe Madeup")];
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const { broadPlaces, exploreIdeas, mightBeArea } = await import("../server/exploreArea.ts");

const trip = { id: "t" } as Trip;
const activity = (location: string, more: Partial<ActivityItem> = {}) => ({ id: location, tripId: "t", kind: "activity", title: "Made-up", start: "2027-03-02T09:00", location, lat: 5.79, lon: -75.78, ...more }) as ActivityItem;
const guide = { id: "g", tripId: "t", auto: true, name: "Madeup City", emoji: "🗺️", entries: [] } as unknown as TripList;

test("an address or plus code isn't a broad place", () => {
  assert.equal(mightBeArea("Madeuptown, Region, Country"), true);
  assert.equal(mightBeArea("Calle 12 #3-4, Madeuptown"), false);
  assert.equal(mightBeArea("2C3X+4P, Madeuptown"), false);
});

test("a day naming a town is found, once, and a specific place or a ride isn't", async () => {
  const items: ItineraryItem[] = [activity("Madeuptown, Region, Country"), activity("Zefir Cafe, Madeuptown"), activity("Madeuptown, Region, Country", { id: "again" }), activity("Madeuptown, Region, Country", { id: "ride", category: "transfer", start: "2027-03-05T09:00" })];
  const places = await broadPlaces(trip, items, [guide], [{ listId: "g" }]);
  assert.deepEqual(places.map((p) => [p.day, p.name, p.listId]), [["2027-03-02", "Madeuptown", "g"]]);
});

test("a town you've planned from a list is found too, and a city with its own guide isn't", async () => {
  const list = { ...guide, entries: [{ id: "e", title: "Madeuptown", kind: "place", address: "Madeuptown, Region", lat: 5.79, lon: -75.78, day: "2027-03-03", done: false, addedAt: "2027-01-01" }] } as TripList;
  assert.deepEqual((await broadPlaces(trip, [], [list], [])).map((p) => p.day), ["2027-03-03"]);
  const own = { ...guide, name: "Madeuptown" } as TripList;
  assert.deepEqual(await broadPlaces(trip, [activity("Madeuptown, Region")], [own], []), []);
});

test("ideas are sorted into places, things to do and food, named and listed once", async () => {
  const ideas = await exploreIdeas({ lat: 5.79, lon: -75.78 }, "Madeuptown");
  assert.deepEqual(ideas.sights.map((i) => i.title), ["Madeup Museum", "Catedral Madeup", "Parque Madeup"]); // no unnamed, and not any hall
  assert.deepEqual(ideas.toDo.map((i) => i.title), ["Mirador Madeup", "Madeup Steps"]);
  assert.deepEqual(ideas.eat.map((i) => i.title), ["Casa Madeup", "Cafe Madeup"]);
  assert.ok(ideas.links.every((l) => l.url.startsWith("https://") && l.url.includes("Madeuptown")));
  assert.ok(looked.some((u) => u.includes("bounded=1")), "searches stay around the town");
});
