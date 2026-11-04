import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-merge-")), "db.json");
const { upsertFromEmail } = await import("../server/items.ts");
const { db } = await import("../server/db.ts");

test("a shorter follow-up email keeps the details an earlier one gave", async () => {
  const tripId = "guide-merge-trip";
  const base = { kind: "activity", source: "email", title: "Blue Lagoon Tour", start: "2028-03-05T09:00", confirmationCode: "BR-1111111111" } as const;
  await upsertFromEmail(tripId, [{ ...base, guide: { meetingPoint: "12 Sample St", whatToBring: ["Towel"] } }]);
  const result = await upsertFromEmail(tripId, [{ ...base, guide: {} }]);
  assert.equal(result.updated, 1);
  const item = db.items.find((i) => i.tripId === tripId);
  assert.ok(item?.kind === "activity");
  assert.equal(item.guide?.meetingPoint, "12 Sample St");
  assert.deepEqual(item.guide?.whatToBring, ["Towel"]);
});

const booking = { kind: "activity", source: "email", title: "Sample Bay E-Bike Tour with Tacos", start: "2028-03-05T09:30", confirmationCode: "AB12345", price: { amount: 80, currency: "AUD" } } as const;
const receipt = { kind: "activity", source: "email", title: "E-bike tour", start: "2028-03-05T09:00", fromReceipt: true, notes: "Paid · receipt 123", price: { amount: 55, currency: "USD" } } as const;
const inTrip = (tripId: string) => db.items.filter((i) => i.tripId === tripId);

test("a receipt for a booking you already have adds to it, without changing its name, time or price", async () => {
  await upsertFromEmail("t-after", [booking]);
  const result = await upsertFromEmail("t-after", [receipt]);
  assert.deepEqual([result.added, result.updated], [0, 1]);
  const [item] = inTrip("t-after");
  assert.ok(item.kind === "activity");
  assert.equal(item.title, booking.title);
  assert.equal(item.start, booking.start);
  assert.equal(item.price?.amount, 80);
  assert.equal(item.notes, receipt.notes);
});

test("the booking email arriving after its receipt takes over", async () => {
  await upsertFromEmail("t-before", [receipt]);
  const result = await upsertFromEmail("t-before", [booking]);
  assert.deepEqual([result.added, result.updated], [0, 1]);
  const [item] = inTrip("t-before");
  assert.ok(item.kind === "activity");
  assert.equal(item.title, booking.title);
  assert.equal(item.start, booking.start);
  assert.equal(item.fromReceipt, undefined);
});

test("a similar tour on another day stays separate", async () => {
  await upsertFromEmail("t-other", [booking]);
  const result = await upsertFromEmail("t-other", [{ ...receipt, start: "2028-03-09T09:00" }]);
  assert.equal(result.added, 1);
  assert.equal(inTrip("t-other").length, 2);
});

test("a receipt with a guessed date doesn't take over a tour that shares only one word", async () => {
  await upsertFromEmail("t-guess", [booking]);
  const result = await upsertFromEmail("t-guess", [{ ...receipt, start: "2028-03-01T09:00", dateEstimated: true }]);
  assert.equal(result.added, 1);
});

test("re-importing keeps what you added to the included lists", async () => {
  await upsertFromEmail("t-lists", [{ ...booking, guide: { included: ["Lunch"] } }]);
  const [item] = inTrip("t-lists");
  assert.ok(item.kind === "activity");
  item.guide = { ...item.guide, included: ["Lunch", "My note"], notIncluded: ["Tips"] };
  await upsertFromEmail("t-lists", [{ ...booking, guide: { included: ["Lunch", "Pickup"] } }]);
  assert.deepEqual(item.guide?.included, ["Lunch", "My note", "Pickup"]);
  assert.deepEqual(item.guide?.notIncluded, ["Tips"]);
});

test("re-importing keeps what you've ticked on the what-to-bring list", async () => {
  await upsertFromEmail("t-bring", [{ ...booking, guide: { whatToBring: ["Cash", "Towel"] } }]);
  const [item] = inTrip("t-bring");
  assert.ok(item.kind === "activity");
  item.broughtItems = ["Cash"];
  await upsertFromEmail("t-bring", [{ ...booking, guide: { whatToBring: ["Cash", "Towel", "Hat"] } }]);
  assert.deepEqual(item.broughtItems, ["Cash"]);
  assert.deepEqual(item.guide?.whatToBring, ["Cash", "Towel", "Hat"]);
});
