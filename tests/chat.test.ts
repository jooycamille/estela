import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItineraryItem, Trip } from "../shared/types.ts";
import { recentTurns, tripContext } from "../server/chat.ts";

const trip = {
  id: "t", name: "Madeup Coast trip", destination: "Madeuptown", startDate: "2027-03-01", endDate: "2027-03-05", purpose: "leisure", party: "solo",
  styles: ["food"], createdAt: "2027-01-01", dayTitles: { "2027-03-02": "Coffee country" }, dayNotes: { "2027-03-02": "Bring cash" },
} as Trip;
const items = [
  { id: "a", tripId: "t", kind: "activity", title: "Madeup farm tour", start: "2027-03-02T08:00", end: "2027-03-02T14:00", location: "Madeup Finca", confirmationCode: "ZZ9SECRET", price: { amount: 99, currency: "USD" } },
  { id: "s", tripId: "t", kind: "stay", name: "Madeup Loft", address: "Calle 1, Madeuptown", checkIn: "2027-03-01T15:00", checkOut: "2027-03-05T11:00", confirmationCode: "HM0SECRET0" },
] as unknown as ItineraryItem[];

test("Estela knows the bookings in order, the day's own plans and what's left to do", () => {
  const text = tripContext({ trip, items, planned: [{ title: "Madeup Museum", day: "2027-03-02", area: "Centro" }], todos: [{ text: "Buy bus tickets", due: "2027-03-02T09:00" }], today: "2027-02-20", homeCountry: "Madeupland" });
  assert.ok(text.indexOf("Stay: Madeup Loft") < text.indexOf("Activity: Madeup farm tour"), "in order");
  assert.match(text, /2027-03-02 08:00 to 14:00 Activity: Madeup farm tour at Madeup Finca/);
  assert.match(text, /2027-03-02: heading "Coffee country"; note: Bring cash; places: Madeup Museum \(Centro\)/);
  assert.match(text, /Buy bus tickets \(by 2027-03-02\)/);
  assert.match(text, /Today is 2027-02-20/);
  assert.match(text, /Home country: Madeupland/);
});

test("confirmation codes and prices aren't sent", () => {
  const text = tripContext({ trip, items, planned: [], todos: [], today: "2027-02-20" });
  assert.doesNotMatch(text, /SECRET|99/);
});

test("only the latest turns are sent, starting with a question", () => {
  const turns = Array.from({ length: 20 }, (_, n) => ({ role: n % 2 ? "assistant" : "user", text: `turn ${n}` }) as const);
  const kept = recentTurns(turns, 5);
  assert.equal(kept[0].role, "user");
  assert.equal(kept.at(-1)!.text, "turn 19");
  assert.ok(kept.length <= 5);
  assert.deepEqual(recentTurns([{ role: "user", text: "  " }]), []);
});
