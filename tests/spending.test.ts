import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItineraryItem } from "../shared/types.ts";

// The component file has no browser-only code at import, so its pure helper can be tested directly.
const { spendByDay } = await import("../src/components/SpendingView.tsx");

const items = [
  { id: "f", kind: "flight", flightNumber: "MA1", from: "AAA", to: "BBB", departureTime: "2027-03-01T09:00", price: { amount: 300, currency: "USD" } },
  { id: "s", kind: "stay", name: "Madeup Loft", checkIn: "2027-03-01T15:00", checkOut: "2027-03-04T11:00", price: { amount: 600, currency: "USD" } },
  { id: "a", kind: "activity", title: "Madeup tour", start: "2027-03-02T08:00", price: { amount: 50, currency: "USD" } },
  { id: "x", kind: "activity", title: "No price", start: "2027-03-02T10:00" },
] as unknown as ItineraryItem[];

test("a stay is spread over its nights; flights and activities fall on their day", () => {
  const days = spendByDay(items, (i) => i.price?.amount);
  assert.deepEqual(Object.fromEntries(days), {
    "2027-03-01": { flight: 300, stay: 200, activity: 0, trip: 0 },
    "2027-03-02": { flight: 0, stay: 200, activity: 50, trip: 0 },
    "2027-03-03": { flight: 0, stay: 200, activity: 0, trip: 0 },
  });
});

test("a booking without a price (or a rate) adds nothing", () => {
  const days = spendByDay(items, (i) => (i.kind === "activity" ? i.price?.amount : undefined));
  assert.deepEqual([...days.keys()], ["2027-03-02"]);
});

test("budget status: on track, close from 85%, over past it", async () => {
  const { budgetStatus } = await import("../src/components/SpendingView.tsx");
  assert.equal(budgetStatus(500, 1000), "on-track");
  assert.equal(budgetStatus(850, 1000), "close");
  assert.equal(budgetStatus(1000, 1000), "close");
  assert.equal(budgetStatus(1001, 1000), "over");
});
