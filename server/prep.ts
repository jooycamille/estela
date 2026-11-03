import type { ActivityItem, FlightItem, ItineraryItem, Link, PrepItem, Trip } from "../shared/types.ts";
import { borderForms, laterIfNight } from "./arrivalForms.ts";
import { airportTimeZone, wallTimeToUtc } from "./time.ts";
import type { StopWeather } from "./weather.ts";
import type { tripPlaces } from "./tripPlaces.ts";

// Builds the "before you go" to-do list and the packing list for a trip, from its bookings, stops and weather.
// Rules are deliberately cautious about entry requirements: they point to official sources rather than state rules
// that depend on nationality.

type Places = ReturnType<typeof tripPlaces>;

// Plug types (IEC letters) for common destinations; travellers need an adapter when none of home's types match.
const PLUGS: Record<string, string[]> = {
  AU: ["I"], NZ: ["I"], FJ: ["I"], CN: ["A", "C", "I"], AR: ["C", "I"],
  US: ["A", "B"], CA: ["A", "B"], MX: ["A", "B"], PA: ["A", "B"], CO: ["A", "B"], CR: ["A", "B"], EC: ["A", "B"], GT: ["A", "B"],
  DO: ["A", "B"], JM: ["A", "B"], PR: ["A", "B"], JP: ["A", "B"], TW: ["A", "B"], PH: ["A", "B", "C"], TH: ["A", "B", "C", "O"],
  VN: ["A", "C"], PE: ["A", "C"], BR: ["C", "N"], CL: ["C", "L"], BO: ["A", "C"], UY: ["C", "F", "L"],
  GB: ["G"], IE: ["G"], MT: ["G"], CY: ["G"], SG: ["G"], MY: ["G"], HK: ["G"], AE: ["G"], QA: ["G"], SA: ["G"],
  IN: ["C", "D", "M"], ZA: ["C", "M", "N"], ID: ["C", "F"], KR: ["C", "F"], IL: ["C", "H"],
  FR: ["C", "E"], BE: ["C", "E"], CH: ["C", "J"], IT: ["C", "F", "L"], DK: ["C", "F", "K"],
};
for (const c of "DE ES PT NL AT SE NO FI GR HR CZ PL HU RO BG TR IS".split(" ")) PLUGS[c] = ["C", "F"];

