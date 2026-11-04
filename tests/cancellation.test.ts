import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cancellationOf, flightForTransfer } from "../shared/cancellation.ts";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "heyjoy-cancel-")), "db.json");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { parseEmail } = await import("../server/emailParser.ts");
const { buildPrep } = await import("../server/prep.ts");
const { tripPlaces } = await import("../server/tripPlaces.ts");

const on = (cancellation: string, start = "2028-03-10T09:00") => cancellationOf({ start, guide: { cancellation } });

test("cancellation wordings", () => {
  assert.deepEqual(on("Cancel before 5:00 pm on 8 March for a full refund"), { kind: "free", until: "2028-03-08T17:00", timed: true });
  assert.deepEqual(on("Free cancellation until 7:39 PM, Tuesday, March 7, 2028 (local time in Sampleland)"), { kind: "free", until: "2028-03-07T19:39", timed: true });
  assert.deepEqual(on("RISK FREE cancellation Up to 25 hours before activity start date (activity local time) Non-Refundable Within 25 hours of activity start date"), { kind: "free", until: "2028-03-09T08:00", timed: true });
  assert.deepEqual(on("Free cancellation up to 3 days in advance"), { kind: "free", until: "2028-03-07T09:00", timed: true });
  assert.deepEqual(on("No refunds within 48 hours of the start"), { kind: "free", until: "2028-03-08T09:00", timed: true });
  assert.deepEqual(on("Free cancellation"), { kind: "free" });
  assert.deepEqual(on("Non-refundable"), { kind: "nonrefundable" });
  assert.deepEqual(on("This booking cannot be cancelled."), { kind: "nonrefundable" });
  assert.deepEqual(on("50% refund if you cancel"), { kind: "partial" });
  assert.equal(on("See the operator's terms"), undefined);
  assert.equal(cancellationOf({ start: "2028-03-10T09:00" }), undefined);
});

test("a deadline with no year is the last such date before the activity", () => {
  assert.equal((on("Cancel before 5:00 pm on 30 December for a full refund", "2029-01-02T09:00") as { until: string }).until, "2028-12-30T17:00");
});

test("a ride email becomes a tagged activity linked to its flight", async () => {
  const raw = readFileSync(new URL("./fixtures/ride-confirmed-style.txt", import.meta.url), "utf8");
  const { items } = await parseEmail(raw);
  assert.equal(items.length, 1);
  const a = items[0];
  assert.ok(a.kind === "activity");
  assert.equal(a.title, "Airport pick-up: SMP → Hotel Example");
  assert.equal(a.category, "transfer");
  assert.equal(a.start, "2028-03-01T19:39");
  assert.equal(a.flightNumber, "XX123");
  assert.equal(a.transferLeg, "pickup");
  assert.equal(a.confirmationCode, "123456789");
  assert.deepEqual(a.price, { amount: 41.04, currency: "AUD" });
  assert.equal(a.guide?.provider, "Sample Limo");
  assert.deepEqual(a.links?.map((l) => l.label).sort(), ["Manage booking", "Pick-up details"]);
  assert.match(a.guide?.goodToKnow?.[0] ?? "", /wait for 45 minutes/);
  assert.deepEqual(cancellationOf({ start: a.start, guide: a.guide }), { kind: "free", until: "2028-02-29T19:39", timed: true });
  assert.ok(!JSON.stringify(a).includes("sam@example.com")); // contact details stay out
  assert.ok(!JSON.stringify(a).includes("+61 400"));
});

