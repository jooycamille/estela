import assert from "node:assert/strict";
import { test } from "node:test";
import { findBaggage } from "../server/emailHeuristics.ts";

// Made-up booking email wording.
test("cabin and checked allowances as stated", () => {
  assert.deepEqual(findBaggage("Flight XX123\nCabin baggage: 1 x 10kg\nChecked baggage: 1PC\n"), { cabin: "1 × 10 kg", checked: "1 piece" });
  assert.deepEqual(findBaggage("Carry-on bag - Personal item only\nChecked bag: Not included"), { cabin: "Personal item only", checked: "None" });
  assert.deepEqual(findBaggage("Baggage allowance: 2PC"), { checked: "2 pieces" });
  assert.deepEqual(findBaggage("Hand luggage allowance (per passenger): 7 kg"), { cabin: "7 kg" });
});

test("no allowance, or different ones for different flights: left out", () => {
  assert.equal(findBaggage("Add checked baggage when you manage your booking."), undefined);
  assert.equal(findBaggage("Checked baggage: 1PC\nChecked baggage: 2PC"), undefined);
});
