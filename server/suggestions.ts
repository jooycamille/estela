import { z } from "zod";
import { type FlightItem, type ItineraryItem, type StayItem, type Suggestion, type Trip, type TripPart, type TravelStyle } from "../shared/types.ts";
import { aiEnabled, extract } from "./ai.ts";
import { getAirport, nearestMajorAirport } from "./airports.ts";
import { assumedStops, tripPlaces } from "./tripPlaces.ts";
import { db, itemStart } from "./db.ts";

const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600_000;
const day = (t: string) => t.slice(0, 10);
const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

function eachNight(start: string, end: string) {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00Z`); d < new Date(`${end}T00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const activity = (query: string) => ({ kind: "activity" as const, query });

const STYLE_IDEAS: Record<TravelStyle, (dest: string) => Omit<Suggestion, "source" | "day">> = {
  adventure: (d) => ({ title: "Book an outdoor excursion", description: `Look for a guided hike, dive or rafting trip near ${d} — these sell out, so reserve a few days ahead.`, category: "experience", search: activity("outdoor adventure tour") }),
  culture: (d) => ({ title: "Plan a museum or heritage morning", description: `Check opening days for ${d}'s major museums — many close one weekday. Early slots avoid queues.`, category: "sightseeing", search: activity("museum tickets") }),
  food: (d) => ({ title: "Reserve a signature dinner", description: `Book a well-reviewed local restaurant in ${d} and try a market or street-food tour on a free afternoon.`, category: "food", search: activity("food tour") }),
  relaxation: () => ({ title: "Schedule a slow day", description: "Leave one day unplanned with a spa, beach or park — itineraries without downtime tend to feel rushed.", category: "wellness", search: activity("spa") }),
  nature: (d) => ({ title: "Find a nearby nature escape", description: `Pick a national park, garden or coastal walk within an hour of ${d}.`, category: "experience", search: activity("nature day trip") }),
  nightlife: (d) => ({ title: "Plan an evening out", description: `Look up live music, rooftop bars or night markets in ${d}, and save a late-night ride option.`, category: "experience", search: activity("nightlife tour") }),
  shopping: (d) => ({ title: "Map the shopping districts", description: `Note ${d}'s main markets and districts, and check tax-free shopping rules for visitors.`, category: "experience", search: activity("market tour") }),
  budget: () => ({ title: "Save on transport", description: "Buy a transit pass or stored-value card on arrival; check free walking tours and museum free-entry days.", category: "logistics", search: activity("free walking tour") }),
  luxury: () => ({ title: "Add an elevated touch", description: "Consider a private airport transfer, lounge access, or a chef's-table or private-guide experience.", category: "experience", search: activity("private tour") }),
};

// Local Christmas/New Year traditions worth knowing when you're there for them.
const HOLIDAY_NOTES: Record<string, string> = {
  CO: "In Colombia families gather for the Novena de Aguinaldos each evening from 16 to 24 Dec, Christmas Eve (Nochebuena) is the main celebration, and New Year's Eve is a big family night too. ",
  MX: "In Mexico, Las Posadas run from 16 to 24 Dec and the main Christmas meal is on Christmas Eve (Nochebuena). ",
  PA: "In Panama the main Christmas meal is on Christmas Eve, and New Year's Eve is celebrated with fireworks. ",
  PH: "In the Philippines, Noche Buena on Christmas Eve is the big family meal. ",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (cc?: string) => {
  try {
    return cc ? regionNames.of(cc) : undefined;
  } catch {
    return undefined;
  }
};

/** Without flights, the stop (from your stays or chosen city) that covers a day. */
const stopOn = (dayIso: string, trip: Trip, items: ItineraryItem[]) => {
  const stops = tripPlaces(trip, items).stops;
  return stops.find((s) => s.from <= dayIso && dayIso <= s.to) ?? stops[0];
};

/** The country you're in on a given day: where your latest flight landed, else the trip's first destination country. */
function countryOn(dayIso: string, trip: Trip, items: ItineraryItem[]) {
  const landed = items
    .filter((i): i is FlightItem => i.kind === "flight")
    .filter((f) => (f.arrivalTime ?? f.departureTime).slice(0, 10) <= dayIso)
    .sort((a, b) => (a.arrivalTime ?? a.departureTime).localeCompare(b.arrivalTime ?? b.departureTime))
    .at(-1);
  return (landed && getAirport(landed.to)?.countryCode) || stopOn(dayIso, trip, items)?.countryCode || trip.places?.[0]?.countryCode;
}

/** The city you're in on a given day: where your latest flight landed, else the trip destination. */
export function cityOn(dayIso: string, trip: Trip, items: ItineraryItem[]) {
  const landed = items
    .filter((i): i is FlightItem => i.kind === "flight")
    .filter((f) => (f.arrivalTime ?? f.departureTime).slice(0, 10) <= dayIso)
    .sort((a, b) => (a.arrivalTime ?? a.departureTime).localeCompare(b.arrivalTime ?? b.departureTime))
    .at(-1);
  return (landed && (getAirport(landed.to)?.city ?? landed.to)) || stopOn(dayIso, trip, items)?.city || trip.destination;
}

/** Where this person flies from: the first airport of their most recent other trip with flights. */
function usualAirport(trip: Trip) {
  const others = db.trips.filter((x) => x.ownerId === trip.ownerId && x.id !== trip.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
  for (const t of others) {
    const first = db.items.filter((i): i is FlightItem => i.tripId === t.id && i.kind === "flight").sort((a, b) => a.departureTime.localeCompare(b.departureTime))[0];
    if (first) return first.from;
  }
  return undefined;
}

/**
 * "Find flights to Manila (MNL)": searches on flight sites with the trip's dates. These are links only: showing live
 * fares would need a paid fare data service.
 */
function findFlights(trip: Trip, items: ItineraryItem[]): Omit<Suggestion, "source"> | undefined {
  const stop = tripPlaces(trip, items).stops[0] ?? assumedStops(trip)[0];
  const to = stop && nearestMajorAirport(stop.lat, stop.lon);
  if (!to) return undefined;
  const from = usualAirport(trip);
  const compact = (d: string) => d.slice(2).replace(/-/g, "");
  const pretty = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const q = encodeURIComponent(`Flights to ${to.iata}${from ? ` from ${from}` : ""} on ${trip.startDate} through ${trip.endDate}`);
  const links = [{ label: "Google Flights", url: `https://www.google.com/travel/flights?q=${q}` }];
  if (from) {
    links.push(
      { label: "Skyscanner", url: `https://www.skyscanner.com/transport/flights/${from.toLowerCase()}/${to.iata.toLowerCase()}/${compact(trip.startDate)}/${compact(trip.endDate)}/` },
      { label: "Kayak", url: `https://www.kayak.com/flights/${from}-${to.iata}/${trip.startDate}/${trip.endDate}` },
    );
  }
  return {
    title: `Find flights to ${to.city} (${to.iata})`,
    description: `${from ? `From ${from}, ` : ""}${pretty(trip.startDate)} to ${pretty(trip.endDate)}. These open flight sites with your dates, where you can compare prices. Once booked, add the flight and Joy keeps it up to date.`,
    category: "logistics",
    day: trip.startDate,
    links,
  };
}

/** Deterministic tips derived from the trip profile and gaps/conflicts in the itinerary. */
export function ruleSuggestions(trip: Trip, items: ItineraryItem[]): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Omit<Suggestion, "source">) => out.push({ ...s, source: "rules" });
  const sorted = [...items].sort((a, b) => itemStart(a).localeCompare(itemStart(b)));
  const flights = sorted.filter((i): i is FlightItem => i.kind === "flight");
  const stays = sorted.filter((i): i is StayItem => i.kind === "stay");

  // No flights yet: help find them.
  if (!flights.length) {
    const find = findFlights(trip, items);
    if (find) add(find);
  }

  // Itinerary checks (apply to every trip)
  const uncovered = eachNight(trip.startDate, trip.endDate).filter(
    (n) =>
      !stays.some((s) => day(s.checkIn) <= n && day(s.checkOut) > n) &&
      // In the air overnight (long-haul flights can span two nights).
      // (Nights with hosts are still flagged on purpose, so no night is ever missed.)
      !flights.some((f) => day(f.departureTime) <= n && !!f.arrivalTime && day(f.arrivalTime) > n),
  );
  if (uncovered.length > 0) {
    // Search for the first run of consecutive uncovered nights.
    let last = 0;
    while (last + 1 < uncovered.length && eachNight(uncovered[last], uncovered[last + 1]).length === 1) last++;
    const checkOut = nextDay(uncovered[last]);
    add({
      title: "Nights without accommodation",
      description: `No stay is booked for ${uncovered.join(", ")}. Add one, or ignore if you're on an overnight flight.`,
      category: "logistics",
      day: uncovered[0],
      search: { kind: "stay", checkIn: uncovered[0], checkOut },
    });
  }

  for (let i = 0; i < flights.length - 1; i++) {
    const a = flights[i], b = flights[i + 1];
    const arr = a.live?.arrivalTime ?? a.arrivalTime;
    const dep = b.live?.departureTime ?? b.departureTime;
    if (arr && a.to && a.to === b.from) {
      const gap = hours(arr, dep);
      if (gap >= 0 && gap < 1.25) {
        add({ title: `Tight connection at ${a.to}`, description: `Only ${Math.round(gap * 60)} min between ${a.flightNumber} and ${b.flightNumber}. Ask for a seat near the front and check the minimum connection time.`, category: "logistics", day: day(dep) });
      }
    }
  }

  for (const f of flights) {
    const arr = f.live?.arrivalTime ?? f.arrivalTime;
    if (!arr) continue;
    const hour = +arr.slice(11, 13);
    const stay = stays.find((s) => day(s.checkIn) === day(arr) || day(s.checkIn) === day(f.departureTime));
    if (stay && (hour >= 21 || hour < 5)) {
      add({ title: `Late arrival — tell ${stay.name}`, description: `${f.flightNumber} lands at ${arr.slice(11)}. Let the property know so your room isn't released, and pre-book a transfer.`, category: "logistics", day: day(arr) });
    }
    const next = sorted.find((i) => i.kind === "activity" && itemStart(i) > arr);
    if (next && hours(arr, itemStart(next)) < 2) {
      add({ title: "Little buffer after landing", description: `"${next.kind === "activity" ? next.title : ""}" starts less than 2 hours after ${f.flightNumber} lands. Allow for immigration, bags and transfer.`, category: "logistics", day: day(arr) });
    }
    if (f.changes.some((c) => c.field === "Status" && c.to === "cancelled")) {
      add({ title: `${f.flightNumber} was cancelled`, description: "Contact the airline for rebooking, then update this flight. Check your travel insurance for accommodation cover.", category: "safety", day: day(f.departureTime) });
    }
  }

  const busyDays = new Set(sorted.filter((i) => i.kind !== "stay").map((i) => day(itemStart(i))));
  const freeDays = eachNight(trip.startDate, trip.endDate).slice(1).filter((d) => !busyDays.has(d));

  // Purpose-specific
  if (trip.purpose === "business" || trip.purpose === "bleisure") {
    add({ title: "Book airport transfers", description: "Pre-book a car or check the airport rail link so you're not queuing for taxis before meetings.", category: "productivity", search: { kind: "transfer", query: "airport transfer" } });
    add({ title: "Keep receipts as you go", description: "Snap each receipt into your expense tool the same day; note per-diem limits for your company's policy.", category: "productivity" });
    add({ title: "Find a backup workspace", description: `Locate a lounge or coworking space near your hotel in ${trip.destination} in case hotel Wi-Fi is weak.`, category: "productivity" });
    add({ title: "Pack for meetings", description: "Business attire that travels well, universal adapter, charger and a printed agenda/addresses.", category: "packing" });
    if (flights.length > 0) {
      add({ title: "Leave a buffer before your first meeting", description: "Aim for at least 3 hours between landing and your first commitment, more after a long-haul flight.", category: "productivity", day: day(flights[0].arrivalTime ?? flights[0].departureTime) });
    }
  }
  if (trip.purpose === "bleisure") {
    add({ title: "Extend into the weekend", description: `Adding a night or two at the end can turn this into a short break in ${trip.destination} — check whether your company covers the original return fare.`, category: "experience", day: trip.endDate });
  }
  if (trip.purpose === "leisure" || trip.purpose === "bleisure") {
    for (const style of trip.styles) {
      const d = freeDays.shift();
      add({ ...STYLE_IDEAS[style](d ? cityOn(d, trip, items) : trip.destination), day: d });
    }
    if (freeDays.length > 0) {
      const city = cityOn(freeDays[0], trip, items);
      add({ title: "Consider a day trip", description: `${freeDays[0]} is open. Look for a town, coastline or park reachable within 2 hours of ${city}.`, category: "sightseeing", day: freeDays[0], search: activity("day trip") });
    }
  }

  // Who's travelling
  // Who's travelling: per part when the trip has parts (e.g. solo, then with family), else for the whole trip.
  const segments: (Partial<TripPart> & Pick<TripPart, "from" | "to" | "party">)[] = trip.parts?.length
    ? trip.parts
    : [{ from: trip.startDate, to: trip.endDate, party: trip.party }];
  for (const seg of segments) {
    const label = seg.name ? ` · ${seg.name}` : "";
    const withWhom = seg.companions ? ` with ${seg.companions.replace(/^with\s+/i, "")}` : "";
    const city = cityOn(seg.from, trip, items);
    const tip = (t: Omit<Suggestion, "source" | "day">) => add({ ...t, title: `${t.title}${label}`, day: seg.from });
    switch (seg.party) {
      case "solo":
        tip({ title: "Share your itinerary", description: "Send your flights and accommodation details to someone at home, and check in with them as you move between cities.", category: "safety" });
        tip({ title: "Meet people on a small-group tour", description: `Travelling solo in ${city}? Small-group walking or food tours are an easy way to meet other travellers.`, category: "experience", search: activity("small group tour") });
        break;
      case "couple":
        tip({ title: "Plan one special evening", description: "Book a sunset spot or a standout dinner for the middle of the trip — popular places fill up early.", category: "food", search: activity("sunset dinner cruise") });
        break;
      case "family":
        if (seg.kids === "some") {
          tip({ title: "Line up kid-friendly outings", description: `For the days the kids join${withWhom ? "" : ""}, have an easy outing or two ready in ${city} — a park, zoo or hands-on museum — and keep other days flexible for the adults.`, category: "experience", search: activity("family activities") });
        } else if (seg.kids === "all") {
          tip({ title: "Build in rest time", description: "Plan one main activity per day with downtime after lunch; check kid-friendly attractions and family-room availability.", category: "wellness", search: activity("family activities") });
        } else {
          tip({ title: "Plan a day out together", description: `Pick one outing everyone${withWhom} can enjoy in ${city} — a food tour, a day trip or a long lunch — and leave plenty of unplanned family time.`, category: "experience", search: activity("day trip") });
        }
        break;
      case "friends":
        tip({ title: "Agree a budget and a group chat", description: "Use a shared expense app and split the itinerary so everyone gets one pick.", category: "logistics" });
        break;
      case "colleagues":
        tip({ title: "Coordinate team logistics", description: "Share flight numbers with the group so pickups can be shared, and agree a team dinner ahead.", category: "productivity" });
        break;
    }
    if (seg.stayingWithHosts) {
      tip({
        title: "Bring a gift for your hosts",
        description: `Staying${withWhom || " with family or friends"}? A small gift from home goes a long way — and offer to chip in for groceries or treat everyone to a dinner out.`,
        category: "experience",
      });
    }
    // Christmas and New Year: celebrations, closures, and local traditions worth knowing.
    const holidays = ["12-24", "12-25", "12-31", "01-01"].filter((md) =>
      eachNight(seg.from, nextDay(seg.to)).some((d) => d.slice(5) === md),
    );
    if (holidays.length) {
      const cc = countryOn(seg.from, trip, items);
      const local = HOLIDAY_NOTES[cc ?? ""] ?? "";
      const family = seg.party === "family" || seg.stayingWithHosts;
      const firstHoliday = eachNight(seg.from, nextDay(seg.to)).find((d) => holidays.includes(d.slice(5)));
      add({
        title: `${holidays.some((h) => h.startsWith("12-2")) ? "Christmas" : ""}${holidays.length > 1 && holidays.some((h) => h.startsWith("12-2")) && holidays.some((h) => !h.startsWith("12-2")) ? " & " : ""}${holidays.some((h) => !h.startsWith("12-2")) ? "New Year" : ""} in ${countryName(cc) ?? city}`,
        description: `${local}Many shops, restaurants and tours close or shorten hours on 25 Dec and 1 Jan, so plan those days and book any restaurant meals early.${family ? " Pack an outfit for the family dinners on the 24th and 31st." : ""}`,
        category: "experience",
        day: firstHoliday,
      });
    }
  }

  return out;
}

const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum(["logistics", "productivity", "food", "sightseeing", "wellness", "packing", "safety", "experience"]),
      day: z.string().nullable().describe("YYYY-MM-DD within the trip, or null if not day-specific"),
      bookingSearch: z
        .object({ kind: z.enum(["activity", "stay", "transfer"]), query: z.string().describe("2–5 words to search booking sites for, without the city, e.g. 'food tour', 'cooking class'") })
        .nullable()
        .describe("If this is something to book (a tour, ticket, class, transfer or place to stay), what to search for; otherwise null"),
    }),
  ),
});

