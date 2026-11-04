import { readFileSync } from "node:fs";

// Airports with an IATA code and scheduled passenger service, from OurAirports (public domain).
// Refresh server/data/airports.json with `npm run airports`.

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
}

type Row = [iata: string, name: string, city: string, country: string, keywords: string, size: number, lat: number, lon: number, countryCode: string];
const rows = (JSON.parse(readFileSync(new URL("./data/airports.json", import.meta.url), "utf8")) as { airports: Row[] }).airports;

// Major airports the dataset lists under a suburb or town: show and search them by the city they serve.
const SERVES: Record<string, string> = {
  PTY: "Panama City", SYD: "Sydney", GRU: "São Paulo", VCP: "Campinas", EZE: "Buenos Aires", AEP: "Buenos Aires", SCL: "Santiago",
  CDG: "Paris", ORY: "Paris", NRT: "Tokyo", HND: "Tokyo", KIX: "Osaka", ICN: "Seoul", BKK: "Bangkok", DMK: "Bangkok",
  CGK: "Jakarta", IAD: "Washington", DCA: "Washington", YYZ: "Toronto", MXP: "Milan", LIN: "Milan", FCO: "Rome", CIA: "Rome",
  LHR: "London", LGW: "London", STN: "London", LTN: "London", AMS: "Amsterdam", FRA: "Frankfurt", MUC: "Munich", MAD: "Madrid",
  BCN: "Barcelona", LIS: "Lisbon", DXB: "Dubai", DOH: "Doha", SIN: "Singapore", HKG: "Hong Kong", KUL: "Kuala Lumpur",
  MNL: "Manila", DEL: "Delhi", BOM: "Mumbai", JFK: "New York", LGA: "New York", EWR: "New York (Newark)", LAX: "Los Angeles",
  SFO: "San Francisco", ORD: "Chicago", IAH: "Houston", DFW: "Dallas", MIA: "Miami", MEX: "Mexico City", NLU: "Mexico City",
  CUN: "Cancún", BOG: "Bogotá", MDE: "Medellín", LIM: "Lima", UIO: "Quito", GYE: "Guayaquil", SJO: "San José", AKL: "Auckland",
  MEL: "Melbourne", BNE: "Brisbane", PER: "Perth", ADL: "Adelaide", YVR: "Vancouver", YUL: "Montreal", GIG: "Rio de Janeiro",
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
for (const r of rows) {
  const served = SERVES[r[0]];
  if (served && served !== r[2]) {
    r[4] = [r[2], r[4]].filter(Boolean).join(", "); // keep the original town searchable
    r[2] = served;
  }
}
const index = rows.map((r) => ({ r, name: fold(r[1]), city: fold(r[2]), country: fold(r[3]), keywords: fold(r[4]) }));
const byCode = new Map(rows.map((r) => [r[0], r]));
const toAirport = (r: Row): Airport => ({ iata: r[0], name: r[1], city: r[2], country: r[3], countryCode: r[8], lat: r[6], lon: r[7] });

export const getAirport = (code: string) => {
  const r = byCode.get(code.toUpperCase());
  return r && toAirport(r);
};

/** Search by code, city, airport name, country or alternate names; bigger airports rank higher. */
export function searchAirports(query: string, limit = 12): Airport[] {
  const q = fold(query.trim());
  if (!q) return [];
  const startsWord = (s: string) => s.startsWith(q) || s.includes(` ${q}`) || s.includes(`(${q}`);
  const scored: { r: Row; score: number }[] = [];
  for (const { r, name, city, country, keywords } of index) {
    let score = 0;
    const code = r[0].toLowerCase();
    if (code === q) score = 100;
    else if (q.length <= 3 && code.startsWith(q)) score = 70;
    else if (city.startsWith(q)) score = 60;
    else if (startsWord(name) || startsWord(city)) score = 50;
    else if (keywords && startsWord(keywords)) score = 40;
    else if (country.startsWith(q)) score = 30;
    else if (q.length >= 3 && (name.includes(q) || city.includes(q))) score = 20;
    if (score) scored.push({ r, score: score + r[5] * 8 }); // large airports first among similar matches
  }
  return scored.sort((a, b) => b.score - a.score || a.r[0].localeCompare(b.r[0])).slice(0, limit).map((s) => toAirport(s.r));
}

/** The biggest airport near a place (within about 150 km): where you'd fly to for it. */
export function nearestMajorAirport(lat: number, lon: number): Airport | undefined {
  let best: Row | undefined;
  let bestScore = -Infinity;
  for (const r of rows) {
    const d2 = (r[6] - lat) ** 2 + (r[7] - lon) ** 2;
    if (d2 > 1.4 ** 2) continue;
    // Size matters most; distance breaks ties between similar airports.
    const score = r[5] * 10 - Math.sqrt(d2);
    if (score > bestScore) [best, bestScore] = [r, score];
  }
  return best && toAirport(best);
}
