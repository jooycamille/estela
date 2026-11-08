import assert from "node:assert/strict";
import { test } from "node:test";
import { publicTransport } from "../server/publicTransport.ts";

const texts = (...cities: string[]) => publicTransport(cities.map((city, i) => ({ city, from: `2027-03-0${i + 1}` }))).map((t) => t.text);

test("a known city says what you need, with a link to check it", () => {
  const [item] = publicTransport([{ city: "Medellín", from: "2027-03-01" }]);
  assert.match(item.text, /Cívica/);
  assert.equal(item.from, "2027-03-01");
  assert.ok(item.links.every((l) => l.url.startsWith("https://")));
});

test("a city Estela doesn't know gets a reminder, not a guess", () => {
  assert.deepEqual(texts("Madeup Town"), ["Check how to pay for public transport in Madeup Town"]);
});

test("no prices that could go out of date, and each is listed once", () => {
  assert.doesNotMatch(JSON.stringify(publicTransport(["Medellín", "Panama City", "Singapore", "Manila"].map((city) => ({ city, from: "2027-03-01" })))), /[$₱]\s?\d|S\$\d/);
  assert.equal(texts("Manila", "Antipolo").length, 1);
  assert.equal(texts("Medellín", "Medellin").length, 1);
});
