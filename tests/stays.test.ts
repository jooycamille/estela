import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItineraryItem } from "../shared/types.ts";
import { overlapNights, stayFor, staysOn } from "../shared/stays.ts";

// Made-up stays: A for four nights, B booked for two of them too.
const items = [
  { id: "a", kind: "stay", name: "Madeup House", checkIn: "2027-03-01T15:00", checkOut: "2027-03-05T11:00" },
  { id: "b", kind: "stay", name: "Madeup Cabin", checkIn: "2027-03-02T15:00", checkOut: "2027-03-04T11:00" },
] as unknown as ItineraryItem[];

test("the stays covering a night (not the morning you leave)", () => {
  assert.deepEqual(staysOn(items, "2027-03-01").map((s) => s.id), ["a"]);
  assert.deepEqual(staysOn(items, "2027-03-03").map((s) => s.id), ["a", "b"]);
  assert.deepEqual(staysOn(items, "2027-03-05"), []);
});

test("your chosen base wins; otherwise the earliest check-in", () => {
  assert.equal(stayFor({}, items, "2027-03-02")?.id, "a");
  assert.equal(stayFor({ nightStay: { "2027-03-02": "b" } }, items, "2027-03-02")?.id, "b");
  assert.equal(stayFor({ nightStay: { "2027-03-02": "gone" } }, items, "2027-03-02")?.id, "a"); // a deleted stay
});

test("one choice covers the nights in a row with the same overlap", () => {
  assert.deepEqual(overlapNights(items, "2027-03-03"), ["2027-03-02", "2027-03-03"]);
});
