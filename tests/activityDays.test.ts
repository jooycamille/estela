import assert from "node:assert/strict";
import { test } from "node:test";
import { activityDays } from "../shared/days.ts";

test("an activity over several days is on each of them", () => {
  assert.deepEqual(activityDays({ start: "2027-03-30T09:00", end: "2027-04-02T11:00" }), ["2027-03-30", "2027-03-31", "2027-04-01", "2027-04-02"]);
});

test("an activity within one day, or with no end, is on its start date", () => {
  assert.deepEqual(activityDays({ start: "2027-03-02T09:00", end: "2027-03-02T17:00" }), ["2027-03-02"]);
  assert.deepEqual(activityDays({ start: "2027-03-02T09:00" }), ["2027-03-02"]);
});

test("a late night isn't another day, but a morning finish is", () => {
  assert.deepEqual(activityDays({ start: "2027-03-02T21:00", end: "2027-03-03T01:30" }), ["2027-03-02"]);
  assert.deepEqual(activityDays({ start: "2027-03-02T21:00", end: "2027-03-03T09:00" }), ["2027-03-02", "2027-03-03"]);
});

test("an end date that's impossible or mistyped doesn't fill the itinerary", () => {
  assert.deepEqual(activityDays({ start: "2027-03-02T09:00", end: "2027-03-01T09:00" }), ["2027-03-02"]);
  assert.deepEqual(activityDays({ start: "2027-03-02T09:00", end: "2028-03-02T09:00" }), ["2027-03-02"]);
});