test("labelled drop-off emails, and a mention of transfers elsewhere isn't a ride", async () => {
  const { items } = await parseEmail("Subject: Your airport transfer\n\nPick-up: Hotel Example, 12 Sample St\nDrop-off: Sample International Airport (SMP)\nPick-up date: 8 March 2028 05:30\nNon-refundable booking");
  const a = items[0];
  assert.ok(a?.kind === "activity");
  assert.equal(a.title, "Airport drop-off: Hotel Example → SMP");
  assert.equal(a.transferLeg, "dropoff");
  assert.equal(a.start, "2028-03-08T05:30");
  assert.deepEqual(cancellationOf({ start: a.start, guide: a.guide }), { kind: "nonrefundable" });
  assert.equal((await parseEmail("Subject: Your hotel\n\nAdd an airport transfer to your stay at checkout.")).items.length, 0);
});

test("rides find their flight", () => {
  const flights = [
    { flightNumber: "XX123", from: "AAA", to: "SMP", departureTime: "2028-03-01T10:00", arrivalTime: "2028-03-01T19:39" },
    { flightNumber: "XX123", from: "AAA", to: "SMP", departureTime: "2028-03-20T10:00", arrivalTime: "2028-03-20T19:39" },
    { flightNumber: "XX456", from: "SMP", to: "BBB", departureTime: "2028-03-08T09:10" },
  ];
  assert.equal(flightForTransfer({ start: "2028-03-01T19:39", flightNumber: "XX123", transferLeg: "pickup", title: "x" }, flights), flights[0]);
  assert.equal(flightForTransfer({ start: "2028-03-08T05:30", transferLeg: "dropoff", title: "Airport drop-off: Hotel → SMP" }, flights), flights[2]);
  assert.equal(flightForTransfer({ start: "2028-03-01T19:39", transferLeg: "pickup", title: "x" }, flights), undefined);
});

test("the checklist reminds you about every free cancellation still open, and nothing else", () => {
  const base = { kind: "activity", tripId: "t", source: "email", createdAt: "2028-01-01T00:00:00Z" };
  const items = [
    { kind: "flight", id: "f", tripId: "t", source: "email", createdAt: "2028-01-01T00:00:00Z", changes: [], flightNumber: "QF1", from: "SYD", to: "MEX", departureTime: "2098-03-01T10:00", arrivalTime: "2098-03-01T19:00" },
    { ...base, id: "a1", title: "Free tour", start: "2098-03-10T09:00", guide: { cancellation: "Free cancellation up to 24 hours before" } },
    { ...base, id: "a2", title: "Ride", category: "transfer", start: "2098-03-02T09:00", guide: { cancellation: "Free cancellation until 7:00 PM, March 1, 2098" } },
    { ...base, id: "a3", title: "Locked tour", start: "2098-03-11T09:00", guide: { cancellation: "Non-refundable" } },
    { ...base, id: "a4", title: "Past deadline", start: "2020-03-11T09:00", guide: { cancellation: "Free cancellation up to 24 hours before" } },
    { ...base, id: "a5", title: "No terms", start: "2098-03-12T09:00" },
    { ...base, id: "a6", title: "Guessed date", start: "2098-03-13T09:00", dateEstimated: true, guide: { cancellation: "Free cancellation up to 24 hours before" } },
  ] as never[];
  const trip = { id: "t", name: "T", destination: "Mexico", startDate: "2098-03-01", endDate: "2098-03-20", purpose: "leisure", party: "solo", styles: [] } as never;
  const places = tripPlaces(trip, items);
  const { todo } = buildPrep(trip, items, places, [], "AU", (c: string) => c);
  const mine = todo.filter((t) => t.group === "Free cancellation");
  assert.deepEqual(mine.map((t) => t.source).sort(), ["Free tour", "Ride"]);
  const tour = mine.find((t) => t.source === "Free tour")!;
  assert.equal(tour.due, "2098-03-09T09:00");
  assert.equal(tour.reminders?.length, 2);
  // Mexico City is UTC-6: 09:00 local, 3 days and then 1 day before the deadline.
  assert.equal(tour.reminders?.[0].at, "2098-03-06T15:00:00.000Z");
  assert.equal(tour.reminders?.[1].at, "2098-03-08T15:00:00.000Z");
});
