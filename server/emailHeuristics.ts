import type { Money } from "../shared/types.ts";

// Rule-based extraction used when Claude isn't configured. Written against common OTA layouts
// (Agoda, Booking.com, Expedia/Hotels.com, Airbnb, hotel chains); Claude handles the long tail.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function findDates(text: string, fallbackYear: number) {
  const found: { index: number; date: string }[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    found.push({ index: m.index!, date: `${m[1]}-${m[2]}-${m[3]}` });
  }
  // "12 Nov 2026", "12 November"
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?\b/g)) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) found.push({ index: m.index!, date: `${m[3] ?? fallbackYear}-${pad(mon + 1)}-${pad(+m[1])}` });
  }
  // "Nov 12, 2026", "November 12"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b/g)) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mon >= 0) found.push({ index: m.index!, date: `${m[3] ?? fallbackYear}-${pad(mon + 1)}-${pad(+m[2])}` });
  }
  return found.sort((a, b) => a.index - b.index);
}

export function findTimes(text: string) {
  const out: { index: number; time: string }[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?/gi)) {
    const t = to24h(+m[1], m[2], m[3]);
    if (t) out.push({ index: m.index!, time: t });
  }
  return out;
}

function to24h(h: number, min = "00", ampm?: string) {
  const p = ampm?.toLowerCase()[0];
  if (p === "p" && h < 12) h += 12;
  if (p === "a" && h === 12) h = 0;
  return h < 24 && +min < 60 ? `${pad(h)}:${min}` : undefined;
}

// ---------- Confirmation numbers ----------

