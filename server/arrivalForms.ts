import type { FlightItem, Link } from "../shared/types.ts";
import { getAirport } from "./airports.ts";

// Immigration and customs forms for each border you cross by air. Only rules that are stable and widely documented
// are stated; anything that varies (or changes often) says so and points to the official site. Countries without a
// rule get a "check" item, so nothing is silently skipped.

export interface BorderForm {
  country: string; // ISO code of the country being entered (or left)
  direction: "arrive" | "leave";
  flight: FlightItem; // the flight that crosses the border
  text: string;
  detail: string;
  due?: string; // YYYY-MM-DDTHH:mm — when to have it done by
  when: "online" | "plane" | "arrival" | "check"; // online beforehand, on the plane, at the airport, or look it up
  links?: Link[];
  remind?: { wall: string; label: string }[]; // reminders, in the departure airport's local time
}

type Rule = (f: FlightItem, ctx: { home?: string; returningHome: boolean; transit: boolean }) => Omit<BorderForm, "country" | "direction" | "flight"> | null;

const minusHours = (t: string, h: number) => {
  const d = new Date(`${t.slice(0, 16)}:00Z`);
  d.setUTCHours(d.getUTCHours() - h);
  return d.toISOString().slice(0, 16);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (t: string) => `${+t.slice(8, 10)} ${MONTHS[+t.slice(5, 7) - 1]}`;
const leg = (f: FlightItem) => `${f.flightNumber} ${f.from}→${f.to}, ${day(f.departureTime)}`;

// No reminders in the middle of the night (local time): "it's open" waits until 8 am; a last call comes the evening
// before at 8 pm instead. Both stay inside the form's window.
const hourOf = (wall: string) => +wall.slice(11, 13);
const atHour = (wall: string, dayShift: number, hour: number) => {
  const d = new Date(`${wall.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayShift);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
};
export const laterIfNight = (wall: string) => (hourOf(wall) >= 22 ? atHour(wall, 1, 8) : hourOf(wall) < 7 ? atHour(wall, 0, 8) : wall.slice(0, 16));
export const earlierIfNight = (wall: string) => (hourOf(wall) >= 22 ? atHour(wall, 0, 20) : hourOf(wall) < 7 ? atHour(wall, -1, 20) : wall.slice(0, 16));

/** Check-MIG opens 72 hours before the flight and closes 1 hour before: a reminder at each end. */
const checkMigReminders = (f: FlightItem) => [
  { wall: laterIfNight(minusHours(f.departureTime, 72)), label: `Check-MIG is open: fill it in for ${f.flightNumber} (${f.from}→${f.to})` },
  { wall: earlierIfNight(minusHours(f.departureTime, 6)), label: `Last call: Check-MIG for ${f.flightNumber} closes 1 hour before departure` },
];

const ARRIVE: Record<string, Rule> = {
  CO: (f) => ({
    when: "online",
    text: `Colombia: fill in Check-MIG before ${f.flightNumber}`,
    detail: `Colombia's free online migration form, required for visitors arriving by air. Complete it between 72 and 1 hour before your flight (${leg(f)}), and keep the confirmation email. Customs: you only declare on arrival if you're carrying more than USD 10,000 in cash or goods over the allowance. Only use the official Migración Colombia site; other sites charge for the free form.`,
    due: minusHours(f.departureTime, 1),
    remind: checkMigReminders(f),
    links: [{ label: "Check-MIG (Migración Colombia)", url: "https://apps.migracioncolombia.gov.co/pre-registro/" }],
  }),
  MX: (f) => ({
    when: "plane",
    text: `Mexico: arrival on ${f.flightNumber}`,
    detail: `No online form to do beforehand for most tourists flying in. Immigration stamps your passport and writes how many days you can stay, so check the number before leaving the desk and keep any slip they give you until you leave Mexico. Customs: you may be handed a customs declaration on the plane (one per family). Fill it in before landing, and declare cash over USD 10,000 (${leg(f)}).`,
    links: [{ label: "Mexico immigration (INM)", url: "https://www.gob.mx/inm" }],
  }),
  PA: (f) => ({
    when: "arrival",
    text: `Panama: customs declaration for ${f.flightNumber}`,
    detail: `No immigration form to fill in beforehand for most tourists, but immigration may ask to see your onward ticket (your flight out of Panama) and proof of funds. Customs: Panama uses a sworn customs declaration. Check the National Customs Authority's site for the current form (online or paper on arrival), and declare cash over USD 10,000 (${leg(f)}).`,
    links: [{ label: "Panama customs (ANA)", url: "https://www.ana.gob.pa/" }],
  }),
  US: (f, { transit }) => ({
    when: "arrival",
    text: `United States: immigration and customs at ${f.to}${transit ? " (even though you're connecting)" : ""}`,
    detail: `${transit ? "There's no airside transit in the US: you clear immigration and customs at the first US airport, collect and re-drop checked bags, and go through security again. Leave enough time for your connection. " : ""}Have your ESTA or visa approved before flying (${leg(f)}). Customs is usually done at the arrival kiosk or with the officer, though some airlines still hand out the paper customs form. Declare food and cash over USD 10,000.`,
    links: [
      { label: "CBP: arriving in the US", url: "https://www.cbp.gov/travel/international-visitors" },
      { label: "Mobile Passport Control", url: "https://www.cbp.gov/travel/us-citizens/mobile-passport-control" },
    ],
  }),
  CA: (f) => ({
    when: "arrival",
    text: `Canada: arrival declaration for ${f.flightNumber}`,
    detail: `You can make your customs declaration in advance with Advance Declaration (in ArriveCAN or the CBSA website) to speed up the kiosk at major airports, or at the kiosk on arrival (${leg(f)}).`,
    links: [{ label: "CBSA: travellers", url: "https://www.cbsa-asfc.gc.ca/travel-voyage/menu-eng.html" }],
  }),
  SG: (f) => ({
    when: "online",
    text: `Singapore: SG Arrival Card before ${f.flightNumber}`,
    detail: `Submit the free SG Arrival Card (with health declaration) online within 3 days before you arrive (${leg(f)}). Only use the official ICA site or the MyICA app.`,
    due: minusHours(f.departureTime, 1),
    remind: [{ wall: laterIfNight(minusHours(f.departureTime, 48)), label: `Time to do your SG Arrival Card for ${f.flightNumber}` }],
    links: [{ label: "SG Arrival Card (ICA)", url: "https://eservices.ica.gov.sg/sgarrivalcard/" }],
  }),
  TH: (f) => ({
    when: "online",
    text: `Thailand: Digital Arrival Card before ${f.flightNumber}`,
    detail: `Thailand's TDAC replaced the paper arrival card. Submit it online, free, within 3 days before you arrive (${leg(f)}).`,
    due: minusHours(f.departureTime, 1),
    remind: [{ wall: laterIfNight(minusHours(f.departureTime, 48)), label: `Time to do your Thailand Digital Arrival Card for ${f.flightNumber}` }],
    links: [{ label: "Thailand Digital Arrival Card", url: "https://tdac.immigration.go.th/" }],
  }),
  PH: (f) => ({
    when: "online",
    text: `Philippines: eTravel registration before ${f.flightNumber}`,
    detail: `Register on the free eTravel system within 72 hours before arrival and show the QR code at immigration (${leg(f)}).`,
    due: minusHours(f.departureTime, 1),
    remind: [{ wall: laterIfNight(minusHours(f.departureTime, 48)), label: `Time to do your eTravel registration for ${f.flightNumber}` }],
    links: [{ label: "eTravel (official)", url: "https://etravel.gov.ph/" }],
  }),
  JP: (f) => ({
    when: "online",
    text: `Japan: Visit Japan Web (optional) for ${f.flightNumber}`,
    detail: `Register immigration and customs details on Visit Japan Web before you fly to get QR codes that speed up arrival. It's optional; otherwise fill in the paper forms (${leg(f)}).`,
    links: [{ label: "Visit Japan Web", url: "https://services.digital.go.jp/en/visit-japan-web/" }],
  }),
  NZ: (f) => ({
    when: "online",
    text: `New Zealand: Traveller Declaration for ${f.flightNumber}`,
    detail: `Complete the free New Zealand Traveller Declaration online, from 24 hours before your flight, or the paper version. Declare food and outdoor gear: biosecurity is strict (${leg(f)}).`,
    due: minusHours(f.departureTime, 1),
    remind: [{ wall: laterIfNight(minusHours(f.departureTime, 24)), label: `Your NZ Traveller Declaration is open for ${f.flightNumber}` }],
    links: [{ label: "NZ Traveller Declaration", url: "https://www.travellerdeclaration.govt.nz/" }],
  }),
  AU: (f) => ({
    when: "plane",
    text: `Australia: Incoming Passenger Card on ${f.flightNumber}`,
    detail: `Everyone arriving in Australia fills in the Incoming Passenger Card, which is usually handed out on the plane. Declare food, plant and animal products (including snacks and souvenirs bought on the trip) and cash of AUD 10,000 or more. If unsure, declare it (${leg(f)}).`,
    links: [
      { label: "ABF: Incoming Passenger Card", url: "https://www.abf.gov.au/entering-and-leaving-australia/crossing-the-border/at-the-border/incoming-passenger-card-(ipc)" },
      { label: "What you can bring in", url: "https://www.abf.gov.au/entering-and-leaving-australia/can-you-bring-it-in" }],
  }),
};

