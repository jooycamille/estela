import assert from "node:assert/strict";
import { test } from "node:test";
import { localApps } from "../server/localApps.ts";

const names = (country?: string, city?: string) => localApps(country, city).map((a) => a.name);

test("a city gets its own apps first, however its name is written", () => {
  assert.equal(names("CO", "Medellín")[0], "Uber");
  assert.ok(names("CO", "medellin").includes("Cívica"));
  assert.ok(names("MX", "Mexico City").includes("911 CDMX"));
});

test("a country's apps apply to all of it, and an unconfirmed city adds no guesses", () => {
  assert.ok(names("PH", "Madeup Town").includes("Grab"));
  assert.ok(names("SG").includes("MyICA"));
  assert.deepEqual(names("CO", "Madeup Town"), ["Google Maps", "Google Translate"]);
});

test("anywhere still gets the two that work everywhere, and every app links to a source", () => {
  assert.deepEqual(names(), ["Google Maps", "Google Translate"]);
  for (const place of [["MX", "Mexico City"], ["PA", "Panama City"], ["CO", "Medellín"], ["SG"], ["PH"]]) {
    for (const app of localApps(place[0], place[1])) assert.match(app.url, /^https:\/\//, app.name);
  }
  const quake = localApps("MX", "Mexico City").find((a) => a.name === "911 CDMX");
  assert.match(quake!.why, /local phone number/);
});
