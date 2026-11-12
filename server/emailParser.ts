import { z } from "zod";
import type { ActivityGuide, DraftItem, EmailParseResult, Trip } from "../shared/types.ts";
import { aiEnabled, extract } from "./ai.ts";
import { parseActivity } from "./activityHeuristics.ts";
import { parseTransfer } from "./transferHeuristics.ts";
import { parseEventTicket } from "./eventHeuristics.ts";
import { findBaggage, findConfirmation, findTotalPrice, parseFlights, parseStay } from "./emailHeuristics.ts";
import { findLinks } from "./emailLinks.ts";

// Flat schema keeps structured output simple; mapped to typed drafts below.
const ExtractedSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["flight", "stay", "activity"]),
      confirmationCode: z.string().nullable().describe("Booking/confirmation number or code as printed, e.g. 1234567890 or X7KQ2P"),
      flightNumber: z.string().nullable().describe("Airline IATA code + number, no spaces, e.g. QF1"),
      airline: z.string().nullable(),
      from: z.string().nullable().describe("Departure airport IATA code"),
      to: z.string().nullable().describe("Arrival airport IATA code"),
      seat: z.string().nullable(),
      baggageCabin: z.string().nullable().describe("Flights: cabin/carry-on allowance for this flight as stated, short, e.g. '1 × 10 kg', 'Personal item only'"),
      baggageChecked: z.string().nullable().describe("Flights: checked baggage allowance for this flight as stated, short, e.g. '1 × 23 kg', '2 pieces', 'None'"),
      name: z.string().nullable().describe("Property name (e.g. 'Hotel Santa Lucía'), never the email subject or booking site; or the activity title"),
      address: z.string().nullable().describe("Full street address as printed in the email"),
      start: z.string().nullable().describe("Local time YYYY-MM-DDTHH:mm: departure, check-in or activity start"),
      end: z.string().nullable().describe("Local time YYYY-MM-DDTHH:mm: arrival, check-out or activity end"),
      category: z.string().nullable(),
      dateEstimated: z.boolean().describe("True if the email doesn't state the activity date/time and you inferred it"),
      guide: z
        .object({
          itinerary: z.array(z.string()).nullable().describe("What happens during the activity, in order (pickup, stops, meals, return)"),
          whatToBring: z.array(z.string()).nullable(),
          whatToWear: z.array(z.string()).nullable(),
          dos: z.array(z.string()).nullable(),
          donts: z.array(z.string()).nullable().describe("Don'ts and items/behaviour not allowed"),
          beforeYouGo: z.array(z.string()).nullable().describe("Things to do before the day: pay fees in cash, confirm pickup, send details, download tickets"),
          goodToKnow: z.array(z.string()).nullable(),
          included: z.array(z.string()).nullable().describe("What the price covers, as stated: lunch, pickup, entry fees"),
          notIncluded: z.array(z.string()).nullable().describe("What isn't covered, as stated: tips, entry fees, optional extras"),
          meetingPoint: z.string().nullable().describe("Meeting point or pickup location and time"),
          endPoint: z.string().nullable(),
          cancellation: z.string().nullable(),
          provider: z.string().nullable().describe("Operator name and phone"),
          pin: z.string().nullable(),
        })
        .nullable()
        .describe("Activities only: practical information from the email, as short bullet points"),
      priceAmount: z.number().nullable().describe("Total price paid or payable for this booking, including taxes and fees"),
      priceCurrency: z.string().nullable().describe("ISO 4217 code for priceAmount, e.g. USD"),
      notes: z
        .string()
        .nullable()
        .describe("Stays: check-in and check-out times as stated, e.g. 'Check-in after 3:00 pm · Check-out before 1:00 pm'. Flights: only a note that the price covers the whole booking. Otherwise null."),
    }),
  ),
  warnings: z.array(z.string()),
});

