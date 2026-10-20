import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db.ts";

export type AeroDataBoxRoute = "rapidapi" | "apimarket" | "direct";
export const FLIGHT_PROVIDERS = ["aerodatabox", "airlabs", "aviationstack"] as const;
export type FlightDataProvider = (typeof FLIGHT_PROVIDERS)[number];

export interface ServiceConfig {
  apiKey: string;
  route?: AeroDataBoxRoute; // AeroDataBox only
  monthlyUnits?: number;
  allowHttp?: boolean; // Aviationstack free plan may refuse HTTPS
}
export interface FlightDataConfig extends ServiceConfig {
  provider: FlightDataProvider;
  source: "app" | "env";
}

interface Settings {
  flightServices?: Partial<Record<FlightDataProvider, ServiceConfig>>;
  primary?: FlightDataProvider;
  usageBy?: Partial<Record<FlightDataProvider, { month: string; units: number }>>;
  displayCurrency?: string; // currency for "Booked so far" totals
  homeCountry?: string; // ISO 3166-1 alpha-2: for plug adapters, entry requirements, currencies
  // Older single-service format, migrated on load:
  flightData?: ServiceConfig & { provider?: FlightDataProvider };
  usage?: { month: string; units: number };
}

// Kept apart from db.json so keys never travel with trip data; data/ is git-ignored and the file is owner-only.
const PATH = join(DATA_DIR, "settings.json");

function load(): Settings {
  let s: Settings;
  try {
    s = JSON.parse(readFileSync(PATH, "utf8")) as Settings;
  } catch {
    return {};
  }
  if (s.flightData?.apiKey) {
    const { provider = "aerodatabox", ...service } = s.flightData;
    s.flightServices = { ...s.flightServices, [provider]: service };
    s.primary ??= provider;
    if (s.usage) s.usageBy = { ...s.usageBy, [provider]: s.usage };
    delete s.flightData;
    delete s.usage;
  }
  return s;
}

export const settings: Settings = load();

export function saveSettings() {
  writeFileSync(`${PATH}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(`${PATH}.tmp`, PATH);
}

function envService(provider: FlightDataProvider): ServiceConfig | undefined {
  const e = process.env;
  if (provider === "aerodatabox" && e.AERODATABOX_API_KEY) {
    return { apiKey: e.AERODATABOX_API_KEY, route: (e.AERODATABOX_ROUTE as AeroDataBoxRoute) || "rapidapi", monthlyUnits: Number(e.AERODATABOX_MONTHLY_UNITS) || undefined };
  }
  if (provider === "airlabs" && e.AIRLABS_API_KEY) return { apiKey: e.AIRLABS_API_KEY, monthlyUnits: Number(e.AIRLABS_MONTHLY_REQUESTS) || undefined };
  if (provider === "aviationstack" && e.AVIATIONSTACK_API_KEY) return { apiKey: e.AVIATIONSTACK_API_KEY, allowHttp: e.AVIATIONSTACK_ALLOW_HTTP === "true" };
}

/** Every configured service (in-app keys win over .env): the primary first, then AeroDataBox → AirLabs → Aviationstack. */
export function flightServices(): FlightDataConfig[] {
  const list: FlightDataConfig[] = [];
  for (const provider of FLIGHT_PROVIDERS) {
    const app = settings.flightServices?.[provider];
    const env = envService(provider);
    if (app?.apiKey) list.push({ ...app, provider, source: "app" });
    else if (env) list.push({ ...env, provider, source: "env" });
  }
  return list.sort((a, b) => Number(b.provider === settings.primary) - Number(a.provider === settings.primary));
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
// Free plans: AeroDataBox Basic 400 units (2 per lookup), Aviationstack 100 requests; AirLabs: set from your dashboard.
const DEFAULT_LIMITS: Record<FlightDataProvider, number> = { aerodatabox: 400, aviationstack: 100, airlabs: 1000 };

export function recordUsage(provider: FlightDataProvider, units: number) {
  settings.usageBy ??= {};
  const u = settings.usageBy[provider];
  settings.usageBy[provider] = u?.month === thisMonth() ? { month: u.month, units: u.units + units } : { month: thisMonth(), units };
  saveSettings();
}

export function usage(provider: FlightDataProvider) {
  const u = settings.usageBy?.[provider];
  const used = u?.month === thisMonth() ? u.units : 0;
  const limit = flightServices().find((s) => s.provider === provider)?.monthlyUnits ?? DEFAULT_LIMITS[provider];
  return { used, limit, month: thisMonth() };
}