const SYSTEM = `You are a seasoned travel planner. Give specific, practical suggestions for the traveller's trip,
tailored to the trip purpose (business, leisure or bleisure), who is travelling, and their travel styles.
Use the itinerary to place suggestions on days that are free or near relevant bookings, and to flag real issues
(tight timings, late arrivals, missing transfers). Name real places, neighbourhoods and dishes at the destination
when you are confident they exist; avoid stating exact prices or opening hours you cannot verify.
For business trips focus on productivity, punctuality and low-stress logistics; for leisure focus on experiences
that match their styles. Return 6 to 10 suggestions, most useful first, each description under 45 words.`;

export async function claudeSuggestions(trip: Trip, items: ItineraryItem[]): Promise<Suggestion[] | null> {
  if (!aiEnabled()) return null;
  const itinerary = [...items]
    .sort((a, b) => itemStart(a).localeCompare(itemStart(b)))
    .map((i) => {
      if (i.kind === "flight") return `- Flight ${i.flightNumber} ${i.from}→${i.to}, departs ${i.live?.departureTime ?? i.departureTime}, arrives ${i.live?.arrivalTime ?? i.arrivalTime ?? "?"}${i.live ? ` (status: ${i.live.status})` : ""}`;
      if (i.kind === "stay") return `- Stay at ${i.name}${i.address ? `, ${i.address}` : ""}: ${i.checkIn} to ${i.checkOut}`;
      return `- Activity: ${i.title}${i.location ? ` at ${i.location}` : ""}, ${i.start}${i.end ? ` to ${i.end}` : ""}`;
    })
    .join("\n");
  const prompt = `Trip: ${trip.name}
Destination: ${trip.destination}
Dates: ${trip.startDate} to ${trip.endDate}
Purpose: ${trip.purpose}
Travelling: ${trip.parts?.length ? trip.parts.map((p) => `${p.name} (${p.from} to ${p.to}): ${p.party}${p.companions ? ` with ${p.companions}` : ""}${p.kids && p.kids !== "none" ? `, kids along ${p.kids === "some" ? "on some days" : "every day"}` : ""}${p.stayingWithHosts ? ", staying with them" : ""}`).join("; ") : trip.party}
Travel styles: ${trip.styles.join(", ") || "not specified"}
${trip.notes ? `Notes from traveller: ${trip.notes}\n` : ""}
Itinerary:
${itinerary || "(nothing booked yet)"}`;
  const result = await extract(SuggestionSchema, SYSTEM, prompt, "medium");
  return (
    result?.suggestions.map(({ bookingSearch, ...s }) => ({
      ...s,
      day: s.day ?? undefined,
      source: "claude" as const,
      search: bookingSearch ?? undefined,
    })) ?? null
  );
}