const SYSTEM = `You extract travel bookings from confirmation emails.
Return one item per flight segment, per accommodation booking, and per booked activity/tour/restaurant/event.
For each flight, give the baggage allowance the email states (cabin and checked), short and as written; null when it doesn't say. Never guess it from the airline or fare name.
Tickets to a concert, show or game are activities: the event's name as the title, its date and start time, and the venue as the address.
An invoice or payment receipt counts as a booking even when it's all there is: use the date of the activity itself, never the
invoice, due or payment date; if the activity's date isn't stated, set dateEstimated to true and use the trip's first day.
Use the local time printed in the email for each place; never convert time zones.
If the year is missing, infer it from the trip dates provided. If a check-in or check-out time is missing, use 15:00 and 11:00
in start/end, and leave notes null. Ignore prices of advertised extras; price is the total for the booking itself.
Booking details are often only in attached itineraries or e-tickets, included below as "=== Attachment: … ===" text.
For multi-flight bookings return every segment separately, each with its own departure and arrival date and time.
If one price covers several flights, put it on the earliest flight only and set that flight's notes to say so.
For tours and activities: fill guide with short, practical bullet points taken from the email (including any FAQ),
sorted into the right sections; skip marketing and "you might also like" suggestions. In "rescheduled" emails use the
new time slot, never the old one. If no activity date is given, infer it from the free-cancellation deadline
(usually 24 hours before the start) and set dateEstimated to true.
Leave a field null rather than guessing. Ignore marketing content, upsells and loyalty-program noise.
Add a short warning for anything ambiguous (for example a date you had to infer).`;

export async function parseEmail(email: string, trip?: Trip): Promise<EmailParseResult> {
  const text = stripEmail(email);
  // Rides have a set layout, and shouldn't be mistaken for the flight they mention.
  const ride = attempt("a ride", () => parseTransfer(text, trip ? +trip.startDate.slice(0, 4) : new Date().getFullYear()));
  if (ride) return withLinks({ items: [{ kind: "activity", source: "email", ...ride }], parser: "heuristic", warnings: [] }, email);
  if (aiEnabled()) {
    try {
      const context = trip
        ? `Trip: ${trip.name}, destination ${trip.destination}, ${trip.startDate} to ${trip.endDate}.`
        : "No trip context.";
      const result = await extract(ExtractedSchema, SYSTEM, `${context}\n\n<email>\n${text}\n</email>`);
      if (result) {
        return withLinks({ items: result.items.flatMap(toDraft), parser: "claude", warnings: result.warnings }, email);
      }
    } catch (err) {
      console.warn("Claude email parse failed, using heuristic parser:", (err as Error).message);
    }
  }
  return withLinks(heuristicParse(text, email, trip), email);
}

/** Booking/ticket links come from the raw email (they're stripped from the text the parsers read). */
function withLinks(result: EmailParseResult, raw: string): EmailParseResult {
  const links = findLinks(raw);
  if (links.length) for (const item of result.items) item.links ??= links;
  return result;
}

type Extracted = z.infer<typeof ExtractedSchema>["items"][number];

function toDraft(x: Extracted): DraftItem[] {
  const base = {
    source: "email" as const,
    confirmationCode: x.confirmationCode ?? undefined,
    price: x.priceAmount && x.priceCurrency ? { amount: x.priceAmount, currency: x.priceCurrency.toUpperCase() } : undefined,
    notes: x.notes ?? undefined,
  };
  if (x.kind === "flight") {
    if (!x.flightNumber || !x.start) return [];
    return [
      {
        ...base,
        kind: "flight",
        flightNumber: normaliseFlightNumber(x.flightNumber),
        airline: x.airline ?? undefined,
        from: x.from ?? "",
        to: x.to ?? "",
        departureTime: x.start,
        arrivalTime: x.end ?? undefined,
        seat: x.seat ?? undefined,
        baggage: x.baggageCabin || x.baggageChecked ? { cabin: x.baggageCabin ?? undefined, checked: x.baggageChecked ?? undefined } : undefined,
      },
    ];
  }
  if (x.kind === "stay") {
    if (!x.name || !x.start || !x.end) return [];
    return [{ ...base, kind: "stay", name: x.name, address: x.address ?? undefined, checkIn: x.start, checkOut: x.end }];
  }
  if (!x.name || !x.start) return [];
  const guide = x.guide
    ? (Object.fromEntries(Object.entries(x.guide).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0))) as ActivityGuide)
    : undefined;
  return [
    {
      ...base,
      kind: "activity",
      title: x.name,
      location: x.address ?? undefined,
      start: x.start,
      end: x.end ?? undefined,
      category: x.category ?? undefined,
      guide: guide && Object.keys(guide).length ? guide : undefined,
      dateEstimated: x.dateEstimated || undefined,
    },
  ];
}

