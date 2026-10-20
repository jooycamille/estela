import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseEmail } from "../server/emailParser.ts";

// These exercise the rule-based parser (no ANTHROPIC_API_KEY), which is the fallback for every import.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const stayFrom = async (name: string) => {
  const { items } = await parseEmail(fixture(name));
  const stay = items.find((i) => i.kind === "stay");
  assert.ok(stay && stay.kind === "stay", `no stay parsed from ${name}`);
  return stay;
};

test("Agoda-style confirmation", async () => {
  const s = await stayFrom("agoda-style.txt");
  assert.equal(s.name, "Hotel Santa Lucía");
  assert.equal(s.address, "Durango 87 Colonia Roma, Mexico City, Mexico, 6700");
  assert.equal(s.confirmationCode, "1234567890");
  assert.equal(s.checkIn, "2027-03-03T15:00");
  assert.equal(s.checkOut, "2027-03-10T13:00");
  assert.deepEqual(s.price, { amount: 489, currency: "USD" });
  assert.equal(s.notes, "Check-in after 3:00 pm · Check-out before 1:00 pm");
});

test("Booking.com-style confirmation", async () => {
  const s = await stayFrom("booking-com-style.txt");
  assert.equal(s.name, "Casa Azul Boutique");
  assert.equal(s.address, "Calle Macedonio Alcalá 401, Centro, 68000 Oaxaca, Mexico");
  assert.equal(s.confirmationCode, "4021.887.193");
  assert.equal(s.checkIn, "2026-12-18T14:00");
  assert.equal(s.checkOut, "2026-12-21T12:00");
  assert.deepEqual(s.price, { amount: 5220, currency: "MXN" });
  assert.equal(s.notes, "Check-in from 14:00 to 23:00 · Check-out until 12:00");
});

test("Airbnb-style confirmation", async () => {
  const s = await stayFrom("airbnb-style.txt");
  assert.equal(s.name, "Sunny loft in Roma Norte");
  assert.equal(s.address, "Calle Colima 123, Roma Nte., Cuauhtémoc, 06700 Ciudad de México, CDMX, Mexico");
  assert.equal(s.confirmationCode, "HMXK2Q9P4T");
  assert.equal(s.checkIn, "2026-12-09T16:00");
  assert.equal(s.checkOut, "2026-12-12T11:00");
  assert.deepEqual(s.price, { amount: 412.5, currency: "USD" });
  assert.equal(s.notes, "Check-in 4:00 PM · Check-out 11:00 AM");
});

test("no check-in/out times leaves notes empty", async () => {
  const s = await stayFrom("no-times-hotel.txt");
  assert.equal(s.name, "Harbour View Hotel");
  assert.equal(s.address, "7 Hickson Road, The Rocks NSW 2000, Australia");
  assert.equal(s.confirmationCode, "HV-88213");
  assert.equal(s.checkIn, "2026-10-22T15:00");
  assert.equal(s.checkOut, "2026-10-24T11:00");
  assert.deepEqual(s.price, { amount: 1098, currency: "AUD" });
  assert.equal(s.notes, undefined);
});

test("airline email still parses flight + booking reference", async () => {
  const { items } = await parseEmail(
    "Subject: Your Singapore Airlines booking confirmation\nBooking reference: X7KQ2P\nFlight SQ 232   SYD -> SIN\nDate: 21 Oct 2026   Departs 23:55  Arrives 06:05\nSeat 42A\n",
  );
  const f = items.find((i) => i.kind === "flight");
  assert.ok(f && f.kind === "flight");
  assert.equal(f.flightNumber, "SQ232");
  assert.equal(f.confirmationCode, "X7KQ2P");
  assert.equal(f.arrivalTime, "2026-10-22T06:05");
});

test("multi-flight itinerary (Webjet-style PDF text): one item per flight with its own dates", async () => {
  const { items } = await parseEmail(fixture("webjet-style-itinerary.txt"));
  const flights = items.filter((i) => i.kind === "flight");
  assert.deepEqual(
    flights.map((f) => f.kind === "flight" && [f.flightNumber, f.airline, f.from, f.to, f.departureTime, f.arrivalTime, f.confirmationCode]),
    [
      ["AA7343", "American Airlines", "MEL", "SYD", "2026-12-09T11:00", "2026-12-09T12:25", "ABCDEF"],
      ["AA7261", "American Airlines", "SYD", "DFW", "2026-12-09T14:05", "2026-12-09T12:30", "ABCDEF"], // crosses the date line
      ["CM536", "Copa Airlines", "MEX", "PTY", "2026-12-18T03:25", "2026-12-18T08:07", "GHIJKL"],
      ["AA7386", "American Airlines", "DFW", "MEL", "2027-01-10T18:25", "2027-01-12T05:00", "ABCDEF"],
    ],
  );
  // The booking total is recorded once, on the first flight, in the stated currency.
  assert.deepEqual(flights[0].price, { amount: 1234.56, currency: "AUD" });
  assert.ok(flights.slice(1).every((f) => !f.price));
  assert.ok(flights.every((f) => f.kind === "flight" && !f.seat), "seat table rows must not be attached to a flight");
});

