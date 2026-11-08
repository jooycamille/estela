import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ListEntry, TripList } from "../shared/types.ts";

const dir = mkdtempSync(join(tmpdir(), "heyjoy-price-"));
process.env.DB_PATH = join(dir, "db.json");
process.env.GOOGLE_MAPS_API_KEY = "made-up-test-key";
process.env.GOOGLE_PRICE_MONTHLY_LIMIT = "5";
const { priceFromPlaces } = await import("../server/googlePlaces.ts");
const { fillPrice, guidePrice, isRestaurant } = await import("../server/lists.ts");

const list = { id: "l", tripId: "t", auto: true, name: "Mexico City", emoji: "🇲🇽", place: { type: "city", name: "Mexico City", countryCode: "MX", lat: 19.43, lon: -99.13 }, entries: [] } as unknown as TripList;
const restaurant = (title: string, more: Partial<ListEntry> = {}): ListEntry => ({ id: title, title, kind: "place", section: "eat", done: false, addedAt: "2027-01-01", ...more });

const realFetch = globalThis.fetch;
function fakeGoogle(answer: () => Response) {
  const calls: { mask: string | null; body: { textQuery: string } }[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ mask: new Headers(init.headers).get("X-Goog-FieldMask"), body: JSON.parse(String(init.body)) });
    return answer();
  }) as typeof fetch;
  return calls;
}
const google = (priceLevel?: string, text = "Madeup Bistro") => () => Response.json({ places: [{ displayName: { text }, priceLevel, location: { latitude: 19.42, longitude: -99.16 } }] });

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a restaurant's price comes from the place you meant, nearby", () => {
  const near = { lat: 19.43, lon: -99.13 };
  const at = (text: string, priceLevel?: string, latitude = 19.42, longitude = -99.16) => ({ displayName: { text }, priceLevel, location: { latitude, longitude } });
  assert.equal(priceFromPlaces("Café Madeup", [at("Cafe Madeup Roma", "PRICE_LEVEL_INEXPENSIVE")], near), 1);
  assert.equal(priceFromPlaces("Madeup Bistro", [at("Madeup Bistro", "PRICE_LEVEL_MODERATE")], near), 2);
  assert.equal(priceFromPlaces("Madeup Bistro", [at("Madeup Bistro", "PRICE_LEVEL_VERY_EXPENSIVE")], near), 3);
  assert.equal(priceFromPlaces("Madeup Bistro", [at("Madeup Bistro")], near), undefined); // Google lists none
  assert.equal(priceFromPlaces("Madeup Bistro", [at("Other Grill", "PRICE_LEVEL_EXPENSIVE")], near), undefined); // another restaurant
  assert.equal(priceFromPlaces("Madeup Bistro", [at("Madeup Bistro", "PRICE_LEVEL_EXPENSIVE", 40.7, -74)], near), undefined); // another city
});

test("Estela's guide answers without asking Google", async () => {
  const calls = fakeGoogle(google("PRICE_LEVEL_EXPENSIVE"));
  const entry = restaurant("mercado de san juan");
  await fillPrice(entry, list);
  assert.equal(entry.price, guidePrice("Mercado de San Juan", list));
  assert.ok(entry.price);
  assert.equal(calls.length, 0);
});

test("otherwise one lookup, and not again", async () => {
  const calls = fakeGoogle(google("PRICE_LEVEL_MODERATE"));
  const entry = restaurant("Madeup Bistro");
  await fillPrice(entry, list);
  assert.equal(entry.price, 2);
  await fillPrice(entry, list);
  assert.equal(calls.length, 1);
  assert.match(calls[0].mask ?? "", /priceLevel/);
  assert.equal(calls[0].body.textQuery, "Madeup Bistro, Mexico City");
});

test("no price listed: no tag, and it isn't asked again", async () => {
  const calls = fakeGoogle(google(undefined));
  const entry = restaurant("Madeup Bistro");
  await fillPrice(entry, list);
  await fillPrice(entry, list);
  assert.equal(entry.price, undefined);
  assert.equal(calls.length, 1);
});

test("a failed lookup can try again later", async () => {
  fakeGoogle(() => new Response("", { status: 500 }));
  const entry = restaurant("Madeup Bistro");
  await assert.rejects(fillPrice(entry, list));
  assert.equal(entry.priceChecked, undefined);
});

test("a price you set yourself, and anything that isn't a restaurant, is left alone", async () => {
  const calls = fakeGoogle(google("PRICE_LEVEL_EXPENSIVE"));
  const yours = restaurant("Madeup Bistro", { price: 1 });
  await fillPrice(yours, list);
  assert.equal(yours.price, 1);
  const cleared = restaurant("Madeup Bistro", { priceChecked: true });
  await fillPrice(cleared, list);
  assert.equal(cleared.price, undefined);
  const museum = restaurant("Madeup Museum", { section: "see" });
  assert.equal(isRestaurant(museum, list), false);
  await fillPrice(museum, list);
  assert.equal(calls.length, 0);
});

test("stops at its monthly limit and keeps the address search count", async () => {
  const usagePath = join(dir, "google-usage.json");
  writeFileSync(usagePath, JSON.stringify({ month: new Date().toISOString().slice(0, 7), used: 7, priceUsed: 5 }));
  const calls = fakeGoogle(google("PRICE_LEVEL_MODERATE"));
  const entry = restaurant("Madeup Bistro");
  await fillPrice(entry, list);
  assert.equal(calls.length, 0);
  assert.equal(entry.priceChecked, undefined); // tried again next month
  writeFileSync(usagePath, JSON.stringify({ month: new Date().toISOString().slice(0, 7), used: 7, priceUsed: 1 }));
  await fillPrice(entry, list);
  assert.deepEqual({ used: 7, priceUsed: 2 }, (({ used, priceUsed }) => ({ used, priceUsed }))(JSON.parse(readFileSync(usagePath, "utf8"))));
});
