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

test("Agoda activity (no colons, wrapped name): date, price and booking ID", async () => {
  const a = await activityFrom("agoda-activity-style.txt");
  assert.equal(a.title, "Sample City Bike Tour – Street Food and Sweets Experience");
  assert.equal(a.start, "2027-03-06T09:30");
  assert.deepEqual(a.price, { amount: 90, currency: "AUD" });
  assert.equal(a.confirmationCode, "1000000002");
});

test("message from a GetYourGuide provider: name from the caption, pickup and action needed", async () => {
  const a = await activityFrom("gyg-provider-message-style.txt");
  assert.equal(a.title, "From Sample City: Hot Air Balloon Ride and Guided Visits to the Old Ruins");
  assert.equal(a.start, "2027-03-05T04:20");
  assert.equal(a.confirmationCode, "GYGSAMPLE123");
  assert.equal(a.location, "12 Sample Street, Old Town, 10000 Sample City, Samplestan");
  assert.ok(a.guide?.beforeYouGo?.some((s) => /provide your weight/.test(s)), JSON.stringify(a.guide));
});

test("the same provider message pasted (no image captions) still finds the activity", async () => {
  const { items } = await parseEmail(fixture("gyg-provider-message-style.txt").replace(/\[image:[^\]]*\]\n?/g, ""));
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity");
  assert.equal(a.title, "From Sample City: Hot Air Balloon Ride and Guided Visits to the Old Ruins");
  assert.equal(a.start, "2027-03-05T04:20");
});


test("message from a tour operator through Viator: tour and date come from the opening sentence", async () => {
  const a = await activityFrom("viator-operator-update-style.txt");
  assert.equal(a.title, "Blue Lagoon Hot Springs & Waterfalls Small Group Tour");
  assert.equal(a.start.slice(0, 10), "2026-12-14");
  assert.match(a.guide?.meetingPoint ?? "", /^12 Sample St/);
  assert.ok(JSON.stringify(a.guide).includes("cash payments only"));
  assert.ok(JSON.stringify(a.guide).includes("carry a passport"));
});

test("operator's upsell message still finds the tour, without taking the add-on's price or a pickup", async () => {
  const a = await activityFrom("viator-operator-upsell-style.txt");
  assert.equal(a.title, "Blue Lagoon Hot Springs & Waterfalls Small Group Tour");
  assert.equal(a.start.slice(0, 10), "2026-12-14");
  assert.equal(a.price, undefined);
  assert.equal(a.guide?.meetingPoint, undefined);
});

const trip = { startDate: "2028-03-01", endDate: "2028-03-20" } as Parameters<typeof parseEmail>[1];
const receiptFrom = async (name: string) => {
  const { items } = await parseEmail(fixture(name), trip);
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity", `no activity parsed from ${name}`);
  return a;
};

test("a payment receipt alone: uses the trip date, not the payment date, and drops who's going", async () => {
  const a = await receiptFrom("receipt-trip-style.txt");
  assert.equal(a.title, "Kayak tour");
  assert.equal(a.start, "2026-12-31T09:00");
  assert.ok(!a.dateEstimated);
  assert.deepEqual(a.price, { amount: 77.71, currency: "AUD" });
  assert.equal(a.confirmationCode, undefined); // a receipt number isn't a booking reference
  assert.match(a.notes ?? "", /999999999999999000111/);
  assert.equal(a.guide?.provider, "Sample Bay Tours");
});

test("a pasted receipt, without the email's own headers, still comes through", async () => {
  const pasted = fixture("receipt-trip-style.txt").split("\n").slice(3).join("\n");
  const { items } = await parseEmail(pasted, trip);
  const a = items[0];
  assert.ok(a?.kind === "activity");
  assert.equal(a.title, "Kayak tour");
  assert.equal(a.start, "2026-12-31T09:00");
});

test("a receipt with only a payment date is still shown, with its date flagged as a guess", async () => {
  const a = await receiptFrom("receipt-no-activity-date-style.txt");
  assert.equal(a.title, "Blue Lagoon Snorkel Adventure");
  assert.equal(a.start, "2028-03-01T09:00");
  assert.equal(a.dateEstimated, true);
  assert.deepEqual(a.price, { amount: 120, currency: "USD" });
});

test("an invoice: ignores invoice and due dates, reads the service date, reference and total", async () => {
  const a = await receiptFrom("invoice-labelled-style.txt");
  assert.equal(a.title, "Sunset Sailing Cruise");
  assert.equal(a.start, "2028-03-14T17:30");
  assert.equal(a.confirmationCode, "SB48213");
  assert.deepEqual(a.price, { amount: 90, currency: "EUR" });
});

test("an invoice that doesn't say what it's for still shows who it's from", async () => {
  const { items } = await parseEmail("Subject: Your receipt from Sample Bay Tours\n\nReceipt\nAmount paid $40.00\nDate paid Sep 11, 2026", trip);
  assert.equal(items[0]?.kind === "activity" && items[0].title, "Sample Bay Tours");
});