export function normaliseFlightNumber(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Drop struck-through text (e.g. the old time slot in a "rescheduled" email) — it no longer applies. */
export function removeStruckText(html: string) {
  return html
    .replace(/<(s|del|strike)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(\w+)\b[^>]*text-decoration\s*:\s*line-through[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/** Pulls the readable body out of a raw .eml (or returns pasted text unchanged). */
function stripEmail(raw: string) {
  let text = raw;
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (/^(Received|From|Subject|MIME-Version|Delivered-To):/im.test(raw.slice(0, 2000)) && headerEnd > 0) {
    const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1] ?? "";
    text = `Subject: ${subject}\n${raw.slice(headerEnd)}`;
    if (/^Content-Transfer-Encoding:\s*quoted-printable/im.test(raw)) {
      text = text.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
  }
  return removeStruckText(text)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/tr|\/td|\/th|\/li|\/h[1-6]|\/table|\/ul|\/ol|\/section|\/a)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .slice(0, 100_000);
}

// ---------- Heuristic fallback (no API key) ----------

/**
 * Runs one of the readers (flights, stays, activities…). If it stumbles on an unusual email, the others still get their
 * turn, rather than the whole email failing.
 */
function attempt<T>(what: string, read: () => T): T | undefined {
  try {
    return read();
  } catch (err) {
    console.warn(`Reading ${what} from an email failed:`, (err as Error).message);
    return undefined;
  }
}

function heuristicParse(text: string, raw: string, trip?: Trip): EmailParseResult {
  const year = trip ? +trip.startDate.slice(0, 4) : new Date().getFullYear();
  const confirmation = findConfirmation(text);
  const price = findTotalPrice(text);
  const items: DraftItem[] = [];
  const warnings = ["Parsed without AI — please double-check each field. Set ANTHROPIC_API_KEY for better results."];

  // Flights: one item per segment (flight number + departure + arrival).
  const flights = attempt("flights", () => parseFlights(text, year)) ?? [];
  // One allowance stated for the whole booking applies to each of its flights.
  const baggage = flights.length ? attempt("baggage", () => findBaggage(text)) : undefined;
  for (const f of flights) {
    items.push({ kind: "flight", source: "email", ...f, ...(baggage && { baggage }) });
  }

  // Stays
  const stay = attempt("a stay", () => parseStay(text, raw, year));
  if (stay) {
    items.push({
      kind: "stay",
      source: "email",
      name: stay.name ?? "Accommodation",
      address: stay.address,
      checkIn: `${stay.checkInDate}T${stay.checkInTime ?? "15:00"}`,
      checkOut: `${stay.checkOutDate}T${stay.checkOutTime ?? "11:00"}`,
      confirmationCode: confirmation,
      price,
      notes: stay.notes,
    });
    if (!stay.name) warnings.push("Couldn't find the property name — please fill it in.");
  }

  // Tours and activities (only when the email isn't a flight or hotel booking)
  if (items.length === 0) {
    const a = attempt("an event ticket", () => parseEventTicket(text, year)) ?? attempt("an activity", () => parseActivity(text, year, trip));
    if (a) {
      items.push({ kind: "activity", source: "email", ...a });
      if (a.dateEstimated) warnings.push(`"${a.title}": the email doesn't give the date, so it was estimated from the cancellation deadline — please confirm it.`);
    }
  }

  // A flight booking's total covers all its segments: record it once, on the first flight, so trip totals stay right.
  const flightItems = items.filter((i) => i.kind === "flight");
  if (!stay && flightItems.length > 0 && price) {
    flightItems[0].price = price;
    if (flightItems.length > 1) flightItems[0].notes = `Price is the total for the whole booking (${flightItems.length} flights)`;
  }

  if (items.length === 0) {
    warnings.push(
      /attached|attachment|e-?ticket|itinerary/i.test(text)
        ? "No bookings found in the email text. If the details are in an attached PDF, make sure the attachment was forwarded too, or upload the PDF."
        : "No flights or stays recognised. You can add them manually.",
    );
  }
  return { items, parser: "heuristic", warnings };
}
