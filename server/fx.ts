import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

// Exchange rates from ExchangeRate-API's open endpoint: free, no key, ~160 currencies, updated daily.
// Their terms ask for attribution ("Rates By Exchange Rate API") and modest request rates, so cache on disk.

export interface FxRates {
  base: string; // rates are "1 base = rate × currency"
  rates: Record<string, number>;
  updatedAt: string; // when the provider last updated the rates
  fetchedAt: string;
}

const PATH = join(DATA_DIR, "fx-rates.json");
const MAX_AGE_MS = 12 * 3600_000;

let cache: FxRates | undefined = (() => {
  try {
    return JSON.parse(readFileSync(PATH, "utf8")) as FxRates;
  } catch {
    return undefined;
  }
})();
let inflight: Promise<FxRates> | undefined;

async function fetchRates(): Promise<FxRates> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as { result?: string; base_code?: string; rates?: Record<string, number>; time_last_update_unix?: number };
  if (body.result !== "success" || !body.rates) throw new Error("Exchange rates unavailable");
  const fresh: FxRates = {
    base: body.base_code ?? "USD",
    rates: body.rates,
    updatedAt: new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(PATH, JSON.stringify(fresh));
  return fresh;
}

/** Current rates, refreshed at most every 12 hours. Falls back to the last saved rates when offline. */
export async function getRates(): Promise<FxRates & { stale?: boolean }> {
  if (cache && Date.now() - new Date(cache.fetchedAt).getTime() < MAX_AGE_MS) return cache;
  try {
    inflight ??= fetchRates().finally(() => (inflight = undefined));
    cache = await inflight;
    return cache;
  } catch (err) {
    if (cache) return { ...cache, stale: true };
    throw err;
  }
}
