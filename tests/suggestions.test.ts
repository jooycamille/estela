import assert from "node:assert/strict";
import { test } from "node:test";
import { partOn, type ItineraryItem, type Trip } from "../shared/types.ts";
import { ruleSuggestions } from "../server/suggestions.ts";

// A trip that's solo first, then with a partner's family over Christmas (no flights, so it uses its destinations).
const trip: Trip = {
  id: "t",
  name: "Test",
  destination: "Mexico and Colombia",
  places: [{ type: "country", name: "Colombia", countryCode: "CO" }],
  startDate: "2026-12-09",
  endDate: "2027-01-05",
  purpose: "leisure",
  party: "solo",
  styles: [],
  createdAt: "",
  parts: [
    { id: "a", name: "Mexico", from: "2026-12-09", to: "2026-12-20", party: "solo" },
    { id: "b", name: "Colombia with family", from: "2026-12-21", to: "2027-01-05", party: "family", companions: "my partner's family", kids: "some", stayingWithHosts: true },
  ],
};
const stay: ItineraryItem = { id: "s", tripId: "t", kind: "stay", source: "manual", name: "Hotel", checkIn: "2026-12-09T15:00", checkOut: "2026-12-21T11:00", createdAt: "" };

test("partOn finds the part for a day (inclusive ends)", () => {
  assert.equal(partOn(trip, "2026-12-20")?.id, "a");
  assert.equal(partOn(trip, "2026-12-21T09:00")?.id, "b");
  assert.equal(partOn(trip, "2027-01-06"), undefined);
});

test("suggestions follow each part's companions", () => {
  const titles = ruleSuggestions(trip, [stay]).map((s) => s.title);
  assert.ok(titles.includes("Share your itinerary · Mexico"), "solo tip for the solo part");
  assert.ok(titles.includes("Line up kid-friendly outings · Colombia with family"), "kids-on-some-days tip for the family part");
  assert.ok(titles.includes("Bring a gift for your hosts · Colombia with family"));
  assert.ok(titles.some((t) => t.startsWith("Christmas & New Year in Colombia")));
  assert.ok(!titles.includes("Share your itinerary · Colombia with family"), "no solo tips while with family");
});

test("nights with hosts are still flagged when no stay is booked", () => {
  const nights = ruleSuggestions(trip, [stay]).find((s) => s.title === "Nights without accommodation");
  assert.ok(nights, "missing accommodation is still reported");
  assert.equal(nights!.day, "2026-12-21");
});
