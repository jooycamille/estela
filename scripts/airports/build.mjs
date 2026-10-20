// Rebuilds server/data/airports.json from OurAirports (public domain): airports with an IATA code and scheduled
// passenger service, plus all large airports. Run: npm run airports
import { writeFileSync } from "node:fs";

const BASE = "https://davidmegginson.github.io/ourairports-data";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, commas/newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field), rows.push(row), (row = []), (field = "");
    else if (c !== "\r") field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...data] = rows;
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const get = async (file) => {
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return parseCsv(await res.text());
};

const countries = Object.fromEntries((await get("countries.csv")).map((c) => [c.code, c.name]));
const SIZE = { large_airport: 3, medium_airport: 2 };
const best = new Map();
for (const a of await get("airports.csv")) {
  const code = a.iata_code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || a.type === "closed") continue;
  if (a.scheduled_service !== "yes" && a.type !== "large_airport") continue;
  const size = SIZE[a.type] ?? 1;
  if ((best.get(code)?.[5] ?? 0) >= size) continue; // one entry per code: the bigger airport
  const keywords = a.keywords.split(",").map((k) => k.trim()).filter(Boolean).join(", ").slice(0, 120);
  best.set(code, [
    code, a.name.trim(), a.municipality.trim(), countries[a.iso_country] ?? a.iso_country, keywords, size,
    Math.round(+a.latitude_deg * 1e4) / 1e4, Math.round(+a.longitude_deg * 1e4) / 1e4, a.iso_country,
  ]);
}
const airports = [...best.values()].sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(
  new URL("../../server/data/airports.json", import.meta.url),
  JSON.stringify(
    {
      source: "OurAirports (public domain), https://ourairports.com/data/ — airports with an IATA code and scheduled service, plus large airports",
      fields: ["iata", "name", "city", "country", "keywords", "size", "lat", "lon", "countryCode"],
      airports,
    },
    null,
    0,
  ),
);
console.log(airports.length, "airports written");
