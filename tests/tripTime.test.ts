import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItineraryItem, Trip } from "../shared/types.ts";
import { tripCalendar } from "../server/calendar.ts";
import { dayPlaces } from "../server/dayInfo.ts";
import { differenceText, hoursApart, msToWall, wallToMs } from "../src/zones.ts";

// Made-up trip: a flight from Bogotá to Lima, a stay there, and a walking tour.
const trip = {
  id: "t1", name: "Madeup Andes", destination: "Peru", places: [{ type: "country", name: "Peru", countryCode: "PE" }],
  startDate: "2027-05-10", endDate: "2027-05-13", purpose: "leisure", party: "solo", styles: [], createdAt: "2027-01-01T00:00:00Z",
} as Trip;
const items = [
  { id: "f1", tripId: "t1", kind: "flight", flightNumber: "XX123", from: "BOG", to: "LIM", departureTime: "2027-05-10T08:00", arrivalTime: "2027-05-10T11:10", confirmationCode: "MADEUP", price: { amount: 400, currency: "USD" }, changes: [], source: "manual", createdAt: "" },
  { id: "s1", tripId: "t1", kind: "stay", name: "Madeup House, Lima", address: "Calle Inventada 1, Lima, Peru", lat: -12.12, lon: -77.03, checkIn: "2027-05-10T15:00", checkOut: "2027-05-13T11:00", source: "manual", createdAt: "" },
  { id: "a1", tripId: "t1", kind: "activity", title: "Walking tour; old town, food", location: "Plaza Inventada", start: "2027-05-11T09:30", end: "2027-05-11T12:00", source: "manual", createdAt: "" },
] as unknown as ItineraryItem[];

test("wall times convert to real moments in their zone and back", () => {
  const ms = wallToMs("2027-05-10T08:00", "America/Bogota");
  assert.equal(new Date(ms).toISOString(), "2027-05-10T13:00:00.000Z");
  assert.equal(msToWall(ms, "Europe/Madrid"), "2027-05-10T15:00");
});

test("time differences are worded from home", () => {
  const at = Date.parse("2027-05-10T12:00:00Z");
  assert.equal(hoursApart("Europe/Madrid", "America/Bogota", at), 7);
  assert.equal(differenceText("Europe/Madrid", "America/Bogota", "home", at), "7 hours ahead of home");
  assert.equal(differenceText("America/Bogota", "Asia/Kolkata", "home", at), "10 h 30 min behind home");
  assert.equal(differenceText("America/Lima", "America/Bogota", "home", at), undefined);
});

test("each day knows where you are and its time zone", () => {
  const days = dayPlaces(trip, items);
  assert.deepEqual(Object.keys(days), ["2027-05-10", "2027-05-11", "2027-05-12", "2027-05-13"]);
  assert.equal(days["2027-05-11"].tz, "America/Lima");
  assert.equal(days["2027-05-13"].tz, "America/Lima"); // the last morning, still there
});

test("the calendar has each booking at the right moment, without prices", () => {
  const ics = tripCalendar(trip, items, "https://example.test");
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  // Departs 08:00 in Bogotá (UTC-5), lands 11:10 in Lima (UTC-5).
  assert.match(ics, /SUMMARY:Flight XX123 BOG → LIM\r\nDTSTART:20270510T130000Z\r\nDTEND:20270510T161000Z/);
  // A stay is all day over its nights: check-out morning isn't one.
  assert.match(ics, /DTSTART;VALUE=DATE:20270510\r\nDTEND;VALUE=DATE:20270513/);
  // Commas and semicolons are escaped; the tour is in Lima's time.
  assert.match(ics, /SUMMARY:Walking tour\\; old town\\, food\r\nDTSTART:20270511T143000Z\r\nDTEND:20270511T170000Z/);
  assert.match(ics, /Booking reference MADEUP/);
  assert.doesNotMatch(ics, /\bUSD\b|\b400\b/); // the price (as a whole number: timestamps have digits too)
  // No line is longer than 75 bytes.
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
});