const CURRENCY: Record<string, string> = {
  AU: "AUD", NZ: "NZD", US: "USD", CA: "CAD", MX: "MXN", PA: "USD (Panama uses US dollars)", CO: "COP", CR: "CRC", PE: "PEN",
  EC: "USD (Ecuador uses US dollars)", CL: "CLP", AR: "ARS", BR: "BRL", GB: "GBP", JP: "JPY", SG: "SGD", TH: "THB",
  ID: "IDR", MY: "MYR", PH: "PHP", VN: "VND", IN: "INR", AE: "AED", CH: "CHF", CN: "CNY", HK: "HKD", KR: "KRW", ZA: "ZAR",
};
for (const c of "DE FR ES PT IT NL BE AT IE FI GR HR".split(" ")) CURRENCY[c] = "EUR";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-12-09" → "9 Dec 2026" (or "9 Dec" without the year). */
const fmt = (date: string, year = true) => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ""}`;
};

// Activities that travel insurance often excludes unless covered, as readable names.
const ACTIVITY_RISKS: [RegExp, string][] = [
  [/snorkel/i, "snorkelling"], [/\bdiv(?:e|ing)\b|scuba/i, "diving"], [/hik|trek|waterfall|jungle walk/i, "hiking"],
  [/\bboat|catamaran|kayak|canoe|island hopping/i, "boat trips"], [/surf/i, "surfing"], [/rafting/i, "rafting"],
  [/zip-?line/i, "ziplining"], [/\b(?:e-)?bik(?:e|ing)\b|cycling/i, "cycling"], [/\bski/i, "skiing"], [/volcano/i, "volcano hikes"],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const minusHours = (t: string, h: number) => {
  const d = new Date(`${t.slice(0, 16)}:00Z`);
  d.setUTCHours(d.getUTCHours() - h);
  return d.toISOString().slice(0, 16);
};
const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** Reminder times (departure airport's local time) as real moments, for push notifications. */
function reminders(fromAirport: string, list?: { wall: string; label: string }[]) {
  const tz = airportTimeZone(fromAirport);
  if (!list?.length || !tz) return undefined;
  return list.map((r) => ({ at: wallTimeToUtc(r.wall, tz), label: r.label }));
}

export function buildPrep(
  trip: Trip,
  items: ItineraryItem[],
  places: Places,
  weather: StopWeather[],
  homeCountry: string | undefined,
  countryName: (code: string) => string,
): { todo: PrepItem[]; packing: PrepItem[] } {
  const todo: PrepItem[] = [];
  const packing: PrepItem[] = [];
  const add = (target: PrepItem[], item: Omit<PrepItem, "id">, key = item.text) => {
    const id = `${item.group}:${slug(key)}`;
    if (!target.some((x) => x.id === id)) target.push({ ...item, id });
  };
  const todoItem = (item: Omit<PrepItem, "id" | "section">, key?: string) => add(todo, { ...item, section: "todo" }, key);
  const pack = (group: string, text: string, detail?: string) => add(packing, { section: "packing", group, text, detail }, text);

  const activities = items.filter((i): i is ActivityItem => i.kind === "activity");
  const flights = items.filter((i): i is FlightItem => i.kind === "flight");
  const home = homeCountry ?? places.homeCountry;
  const foreign = places.countries.filter((c) => c !== home);
  const visitNames = foreign.map(countryName);
  const isAU = home === "AU";
  const first = flights[0];

  // ---------- Before you go ----------
  const activityText = activities.map((a) => `${a.title} ${a.category ?? ""} ${JSON.stringify(a.guide ?? {})}`).join(" ");
  const risky = ACTIVITY_RISKS.filter(([re]) => re.test(activityText)).map(([, name]) => name);
  const booked = items.reduce((n, i) => n + (i.price ? 1 : 0), 0);
  todoItem({
    group: "Do soon",
    text: "Get travel insurance",
    detail: `Cover ${fmt(trip.startDate)} to ${fmt(trip.endDate)}${foreign.length ? ` in ${list(visitNames)}` : ""}${risky.length ? `, including ${list(risky.slice(0, 4))}` : ""}${booked ? ", and cancellation cover for your prepaid bookings" : ""}. Buy it soon after booking so cancellation cover starts early.`,
    links: isAU ? [{ label: "Smartraveller: insurance", url: "https://www.smartraveller.gov.au/before-you-go/insurance" }] : undefined,
  });
  todoItem({
    group: "Do soon",
    text: "Check your passport's expiry date",
    detail: `Many countries require at least 6 months' validity on arrival — to be safe it should be valid until ${fmt(addMonths(trip.endDate, 6))} — and some need 2 blank pages.`,
  });
  if (foreign.length) {
    const links: Link[] = [{ label: "IATA Travel Centre", url: "https://www.iatatravelcentre.com/" }];
    if (isAU) links.unshift({ label: "Smartraveller destinations", url: "https://www.smartraveller.gov.au/destinations" });
    todoItem({
      group: "Do soon",
      text: `Check visa and entry requirements for ${list(visitNames)}`,
      detail: "Requirements depend on your passport. Check official sources for each country, including countries where you only change planes.",
      links,
    });
  }
  const usTransit = places.transits.find((t) => t.countryCode === "US") ?? (places.stops.find((s) => s.countryCode === "US") && { date: places.stops.find((s) => s.countryCode === "US")!.from });
  if (usTransit && home !== "US") {
    todoItem({
      group: "Do soon",
      text: "Apply for a US ESTA (or have a US visa)",
      detail: `You pass through the United States${places.transits.some((t) => t.countryCode === "US") ? " to change planes" : ""} — the US requires an ESTA or visa even for connections. Apply at least 72 hours before; only use the official site.`,
      due: `${usTransit.date}T00:00`,
      links: [{ label: "Official ESTA site", url: "https://esta.cbp.dhs.gov/" }],
    });
  }
  if (places.countries.includes("CA") && home !== "CA") {
    todoItem({
      group: "Do soon",
      text: "Check if you need a Canadian eTA",
      detail: "Visa-exempt travellers flying to or through Canada usually need an eTA. Only use the official site.",
      links: [{ label: "Official eTA site", url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html" }],
    });
  }
  // Immigration and customs forms for every border crossed (Check-MIG, arrival cards, customs declarations…).
  const transitAt = (f: FlightItem) => places.transits.some((t) => t.iata === f.to && t.date === (f.arrivalTime ?? f.departureTime).slice(0, 10));
  for (const b of borderForms(flights, home, countryName, transitAt)) {
    todoItem(
      { group: "Border forms", text: b.text, detail: b.detail, due: b.due ?? b.flight.departureTime.slice(0, 16), when: b.when, links: b.links, reminders: reminders(b.flight.from, b.remind) },
      `${b.direction}-${b.country}-${b.flight.flightNumber}-${b.flight.departureTime.slice(0, 10)}`,
    );
  }
  if (isAU && foreign.length) {
    todoItem({
      group: "Do soon",
      text: "Subscribe to Smartraveller updates",
      detail: `Get safety and entry updates for ${list(visitNames)} by email.`,
      links: [{ label: "Smartraveller", url: "https://www.smartraveller.gov.au/" }],
    });
  }
  if (foreign.length) {
    todoItem({
      group: "Do soon",
      text: "Sort out mobile data (travel eSIM or roaming)",
      detail: `Get an eSIM or roaming pack that covers ${list(visitNames)} — check your phone supports eSIM, and set it up before you leave.`,
      links: [{ label: "Airalo", url: "https://www.airalo.com/" }, { label: "Holafly", url: "https://esim.holafly.com/" }],
    });
    // Only where you stay (not connections); "USD (Panama uses US dollars)" covers plain "USD".
    const stayCountries = [...new Set(places.stops.map((s) => s.countryCode))].filter((c) => c !== home);
    let currencies = [...new Set(stayCountries.map((c) => CURRENCY[c]).filter(Boolean))];
    currencies = currencies.filter((c) => !currencies.some((o) => o !== c && o.startsWith(`${c} `)));
    todoItem({
      group: "Do soon",
      text: "Get your money ready",
      detail: `Bring a card with no foreign transaction fees and tell your bank you're travelling.${currencies.length ? ` Local currency: ${list(currencies)}.` : ""}${activities.some((a) => JSON.stringify(a.guide ?? {}).match(/\bcash\b/i)) ? " Some of your activities need cash." : ""}`,
    });
  }
  const homePlugs = home ? PLUGS[home] : undefined;
  const plugNeeds = foreign.filter((c) => PLUGS[c] && homePlugs && !PLUGS[c].some((p) => homePlugs.includes(p)));
  if (plugNeeds.length) {
    const types = [...new Set(plugNeeds.flatMap((c) => PLUGS[c]))].sort().join("/");
    pack("Essentials", "Plug adapter", `${list(plugNeeds.map(countryName))} use type ${types} plugs (yours: type ${homePlugs!.join("/")}).`);
  } else if (!home && foreign.length) {
    pack("Essentials", "Plug adapter (check plug types)", "Set your home country in Prepare to see which adapters you need.");
  }
  // One check-in per journey: flights on the same booking that connect within 24 hours.
  const journeys: FlightItem[][] = [];
  for (const f of [...flights].sort((a, b) => a.departureTime.localeCompare(b.departureTime))) {
    const ref = f.confirmationCode ?? f.flightNumber;
    const j = journeys.find((js) => {
      const last = js.at(-1)!;
      const gap = new Date(`${f.departureTime}:00Z`).getTime() - new Date(`${(last.arrivalTime ?? last.departureTime)}:00Z`).getTime();
      return (last.confirmationCode ?? last.flightNumber) === ref && gap < 24 * 3600_000;
    });
    if (j) j.push(f);
    else journeys.push([f]);
  }
  for (const fs of journeys) {
    const firstFlight = fs[0];
    const ref = firstFlight.confirmationCode;
    const airlines = [...new Set(fs.map((f) => f.airline).filter(Boolean))];
    todoItem(
      {
        group: "Before each flight",
        text: `Check in online: ${fs[0].from} → ${fs.at(-1)!.to} on ${fmt(firstFlight.departureTime, false)}`,
        detail: `${fs.map((f) => `${f.flightNumber} ${f.from}→${f.to}`).join(", ")}${airlines.length ? ` (${list(airlines as string[])})` : ""}. Online check-in usually opens 24–48 hours before departure${ref ? ` — booking ref ${ref}` : ""}.`,
        due: minusHours(firstFlight.departureTime, 24),
        reminders: reminders(firstFlight.from, [{ wall: laterIfNight(minusHours(firstFlight.departureTime, 24)), label: `Online check-in usually opens now: ${fs[0].from} → ${fs.at(-1)!.to}` }]),
        links: firstFlight.links?.filter((l) => /check|manage|ticket/i.test(l.label)),
      },
      `check-in-${ref ?? firstFlight.flightNumber}-${firstFlight.departureTime.slice(0, 10)}`,
    );
  }
  if (places.stops.length) {
    todoItem({
      group: "Do soon",
      text: "Download offline maps",
      detail: `Save ${list(places.stops.map((s) => s.city))} in Google Maps or Maps.me so you can navigate without data.`,
    });
  }
  todoItem({
    group: "Do soon",
    text: "Save copies of your documents",
    detail: "Photos of your passport, insurance policy and cards, stored somewhere you can reach offline. Your bookings are already here in Hey Joy.",
  });
  // Activities' own to-dos (pay cash, confirm pickup…), due the day before each activity.
  for (const a of activities) {
    for (const step of a.guide?.beforeYouGo ?? []) {
      if (/estimated from the cancellation deadline/.test(step)) continue;
      // Not something the traveller has to do (or not for them): provider promises, options for other customers.
      if (/\b(?:our team will|will (?:confirm|contact|send)|cruise passengers|private tours? only|is available for|requires you to be ready)\b/i.test(step)) continue;
      todoItem({ group: "For your activities", text: step, source: a.title, due: minusHours(a.start, 24) }, `${a.id}-${step}`);
    }
  }

  // ---------- Packing ----------
  for (const x of ["Passport", "Phone and charger", "Power bank", "Cards and some cash", "Any medication you take (with prescriptions)", "Copies of important documents"]) pack("Essentials", x);
  if (places.longHaul.length) {
    for (const x of ["Neck pillow", "Eye mask and earplugs", "Compression socks", "Refillable water bottle", "A warm layer for the plane"]) {
      pack("For long flights", x, x === "Compression socks" ? `For ${list(places.longHaul.map((f) => f.flightNumber))}.` : undefined);
    }
  }
  const hot = weather.filter((w) => w.hottest >= 28), rainy = weather.filter((w) => w.rainyShare >= 0.3);
  const coolNights = weather.filter((w) => w.coldest <= 12), cold = weather.filter((w) => w.high <= 12);
  const cities = (ws: StopWeather[]) => list(ws.map((w) => w.city));
  if (hot.length) {
    pack("For the weather", "Light, breathable clothes", `${cities(hot)} reach ${Math.max(...hot.map((w) => w.hottest))}°C.`);
    pack("For the weather", "Sunscreen (SPF 50), hat and sunglasses");
  }
  if (rainy.length) pack("For the weather", "Compact umbrella or light rain jacket", `Rain is likely on most days in ${cities(rainy)}.`);
  if (coolNights.length) pack("For the weather", "Light jacket or jumper for the evenings", `Nights get down to about ${Math.min(...coolNights.map((w) => w.coldest))}°C in ${cities(coolNights)}.`);
  if (cold.length) pack("For the weather", "Warm coat, scarf and gloves", `Daytime highs around ${Math.min(...cold.map((w) => w.high))}°C in ${cities(cold)}.`);
  for (const a of activities) {
    for (const x of [...(a.guide?.whatToBring ?? []), ...(a.guide?.whatToWear ?? [])]) {
      // Full sentences stay in the activity guide; the packing list is for things.
      if (x.length > 90 || (/[.;]/.test(x) && x.split(" ").length > 4)) continue;
      const key = x.toLowerCase();
      const existing = packing.find((p) => p.text.toLowerCase() === key || (key.split(" ").length <= 2 && p.text.toLowerCase().includes(key)));
      if (existing) existing.source = existing.source ? `${existing.source}; ${a.title}` : a.title;
      else add(packing, { section: "packing", group: "For your activities", text: x, source: a.title }, x);
    }
  }
  const has = (re: RegExp) => packing.some((p) => re.test(p.text));
  if (activities.some((a) => /snorkel|beach|island|swim|waterfall|pool/i.test(`${a.title} ${JSON.stringify(a.guide ?? {})}`))) {
    if (!has(/swim/i)) pack("For your activities", "Swimwear and a quick-dry towel");
    if (!has(/biodegradable|reef/i)) pack("For your activities", "Reef-safe sunscreen");
  }
  if (activities.some((a) => /hik|trek|jungle|waterfall|nature|volcano/i.test(a.title)) || trip.styles.includes("adventure") || trip.styles.includes("nature")) {
    pack("For your activities", "Comfortable walking shoes");
    pack("For your activities", "Day pack");
    pack("For your activities", "Insect repellent");
  }
  if (trip.purpose !== "leisure") for (const x of ["Laptop and charger", "Business outfit(s)", "Business cards"]) pack("For work", x);
  if (trip.styles.includes("nightlife")) pack("Clothes", "An outfit for going out");
  const nights = Math.round((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86400_000);
  if (nights > 10) pack("Clothes", "Clothes for about a week, plus a laundry bag", `It's a ${nights}-night trip — plan a laundry stop rather than packing for every day.`);
  // Who's travelling, per part of the trip (or the whole trip).
  const segments = trip.parts?.length ? trip.parts : [{ name: "", from: trip.startDate, to: trip.endDate, party: trip.party, kids: trip.party === "family" ? ("all" as const) : undefined, stayingWithHosts: false, companions: undefined }];
  for (const seg of segments) {
    const forPart = seg.name ? `For ${seg.name}.` : undefined;
    const group = seg.name ? `For ${seg.name}` : "Essentials";
    if (seg.party === "solo") {
      todoItem({
        group: "Do soon",
        text: `Share your itinerary with someone at home${seg.name ? ` (${seg.name})` : ""}`,
        detail: "Send them your flights and where you're staying, and agree when you'll check in.",
      });
    }
    if (seg.stayingWithHosts) pack(group, "A gift for your hosts", `Something from home for ${seg.companions ?? "the family you're staying with"}.`);
    if (seg.kids === "some") pack(group, "Small treats or gifts for the kids", forPart);
    if (seg.kids === "all") pack(group, "Snacks and entertainment for the kids", forPart);
    const days = (() => {
      const out: string[] = [];
      for (let d = new Date(`${seg.from}T00:00:00Z`); d <= new Date(`${seg.to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(5, 10));
      return out;
    })();
    const xmas = days.includes("12-24") || days.includes("12-25"), nye = days.includes("12-31");
    if (xmas || nye) {
      pack(group, `An outfit for ${xmas && nye ? "the Christmas Eve and New Year's Eve dinners" : xmas ? "Christmas Eve dinner" : "New Year's Eve"}`, forPart);
    }
  }

  const order = ["Do soon", "Border forms", "Before each flight", "For your activities"];
  todo.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.due ?? "").localeCompare(b.due ?? ""));
  return { todo, packing };
}