test("receipts for flights, and unrelated emails, don't become activities", async () => {
  assert.equal((await parseEmail("Subject: Electronic ticket receipt - Sample Air\n\nAmount paid $400.00", trip)).items.length, 0);
  assert.equal((await parseEmail("Subject: Hello\n\nJust saying hi, see you soon.", trip)).items.length, 0);
});

test("a concert ticket: name, time, venue, seat, order number and total", async () => {
  const { items } = await parseEmail(fixture("event-ticket-style.txt"), trip);
  assert.equal(items.length, 1);
  const a = items[0];
  assert.ok(a.kind === "activity");
  assert.equal(a.title, "SAMPLE BAND - THE SAMPLE TOUR");
  assert.equal(a.start, "2028-03-11T21:00");
  assert.equal(a.location, "Sample Stadium, Sample City");
  assert.equal(a.category, "concert");
  assert.equal(a.confirmationCode, "12-34567/XYZ");
  assert.deepEqual(a.price, { amount: 3507, currency: "MXN" });
  assert.equal(a.notes, "Section BLUE29 · Row 2 · Seat 13");
  assert.ok(a.links?.some((l) => l.label === "Ticket"));
  assert.match(JSON.stringify(a.guide?.beforeYouGo), /won't get you in/);
});

test("the same ticket pasted, and other events' layouts", async () => {
  const pasted = fixture("event-ticket-style.txt").split("\n").slice(9).join("\n");
  const { items } = await parseEmail(pasted, trip);
  assert.equal(items[0]?.kind === "activity" && items[0].start, "2028-03-11T21:00");
  const game = (await parseEmail("Subject: Your tickets\n\nSample FC vs Example United\nMar 12, 2028 at 7:30 PM\nSample Arena\n2 tickets", trip)).items[0];
  assert.ok(game?.kind === "activity");
  assert.equal(game.category, "match");
  assert.equal(game.start, "2028-03-12T19:30");
});

test("what's included and not, from headed lists and from sentences", async () => {
  const { items } = await parseEmail(fixture("tour-included-style.txt"), trip);
  const a = items[0];
  assert.ok(a?.kind === "activity");
  assert.deepEqual(a.guide?.included?.slice(0, 3), ["Hotel pickup", "Snorkel gear", "Lunch"]);
  assert.ok(a.guide?.included?.includes("Shared pickup is included from downtown hotels."));
  assert.deepEqual(a.guide?.notIncluded?.slice(0, 2), ["Tips", "National park fee"]);
  assert.ok(a.guide?.notIncluded?.includes("Pickup from the airport is available for an additional charge."));
  assert.ok(!JSON.stringify(a.guide?.included).includes("Is lunch included")); // a question isn't a promise
  const sentence = await parseEmail(fixture("tour-included-style.txt").replace("Shared pickup is included from downtown hotels.", "Pick up and drop off included from all downtown hotels."), trip);
  assert.ok(sentence.items[0]?.kind === "activity" && sentence.items[0].guide?.included?.includes("Pick up and drop off included from all downtown hotels."));
  assert.ok(a.guide?.whatToBring?.some((x) => /sunscreen/.test(x)));
  assert.match(a.guide?.cancellation ?? "", /full refund/);
});

test("an activity email whose \"When:\" line isn't a date still imports (it used to fail the whole email)", async () => {
  const email = `Subject: Your booking is confirmed
From: bookings@example.test

Madeup Sunrise Kayak Tour
1 Adult (Age 18 - 99) • English • 3 hours
When: meet at the pier 15 minutes early
Tour date: March 5, 2028 at 6:00 AM
Booking reference: MADEUP123`;
  const { items } = await parseEmail(email, trip);
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity", "the activity is found");
  assert.match(a.title, /Kayak/);
  assert.equal(a.start, "2028-03-05T06:00"); // from the "Tour date:" line, not the "When:" one
});

test("GetYourGuide's newer layout: the date above the activity name, the reference on the line under its label", async () => {
  const { items } = await parseEmail(fixture("gyg-date-above-title.txt"), { name: "Madeup", destination: "Madeuptown", startDate: "2028-03-10", endDate: "2028-03-20" } as Parameters<typeof parseEmail>[1]);
  const a = items.find((i) => i.kind === "activity");
  assert.ok(a && a.kind === "activity");
  assert.equal(a.title, "Madeuptown: Sunrise Canyon Kayak with Breakfast");
  assert.equal(a.start, "2028-03-12T05:30");
  assert.equal(a.end, "2028-03-12T09:30"); // 4 hours
  assert.equal(a.confirmationCode, "GYGMADEUPABCD");
  assert.deepEqual(a.price, { amount: 250, currency: "AUD" });
});