const CONFIRMATION_LABELED =
  /\b(?:order\s*(?:id|number|no\.?)|reservation\s*code|booking\s*(?:id|number|no\.?|reference|ref|code)|confirmation\s*(?:number|no\.?|code|id|#)|reservation\s*(?:number|no\.?|code|id)|itinerary\s*(?:number|no\.?|id)|pnr|record\s*locator|reference\s*(?:number|no\.?|code))\s*(?:is\b|[:#=])?\s*:?\s*#?\s*([A-Z0-9](?:[A-Z0-9-]|\.(?=[A-Z0-9])){3,19})/gi;

const NOT_CODES = new Set(["CONFIRMED", "BOOKING", "NUMBER", "PENDING", "DETAILS", "ISSUED", "PAID", "BELOW", "ABOVE", "REQUIRED"]);

export function findConfirmation(text: string): string | undefined {
  const plausible = (c: string) => /\d/.test(c) && !/^(19|20)\d\d$/.test(c) && c === c.toUpperCase();
  // Airline booking codes (PNRs) are often letters only, e.g. "Order ID ABCDEF" — accept those when labelled.
  const plausibleLabelled = (c: string) => plausible(c) || (/^[A-Z]{5,8}$/.test(c) && !NOT_CODES.has(c));
  const labeled = [...text.matchAll(CONFIRMATION_LABELED)].map((m) => m[1]).find(plausibleLabelled);
  if (labeled) return labeled;
  // Looser: "Confirmation: X7KQ2P" style codes that mix letters and digits.
  return [...text.matchAll(/(?:confirmation|booking|reservation|reference)[^\n:#]{0,20}[:#]?\s*([A-Za-z0-9]{5,12})\b/gi)]
    .map((m) => m[1])
    .find((c) => plausible(c) && /[A-Z]/.test(c));
}

// ---------- Prices ----------

const ISO_CURRENCIES = new Set(
  "USD EUR GBP AUD CAD NZD MXN JPY CNY HKD SGD MYR IDR THB VND PHP KRW INR AED SAR QAR CHF SEK NOK DKK PLN CZK HUF TRY ZAR BRL ARS CLP COP PEN ILS EGP MAD TWD ISK RON BGN".split(" "),
);
const SYMBOLS: Record<string, string> = {
  US$: "USD", A$: "AUD", AU$: "AUD", C$: "CAD", CA$: "CAD", NZ$: "NZD", S$: "SGD", SG$: "SGD", HK$: "HKD", MX$: "MXN",
  R$: "BRL", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₱": "PHP", "₩": "KRW", "฿": "THB", "₫": "VND", RM: "MYR", Rp: "IDR",
};
const SYMBOL_RE = "US\\$|A\\$|AU\\$|C\\$|CA\\$|NZ\\$|S\\$|SG\\$|HK\\$|MX\\$|R\\$|\\$|€|£|¥|₹|₱|₩|฿|₫|RM|Rp";
const NUM = "\\d[\\d,.' ]*\\d|\\d";

/** "1,234.56" / "1.234,56" / "1 234,56" / "564.88" -> number */
function parseAmount(raw: string): number | undefined {
  let s = raw.replace(/['\s]/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /,\d{2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234" thousands separator
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function findMoney(line: string, fallbackDollar: string): Money | undefined {
  const patterns: [RegExp, (m: RegExpMatchArray) => Money | undefined][] = [
    [new RegExp(`\\b([A-Z]{3})\\s?(?:${SYMBOL_RE})?\\s?(${NUM})`), (m) => (ISO_CURRENCIES.has(m[1]) ? money(m[2], m[1]) : undefined)],
    [new RegExp(`(${SYMBOL_RE})\\s?(${NUM})(?:\\s?([A-Z]{3})\\b)?`), (m) => money(m[2], m[3] && ISO_CURRENCIES.has(m[3]) ? m[3] : SYMBOLS[m[1]] ?? fallbackDollar)],
    [new RegExp(`(${NUM})\\s?(€|£|[A-Z]{3})\\b`), (m) => money(m[1], SYMBOLS[m[2]] ?? (ISO_CURRENCIES.has(m[2]) ? m[2] : ""))],
  ];
  for (const [re, build] of patterns) {
    const m = line.match(re);
    const result = m && build(m);
    if (result) return result;
  }
}

function money(raw: string, currency: string): Money | undefined {
  const amount = parseAmount(raw);
  return amount && currency ? { amount, currency } : undefined;
}

// "All prices are in Australian Dollars", "Amounts shown in Mexican pesos"
const CURRENCY_WORDS: [RegExp, string][] = [
  [/australian dollars?/i, "AUD"], [/(?:us|american|united states) dollars?/i, "USD"], [/canadian dollars?/i, "CAD"],
  [/new zealand dollars?/i, "NZD"], [/singapore dollars?/i, "SGD"], [/hong kong dollars?/i, "HKD"], [/mexican pesos?/i, "MXN"],
];
function currencyFromWords(text: string) {
  const statement = text.match(/(?:prices?|amounts?|totals?|fares?)[^.\n]{0,30}\b(?:are|is|shown)?\s*in\s+([A-Za-z ]{4,30}?)(?:[.\n,]|$)/i)?.[1];
  return statement ? CURRENCY_WORDS.find(([re]) => re.test(statement))?.[1] : undefined;
}

// Ranked labels for the total actually paid / payable. "Subtotal", taxes and ads are never labelled like this.
const TOTAL_LABELS = [
  /\b(?:grand total|total booking price|total price|total amount|total cost|total charged?|total paid|amount paid|you paid|total due|amount due|total to pay|total \(incl)/i,
  /\b(?:price now|(?<!sub)total)\b/i,
  /^price\b/i,
];

/** What a bare "$" means in this email: a stated currency ("All prices are in Australian Dollars"), else a dollar code mentioned. */
export function defaultDollar(text: string) {
  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]).filter((c) => ISO_CURRENCIES.has(c));
  return currencyFromWords(text) ?? ["USD", "AUD", "CAD", "NZD", "SGD", "HKD", "MXN"].find((c) => codes.includes(c)) ?? "USD";
}

export function findTotalPrice(text: string): Money | undefined {
  const fallbackDollar = defaultDollar(text);
  const lines = text.split("\n").map((l) => l.trim());
  for (const label of TOTAL_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      const found = findMoney(lines[i], fallbackDollar) ?? (lines[i].length < 40 ? findMoney(lines[i + 1] ?? "", fallbackDollar) : undefined);
      if (found) return found;
    }
  }
}

// ---------- Accommodation ----------

const clean = (s: string) =>
  s
    .replace(/\[image:[^\]]*\]/gi, "")
    .replace(/[★☆]+/g, "")
    .replace(/\(\s*\d(?:\.\d)?\s*stars?[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const DATE_LIKE = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b\.?|\b\d{1,2}[:.]\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const NOT_A_NAME = /\b(?:question|contact|please|booking|confirm|reservation|manage|thank|dear|hi |hello|your|check[\s-]?(?:in|out)|directions|subject|from:|to:|date:)|^(?:address|location|payment|total|price|details|map|phone|email)\b/i;
const BOOKING_SITES = /^(?:agoda|booking\.com|expedia|hotels\.com|airbnb|trip\.com|vrbo|hostelworld)\b/i;

function looksLikeAddress(line: string) {
  return line.length >= 8 && line.length <= 160 && /\d/.test(line) && /,/.test(line) && !DATE_LIKE.test(line) && !/https?:|@/.test(line);
}

function looksLikeName(line: string) {
  return line.length >= 3 && line.length <= 80 && line.split(" ").length <= 10 && /[A-Za-z]/.test(line) && !NOT_A_NAME.test(line) && !DATE_LIKE.test(line);
}

/** Many booking emails link to Google Maps with "Name, street, city" as the query. */
export function mapsLinkPlace(raw: string): { name?: string; address?: string } | undefined {
  const m = raw.match(/google\.[a-z.]+\/maps(?:\/search)?\/?\?(?:api=1&(?:amp;)?)?q(?:uery)?=([^"&\s>]+)/i);
  if (!m) return;
  let q: string;
  try {
    q = decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return;
  }
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(q)) return; // bare coordinates
  const [first, ...rest] = q.split(",").map((s) => s.trim());
  if (/^\d/.test(first)) return { address: q };
  return { name: first, address: rest.join(", ") || undefined };
}

function labeledValue(lines: string[], label: RegExp): { value: string; index: number } | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const rest = clean(lines[i].slice(m[0].length).replace(/^\s*[:\-–]\s*/, ""));
    if (rest) return { value: rest, index: i };
    if (lines[i + 1]) return { value: clean(lines[i + 1]), index: i + 1 };
  }
}

export interface StayFields {
  name?: string;
  address?: string;
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  notes?: string;
}

/** Date + time (with "after/before/from/until" wording) from the few lines following a "Check-in"/"Check-out" label. */
function checkSection(lines: string[], label: RegExp, stop: RegExp, year: number, display: string) {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return {};
  const window: string[] = [lines[i].replace(label, "")];
  for (let j = i + 1; j < Math.min(lines.length, i + 4) && !stop.test(lines[j]); j++) window.push(lines[j]);
  const text = window.join(" ");
  const date = findDates(text, year)[0]?.date;
  const tm = text.match(
    /\b(after|from|before|until|by|starting at|no later than)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?(?:\s*(?:to|-|–|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?)?/gi,
  );
  // Pick the first token that is clearly a clock time (has minutes or am/pm), not a day of the month.
  for (const token of tm ?? []) {
    const m = token.match(/^\s*(after|from|before|until|by|starting at|no later than)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?\s?m\.?)?/i)!;
    if (!m[3] && !m[4]) continue;
    const time = to24h(+m[2], m[3] ?? "00", m[4]);
    if (!time) continue;
    return { date, time, note: `${display} ${token.trim().replace(/\s+/g, " ")}` };
  }
  return { date };
}

export function parseStay(text: string, raw: string, year: number): StayFields | undefined {
  const lines = text.split("\n").map(clean).filter(Boolean);
  const inLabel = /^check[\s-]?in\b(?!\s*online)/i;
  const outLabel = /^check[\s-]?out\b/i;
  const checkIn = checkSection(lines, inLabel, outLabel, year, "Check-in");
  const checkOut = checkSection(lines, outLabel, /^$/, year, "Check-out");
  if (!checkIn.date || !checkOut.date) return;

  const fields: StayFields = {
    checkInDate: checkIn.date,
    checkInTime: checkIn.time,
    checkOutDate: checkOut.date,
    checkOutTime: checkOut.time,
    notes: [checkIn.note, checkOut.note].filter(Boolean).join(" · ") || undefined,
  };

  // Name, best signal first.
  const labeledName = labeledValue(lines, /^(?:hotel|property|accommodation|hotel name|property name|listing|lodging)\b(?=\s*[:\-–]|\s*$)/i);
  const maps = mapsLinkPlace(raw);
  // "...confirmed at Casa Azul Boutique" / "Reservation confirmed for Sunny loft in Roma Norte" in the subject line.
  const subject = text.match(/^Subject:\s*(.+)$/im)?.[1].replace(/^(?:(?:fwd?|re):\s*)+/i, "") ?? "";
  const subjectPhrase = subject
    .match(/\b(?:at|for|with)\s+([A-Z][^\n]{2,80})$/)?.[1]
    .replace(/\s+(?:is|has been)\s+confirmed.*$/i, "")
    .replace(/\s+[-–|]\s+.*$/, "")
    .trim();
  const phrase = text
    .match(/\b(?:stay|reservation|booking|room|booked) (?:at|with) ([A-Z][\w'&.-]*(?:\s+[\w'&.-]+){0,7}?)(?=\s+(?:is|has|for|on|from|in)\b|[.!,\n]|$)/)?.[1]
    .trim();
  const usable = (s?: string): s is string => !!s && looksLikeName(s) && !BOOKING_SITES.test(s);
  let nameIndex = -1;
  if (labeledName && looksLikeName(labeledName.value)) {
    fields.name = labeledName.value;
    nameIndex = labeledName.index;
  } else if (usable(maps?.name)) {
    fields.name = maps.name;
  } else if (usable(subjectPhrase)) {
    fields.name = subjectPhrase;
  } else if (usable(phrase)) {
    fields.name = phrase;
  } else {
    // The line just above the first address-looking line.
    const a = lines.findIndex(looksLikeAddress);
    if (a > 0 && looksLikeName(lines[a - 1])) {
      fields.name = lines[a - 1];
      nameIndex = a - 1;
    }
  }
  if (fields.name && nameIndex < 0) nameIndex = lines.findIndex((l) => l === fields.name || l.startsWith(`${fields.name} `));

  // Address: labelled, else the line after the name, else the maps link.
  const labeledAddress = labeledValue(lines, /^(?:address|location|hotel address|property address)\b(?=\s*[:\-–]|\s*$)/i);
  if (labeledAddress && labeledAddress.value.length > 5) fields.address = labeledAddress.value;
  else if (nameIndex >= 0 && lines[nameIndex + 1] && looksLikeAddress(lines[nameIndex + 1])) fields.address = lines[nameIndex + 1];
  else if (maps?.address) fields.address = maps.address;

  return fields;
}

// ---------- Flights ----------

export interface FlightSegment {
  flightNumber: string;
  airline?: string;
  from: string;
  to: string;
  departureTime: string;
  arrivalTime?: string;
  confirmationCode?: string;
  seat?: string;
}

// Three-letter words that are not airports, to avoid reading them as IATA codes in free text.
const NOT_AIRPORTS = new Set([...ISO_CURRENCIES, "THE", "AND", "FOR", "YOU", "ARE", "PDF", "GMT", "UTC", "AEST", "TAX", "FEE", "PNR", "REF", "NEW"]);

/** Overnight flights: an arrival clock time earlier than departure on the same date lands the next day. */
function nextDayIfEarlier(date: string, dep: string, arr: string) {
  if (arr >= dep) return `${date}T${arr}`;
  const d = new Date(`${date}T00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${arr}`;
}

/**
 * Finds every flight segment. Works on one-line formats ("Flight SQ 232 SYD -> SIN … Departs 23:55 Arrives 06:05")
 * and on itinerary layouts where each flight number is followed by its departure airport/date/time, then its arrival
 * airport/date/time (Webjet, Expedia, airline e-tickets and most PDF itineraries).
 */
export function parseFlights(text: string, year: number): FlightSegment[] {
  // Candidate flight numbers: on a line of their own, or right after "Flight" / "Flight Number -".
  const candidates: { index: number; end: number; flightNumber: string }[] = [];
  const re = /(^|\n)[ \t]*((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])[ \t]?\d{1,4})[ \t]*(?=\n|$)|\bflight(?:\s*(?:no\.?|number|#))?\s*[:\-–#]?\s*((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{1,4})\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[2] ?? m[3]).toUpperCase();
    if (/^\d/.test(raw) && /^\d+\s?\d+$/.test(raw)) continue;
    if (!/^[A-Z0-9]{2}/.test(raw) || !/[A-Z]/.test(raw.slice(0, 2))) continue;
    const start = m.index! + m[0].indexOf(m[2] ?? m[3]);
    candidates.push({ index: start, end: start + raw.length, flightNumber: raw.replace(/\s/g, "") });
  }

  const segments: FlightSegment[] = [];
  const globalRef = findConfirmation(text);
  // Fallback airline: the airline the email is from ("Thank you for choosing Copa Airlines").
  const airlineNames = [...text.matchAll(/\b((?:[A-Z][a-z]+ ){1,2}(?:Airlines|Airways|Air Lines))\b/g)].map((m) => m[1].trim());
  const mainAirline = airlineNames.sort((a, b) => airlineNames.filter((x) => x === b).length - airlineNames.filter((x) => x === a).length)[0];
  for (let c = 0; c < candidates.length; c++) {
    const { index, end, flightNumber } = candidates[c];
    const windowEnd = Math.min(candidates[c + 1]?.index ?? text.length, end + 1500);
    const w = text.slice(end, windowEnd);

    // Airports: "(MEL)" style codes, else a route like "SYD -> SIN", else bare codes.
    let airports = [...w.matchAll(/\(([A-Z]{3})\)/g)].map((m) => ({ code: m[1], index: m.index! }));
    if (airports.length < 2) {
      const route = w.match(/\b([A-Z]{3})\b\s*(?:→|->|–|—|-|to)\s*\b([A-Z]{3})\b/);
      if (route) airports = [{ code: route[1], index: route.index! }, { code: route[2], index: route.index! + route[0].lastIndexOf(route[2]) }];
    }
    if (airports.length < 2) {
      airports = [...w.matchAll(/\b([A-Z]{3})\b/g)].filter((m) => !NOT_AIRPORTS.has(m[1])).map((m) => ({ code: m[1], index: m.index! }));
    }
    const dates = findDates(w, year);
    if (airports.length < 2 || dates.length === 0) continue;
    const times = findTimes(w);
    let [dep, arr] = airports;
    type Found<T extends string> = { index: number } & Record<T, string>;
    let depDate: Found<"date">, arrDate: Found<"date">, depTime: Found<"time"> | undefined, arrTime: Found<"time"> | undefined;

    // Labelled layouts ("Departure … Arrival …", "Departs 23:55 Arrives 06:05"): each side has its own date/time/airport.
    const depLabel = w.search(/\bdepart(?:ure|s|ing)?\b/i);
    const arrLabel = depLabel >= 0 ? w.slice(depLabel).search(/\barriv(?:al|es|ing)?\b/i) + depLabel : -1;
    const labelled = depLabel >= 0 && arrLabel > depLabel && times.some((t) => t.index > depLabel && t.index < arrLabel);
    if (labelled) {
      dep = airports.find((a) => a.index > depLabel && a.index < arrLabel) ?? dep;
      arr = airports.find((a) => a.index > arrLabel && a !== dep) ?? arr;
      depDate = dates.find((d) => d.index > depLabel && d.index < arrLabel) ?? [...dates].reverse().find((d) => d.index < depLabel) ?? dates[0];
      arrDate = dates.find((d) => d.index > arrLabel) ?? depDate;
      depTime = times.find((t) => t.index > depLabel && t.index < arrLabel);
      arrTime = times.find((t) => t.index > arrLabel);
    } else {
      // Itinerary layouts: departure date/time follow the departure airport; arrival date/time follow the arrival airport.
      depDate = dates.find((d) => d.index > dep.index && d.index < arr.index) ?? dates[0];
      arrDate = dates.find((d) => d.index > arr.index) ?? depDate;
      depTime = times.find((t) => t.index > depDate.index);
      arrTime = times.find((t) => t.index > Math.max(arrDate.index, depTime?.index ?? -1) && t.index > arr.index) ??
        times.find((t) => depTime && t.index > depTime.index && t.time !== depTime.time);
    }

    const departureTime = `${depDate.date}T${depTime?.time ?? "00:00"}`;
    let arrivalTime: string | undefined;
    if (arrTime) {
      arrivalTime = arrDate !== depDate ? `${arrDate.date}T${arrTime.time}` : nextDayIfEarlier(depDate.date, depTime?.time ?? "00:00", arrTime.time);
    }

    // Airline: the line just above the flight number (e.g. "American Airlines"), if it looks like one.
    const lineAbove = text.slice(Math.max(0, index - 80), index).split("\n").map((l) => l.trim()).filter(Boolean).pop();
    const airline =
      (lineAbove && /\b(?:air(?:lines?|ways)?|jet|aero|airline)\b/i.test(lineAbove) && lineAbove.length < 50 ? lineAbove : undefined) ??
      mainAirline;

    const segRef = w.match(/(?:airline\s+(?:reference|ref|booking reference|confirmation)|PNR|booking\s+ref(?:erence)?)\s*:?\s*\n?\s*([A-Z0-9]{5,8})\b/i)?.[1];
    // Only this flight's own block: stop before baggage/seat tables or the next section that list several flights.
    const blockEnd = w.search(/\n\s*(?:transit period|passenger\b|baggage|=== |price breakdown|tax invoice|flight \d+\b)/i);
    const seat = w.slice(0, blockEnd >= 0 ? blockEnd : undefined).match(/\bseat\s*:?\s*(\d{1,2}[A-K])\b/i)?.[1];

    if (segments.some((s) => s.flightNumber === flightNumber && s.departureTime.slice(0, 10) === departureTime.slice(0, 10))) continue;
    segments.push({ flightNumber, airline, from: dep.code, to: arr.code, departureTime, arrivalTime, confirmationCode: segRef ?? globalRef, seat });
  }
  return segments.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
}