const LEAVE: Record<string, Rule> = {
  CO: (f) => ({
    when: "online",
    text: `Colombia: fill in Check-MIG again before leaving (${f.flightNumber})`,
    detail: `Check-MIG is also required when you leave Colombia. Complete it between 72 and 1 hour before your flight out (${leg(f)}). It's free on the official site.`,
    due: minusHours(f.departureTime, 1),
    remind: checkMigReminders(f),
    links: [{ label: "Check-MIG (Migración Colombia)", url: "https://apps.migracioncolombia.gov.co/pre-registro/" }],
  }),
};

/**
 * Every border crossed by air, in order: arrivals in a new country (including US connections, where you clear
 * immigration even in transit) and departures that need a form. Flights within one country cross nothing.
 */
export function borderForms(
  flights: FlightItem[],
  home: string | undefined,
  countryName: (code: string) => string,
  isTransit: (f: FlightItem) => boolean,
): BorderForm[] {
  const out: BorderForm[] = [];
  const sorted = [...flights].sort((a, b) => a.departureTime.localeCompare(b.departureTime));
  for (const f of sorted) {
    const from = getAirport(f.from)?.countryCode, to = getAirport(f.to)?.countryCode;
    if (!from || !to || from === to) continue;
    const leave = LEAVE[from]?.(f, { home, returningHome: to === home, transit: false });
    if (leave && from !== home) out.push({ country: from, direction: "leave", flight: f, ...leave });
    // Connecting airside elsewhere crosses no border; the US has no airside transit, so it always counts.
    if (isTransit(f) && to !== "US") continue;
    const rule = ARRIVE[to];
    if (to === home && !rule) continue;
    const ctx = { home, returningHome: to === home, transit: isTransit(f) };
    const form = rule?.(f, ctx) ?? {
      when: "check" as const,
      text: `${countryName(to)}: check for arrival or customs forms (${f.flightNumber})`,
      detail: `Some countries need an online arrival card or customs declaration before you land. Check ${countryName(to)}'s official immigration site or the IATA Travel Centre for your passport (${leg(f)}).`,
      links: [{ label: "IATA Travel Centre", url: "https://www.iatatravelcentre.com/" }],
    };
    out.push({ country: to, direction: "arrive", flight: f, ...form });
  }
  return out;
}
