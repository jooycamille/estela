import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePlusCode } from "../server/pluscode.ts";

test("decodes full and short plus codes", () => {
  // The standard example: 8FVC9G8F+6X is in Zürich; the short form "9G8F+6X" near Zürich gives the same place.
  const full = decodePlusCode("8FVC9G8F+6X")!;
  assert.ok(Math.abs(full.lat - 47.3656) < 0.0003 && Math.abs(full.lon - 8.525) < 0.0003, JSON.stringify(full));
  const short = decodePlusCode("9G8F+6X", { lat: 47.4, lon: 8.6 })!;
  assert.ok(Math.abs(short.lat - full.lat) < 1e-9 && Math.abs(short.lon - full.lon) < 1e-9);
  assert.equal(decodePlusCode("9G8F+6X"), undefined); // a short code needs a reference point
});
