import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActivityItem } from "../shared/types.ts";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-where-")), "db.json");
const { addWhereToPlaces } = await import("../server/items.ts");

const activity = (more: Partial<ActivityItem>) => ({ id: "a", tripId: "t", kind: "activity", title: "Made-up", start: "2027-03-02T09:00", ...more }) as ActivityItem;
const titles = (a: ActivityItem) => (a.includes ?? []).map((p) => p.title);

test("the Where of an activity is added to its places, keeping the map position", () => {
  const a = activity({ location: "Madeup Museum, Madeuptown, Country", lat: 5, lon: -75 });
  assert.equal(addWhereToPlaces(a), true);
  assert.deepEqual(a.includes, [{ title: "Madeup Museum", address: "Madeup Museum, Madeuptown, Country", lat: 5, lon: -75 }]);
});

test("it's not added twice, by name or by being the same spot", () => {
  const named = activity({ location: "Madeup Museum, Madeuptown", includes: [{ title: "madeup museum" }] });
  addWhereToPlaces(named);
  assert.equal(named.includes!.length, 1);
  const near = activity({ location: "Fincas Madeup, Madeuptown", lat: 5.8671, lon: -75.7593, includes: [{ title: "Madeup", lat: 5.8672, lon: -75.7594 }] });
  addWhereToPlaces(near);
  assert.deepEqual(titles(near), ["Madeup"]);
});

test("a place you removed stays removed until you change the Where", () => {
  const a = activity({ location: "Madeup Museum, Madeuptown" });
  addWhereToPlaces(a);
  a.includes = [];
  assert.equal(addWhereToPlaces(a), false);
  assert.deepEqual(titles(a), []);
  a.location = "Madeup Park, Madeuptown";
  addWhereToPlaces(a);
  assert.deepEqual(titles(a), ["Madeup Park"]);
});

test("changing the Where replaces what it added, and keeps what you added", () => {
  const a = activity({ location: "Madeup Museum, Madeuptown", includes: [{ title: "My own stop" }] });
  addWhereToPlaces(a);
  a.location = "Madeup Park, Madeuptown";
  addWhereToPlaces(a);
  assert.deepEqual(titles(a), ["My own stop", "Madeup Park"]);
});

test("a first part too short to be a name keeps the next part with it", () => {
  const a = activity({ location: "Brgy, 12 Madeup Street, Madeuptown" });
  addWhereToPlaces(a);
  assert.deepEqual(titles(a), ["Brgy, 12 Madeup Street"]);
});

test("rides aren't places to visit, and a plus code isn't a name", () => {
  const ride = activity({ location: "Madeup Airport", category: "transfer" });
  assert.equal(addWhereToPlaces(ride), false);
  assert.equal(ride.includes, undefined);
  const coded = activity({ location: "2C3X+4P, Madeuptown" });
  addWhereToPlaces(coded);
  assert.deepEqual(titles(coded), ["Madeuptown"]);
});
