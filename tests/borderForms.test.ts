import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlightItem } from "../shared/types.ts";
import { borderForms } from "../server/arrivalForms.ts";

const flight = (flightNumber: string, from: string, to: string, departureTime: string, arrivalTime: string) =>
  ({ id: flightNumber, tripId: "t", kind: "flight", flightNumber, from, to, departureTime, arrivalTime, source: "manual", createdAt: "" }) as unknown as FlightItem;

test("border forms follow each crossing, including US connections and leaving Colombia", () => {
  const flights = [
    flight("XX1", "MEL", "SYD", "2027-03-01T08:00", "2027-03-01T09:30"), // domestic: nothing
    flight("XX2", "SYD", "DFW", "2027-03-01T12:00", "2027-03-01T10:00"), // US connection: still immigration
    flight("XX3", "DFW", "MEX", "2027-03-01T14:00", "2027-03-01T16:30"),
    flight("XX4", "MEX", "BOG", "2027-03-08T09:00", "2027-03-08T14:00"),
    flight("XX5", "BOG", "PTY", "2027-03-15T09:00", "2027-03-15T11:00"), // connecting airside in Panama: no form
    flight("XX6", "PTY", "SYD", "2027-03-15T13:00", "2027-03-17T06:00"),
  ];
  const transit = (f: FlightItem) => f.to === "DFW" || f.to === "PTY";
  const forms = borderForms(flights, "AU", (c) => c, transit);
  assert.deepEqual(
    forms.map((f) => `${f.direction} ${f.country} ${f.flight.flightNumber} ${f.when}`),
    ["arrive US XX2 arrival", "arrive MX XX3 plane", "arrive CO XX4 online", "leave CO XX5 online", "arrive AU XX6 plane"],
  );
  assert.equal(forms[2].due, "2027-03-08T08:00"); // Check-MIG done by 1 hour before the flight
});
