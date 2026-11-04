import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A throwaway data folder and a fake network: nothing here reaches Google or OpenStreetMap.
const dir = mkdtempSync(join(tmpdir(), "heyjoy-google-"));
process.env.DB_PATH = join(dir, "db.json");
process.env.GOOGLE_MAPS_API_KEY = "test-key-not-real";
process.env.GOOGLE_MAPS_MONTHLY_LIMIT = "2";
const { searchLodging } = await import("../server/lodging.ts");

const calls: { url: string; init?: RequestInit }[] = [];
let googleReply: () => Response;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return String(url).includes("places.googleapis.com") ? googleReply() : new Response("[]", { status: 200 });
}) as typeof fetch;
const near = { lat: 14.6, lon: 121.1 };
const home = { displayName: { text: "Sample St" }, formattedAddress: "12 Sample St, Antipolo, Rizal, Philippines", location: { latitude: 14.59, longitude: 121.18 }, types: ["premise"], addressComponents: [{ longText: "Sample Village", types: ["neighborhood"] }] };
const museum = { displayName: { text: "Pinto Art Museum" }, formattedAddress: "1 Sierra Madre St, Antipolo", location: { latitude: 14.58, longitude: 121.17 }, types: ["museum", "point_of_interest", "establishment"] };

test("with a key, Google answers: homes are addresses, businesses have names", async () => {
  googleReply = () => new Response(JSON.stringify({ places: [home, museum] }), { status: 200 });
  const results = await searchLodging("12 Sample St Antipolo", near, "any");
  const call = calls.at(-1)!;
  assert.equal(call.url, "https://places.googleapis.com/v1/places:searchText");
  const headers = call.init!.headers as Record<string, string>;
  assert.equal(headers["X-Goog-Api-Key"], "test-key-not-real");
  assert.match(headers["X-Goog-FieldMask"], /places\.formattedAddress/);
  assert.equal(JSON.parse(String(call.init!.body)).locationBias.circle.radius, 50000);
  assert.deepEqual(results[0], { name: undefined, address: home.formattedAddress, lat: 14.59, lon: 121.18, kind: "address", area: "Sample Village", source: "google", precise: true });
  assert.equal(results[1].name, "Pinto Art Museum");
  assert.equal(results[1].kind, "property");
});

test("a repeat search is free (cached); errors and the monthly limit fall back to OpenStreetMap", async () => {
  const before = calls.length;
  await searchLodging("12 Sample St Antipolo", near, "any");
  assert.equal(calls.length, before);

  googleReply = () => new Response("nope", { status: 403 });
  await searchLodging("Another address", near, "any");
  assert.ok(calls.at(-1)!.url.includes("nominatim.openstreetmap.org"));
  assert.equal(JSON.parse(readFileSync(join(dir, "google-usage.json"), "utf8")).used, 2);

  // Limit reached (2): Google isn't called at all.
  const n = calls.filter((c) => c.url.includes("googleapis")).length;
  await searchLodging("Third address", near, "any");
  assert.equal(calls.filter((c) => c.url.includes("googleapis")).length, n);
  assert.ok(calls.at(-1)!.url.includes("nominatim.openstreetmap.org"));
});