const americas = { id: "t", name: "Americas", destination: "Americas", startDate: "2026-12-09", endDate: "2027-01-12", purpose: "leisure", party: "solo", styles: [], createdAt: "" } as const;
const activityFrom = async (name: string) => {
  const { items } = await parseEmail(fixture(name), americas);
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity", `no activity parsed from ${name}`);
  return a;
};

test("rescheduled activity: new time slot, price, ref, links, guide", async () => {
  const a = await activityFrom("gyg-style-rescheduled.txt");
  assert.equal(a.title, "Lisbon: Pastel de Nata Baking Class");
  assert.equal(a.start, "2026-12-19T17:00"); // the "New" slot, not the old 2 Jan one or the email's sent date
  assert.equal(a.end, "2026-12-19T19:30");
  assert.ok(!a.dateEstimated);
  assert.deepEqual(a.price, { amount: 99.5, currency: "AUD" }); // not the €25 ad
  assert.equal(a.confirmationCode, "GYG11111111A");
  assert.deepEqual(a.links, [{ label: "Booking details", url: "https://www.getyourguide.com/en-au/booking/ABC123" }]);
  assert.equal(a.guide?.pin, "Ab#9xY=");
  assert.equal(a.guide?.meetingPoint, "Rua Augusta 10, Lisbon, Portugal");
  assert.equal(a.guide?.provider, "Nata Bakers · +351 21 000 0000");
  assert.deepEqual(a.guide?.whatToWear, ["Wear closed-toe shoes in the kitchen."]);
  assert.deepEqual(a.guide?.donts, ["Do not bring children under 12."]);
  assert.ok(a.guide?.itinerary?.[0].startsWith("4:45 PM"));
});

test("activity without a date: estimated from the cancellation deadline, guide sections sorted", async () => {
  const a = await activityFrom("gyg-style-no-date.txt");
  assert.equal(a.title, "From Panama City: Island Hopping Day Trip");
  assert.equal(a.start, "2026-12-18T05:00");
  assert.equal(a.end, "2026-12-18T19:00");
  assert.equal(a.dateEstimated, true);
  assert.equal(a.guide?.meetingPoint, "The Sands Apartments, Avenida Balboa, Panama City, Panama · Pickup at 5:00 AM");
  assert.deepEqual(a.guide?.whatToBring, ["Passport", "Swimwear", "Cash"]);
  assert.deepEqual(a.guide?.donts, ["Drones", "Do not touch starfish."]);
  assert.ok(a.guide?.beforeYouGo?.includes("Bring your original passport and cash for the entrance fee."));
  assert.ok(a.guide?.beforeYouGo?.includes("Provide your hotel name and a reachable WhatsApp number."));
  assert.ok(!a.guide?.whatToBring?.some((x) => x.includes("SUVs")), "'carry up to six guests' is not a packing item");
  assert.ok(a.guide?.itinerary?.some((x) => x.startsWith("The tour starts with a road transfer")));
  assert.ok(!a.guide?.itinerary?.some((x) => /for more information/i.test(x)));
});

test("HTML email: struck-through (old) time is ignored", async () => {
  const html = `<p>Subject: Booking rescheduled</p><table><tr><td>Lisbon: Pastel de Nata Baking Class</td></tr>
    <tr><td><span style="text-decoration: line-through">December 19, 2026 at 5:00 PM</span></td></tr>
    <tr><td>January 2, 2027 at 5:00 PM</td></tr><tr><td>1 Adult (Age 18 - 99) • English • 2.5 hours</td></tr>
    <tr><td>A$ 99.50</td></tr></table>`;
  const { items } = await parseEmail(html, americas);
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity");
  assert.equal(a.start, "2027-01-02T17:00");
});

test("airline e-ticket with labelled Departure/Arrival sections (Copa-style PDF)", async () => {
  const { items } = await parseEmail(fixture("copa-style-eticket.txt"));
  const flights = items.filter((i) => i.kind === "flight");
  assert.equal(flights.length, 1);
  const f = flights[0];
  assert.ok(f.kind === "flight");
  assert.deepEqual(
    [f.flightNumber, f.airline, f.from, f.to, f.departureTime, f.arrivalTime, f.confirmationCode],
    ["CM764", "Copa Airlines", "PTY", "MDE", "2026-12-21T13:23", "2026-12-21T14:45", "QWERTY"],
  );
  assert.deepEqual(f.price, { amount: 197.75, currency: "USD" });
});
