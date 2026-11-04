import assert from "node:assert/strict";
import { test } from "node:test";
import { ItemInput } from "../server/items.ts";

test("ends can't come before starts (flights excepted)", () => {
  const activity = { kind: "activity", title: "Tour", start: "2027-03-02T10:00" };
  assert.equal(ItemInput.safeParse({ ...activity, end: "2027-03-02T12:00" }).success, true);
  assert.equal(ItemInput.safeParse({ ...activity, end: "2027-03-01T12:00" }).success, false);
  const stay = { kind: "stay", name: "Hotel", checkIn: "2027-03-02T15:00" };
  assert.equal(ItemInput.safeParse({ ...stay, checkOut: "2027-03-05T11:00" }).success, true);
  assert.equal(ItemInput.safeParse({ ...stay, checkOut: "2027-03-02T15:00" }).success, false);
  // Sydney → Dallas lands "before" it leaves, in local times: still fine.
  assert.equal(ItemInput.safeParse({ kind: "flight", flightNumber: "QF7", from: "SYD", to: "DFW", departureTime: "2026-12-09T14:05", arrivalTime: "2026-12-09T12:30" }).success, true);
});
