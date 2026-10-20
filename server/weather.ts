import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";
import type { Stop } from "./tripPlaces.ts";

// Weather for each stop from Open-Meteo (free, no key; attribution "Weather data by Open-Meteo.com", CC BY 4.0).
// Within the 15-day forecast window: the forecast. Further out: what's typical for those dates, averaged over the
// same dates in each of the last 3 years.

export interface StopWeather {
  city: string;
  country: string;
  from: string;
  to: string;
  basis: "forecast" | "typical";
  high: number; // average daily high, °C
  low: number; // average daily low, °C
  hottest: number;
  coldest: number;
  rainyShare: number; // 0–1: share of days with rain (≥ 1 mm, or ≥ 50% chance in forecasts)
  summary: string; // e.g. "Warm and humid, frequent showers"
  icon: string;
}

const PATH = join(DATA_DIR, "weather-cache.json");
let cache: Record<string, { at: number; value: StopWeather }> = (() => {
  try {
    return JSON.parse(readFileSync(PATH, "utf8"));
  } catch {
    return {};
  }
})();

const DAY = 86400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftYears = (date: string, years: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(Math.min(d, m === 2 ? 28 : d)).padStart(2, "0")}`;
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

async function daily(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = (await res.json()) as { daily?: Record<string, (number | null)[]>; reason?: string };
  if (!res.ok || !body.daily) throw new Error(body.reason ?? `Open-Meteo HTTP ${res.status}`);
  return body.daily;
}

function describe(high: number, low: number, rainy: number) {
  const temp =
    high >= 30 ? "Hot" : high >= 25 ? "Warm" : high >= 18 ? "Mild" : high >= 10 ? "Cool" : "Cold";
  const nights = low <= 10 && high >= 18 ? ", chilly nights" : "";
  const rain = rainy >= 0.6 ? "rain most days" : rainy >= 0.3 ? "regular showers" : rainy >= 0.1 ? "the odd shower" : "mostly dry";
  const icon = rainy >= 0.5 ? "🌧️" : rainy >= 0.25 ? "🌦️" : high >= 25 ? "☀️" : high >= 15 ? "🌤️" : "🧥";
  return { summary: `${temp}${nights}, ${rain}`, icon };
}

/**
 * The city's own coordinates (airports can sit far away and at a different altitude — Medellín's is ~600 m higher
 * than the city). Picks the most populous match in the right country; falls back to the airport's position.
 */
const placeCache = new Map<string, { lat: number; lon: number }>();
async function cityPosition(stop: Stop) {
  const key = `${stop.city}|${stop.countryCode}`;
  if (!placeCache.has(key)) {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stop.city)}&count=10&language=en&format=json`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const body = (await res.json()) as { results?: { latitude: number; longitude: number; country_code?: string; population?: number }[] };
      const best = (body.results ?? [])
        .filter((r) => r.country_code === stop.countryCode)
        .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
      placeCache.set(key, best ? { lat: best.latitude, lon: best.longitude } : { lat: stop.lat, lon: stop.lon });
    } catch {
      return { lat: stop.lat, lon: stop.lon }; // try again next time
    }
  }
  return placeCache.get(key)!;
}

export async function stopWeather(stop: Stop): Promise<StopWeather> {
  const pos = await cityPosition(stop);
  const today = iso(new Date());
  const forecastEnd = iso(new Date(Date.now() + 15 * DAY));
  const from = stop.from < today ? today : stop.from;
  const to = stop.to;
  const useForecast = to <= forecastEnd && to >= today;
  const key = `${pos.lat},${pos.lon}|${from}|${to}|${useForecast ? "f" : "t"}`;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < (useForecast ? 6 : 24 * 7) * 3600_000) return hit.value;

  const loc = `latitude=${pos.lat}&longitude=${pos.lon}&timezone=auto`;
  let highs: number[] = [], lows: number[] = [], wet: boolean[] = [];
  if (useForecast) {
    const d = await daily(
      `https://api.open-meteo.com/v1/forecast?${loc}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&start_date=${from}&end_date=${to}`,
    );
    highs = d.temperature_2m_max.filter((x): x is number => x !== null);
    lows = d.temperature_2m_min.filter((x): x is number => x !== null);
    wet = d.precipitation_probability_max.map((p, i) => (p ?? 0) >= 50 || (d.precipitation_sum[i] ?? 0) >= 1);
  } else {
    for (const years of [-1, -2, -3]) {
      const d = await daily(
        `https://archive-api.open-meteo.com/v1/archive?${loc}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${shiftYears(stop.from, years)}&end_date=${shiftYears(stop.to, years)}`,
      );
      highs.push(...d.temperature_2m_max.filter((x): x is number => x !== null));
      lows.push(...d.temperature_2m_min.filter((x): x is number => x !== null));
      wet.push(...d.precipitation_sum.map((p) => (p ?? 0) >= 1));
    }
  }
  if (!highs.length) throw new Error("No weather data for these dates");
  const high = Math.round(avg(highs)), low = Math.round(avg(lows));
  const rainyShare = wet.filter(Boolean).length / Math.max(wet.length, 1);
  const value: StopWeather = {
    city: stop.city,
    country: stop.country,
    from: stop.from,
    to: stop.to,
    basis: useForecast ? "forecast" : "typical",
    high,
    low,
    hottest: Math.round(Math.max(...highs)),
    coldest: Math.round(Math.min(...lows)),
    rainyShare: Math.round(rainyShare * 100) / 100,
    ...describe(high, low, rainyShare),
  };
  cache[key] = { at: Date.now(), value };
  writeFileSync(PATH, JSON.stringify(cache));
  return value;
}
