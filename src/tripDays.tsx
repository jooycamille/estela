import { createContext, useContext } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from "lucide-react";
import type { ActivityItem } from "../shared/types.ts";
import type { DayWeather, TripDays } from "./api.ts";
import { t } from "./i18n.ts";

// What the trip page knows about each day (where you are, its time zone, the forecast), for any card that needs it.

export const TripDaysContext = createContext<TripDays | undefined>(undefined);
export const useTripDays = () => useContext(TripDaysContext);

/** The WMO weather codes Open-Meteo uses, as an icon and a word or two. */
export function weatherLook(code: number): { icon: LucideIcon; label: string } {
  if (code === 0) return { icon: Sun, label: t("Clear") };
  if (code <= 2) return { icon: CloudSun, label: t("Partly cloudy") };
  if (code === 3) return { icon: Cloud, label: t("Cloudy") };
  if (code === 45 || code === 48) return { icon: CloudFog, label: t("Fog") };
  if (code >= 51 && code <= 57) return { icon: CloudDrizzle, label: t("Drizzle") };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: CloudRain, label: code >= 80 ? t("Showers") : t("Rain") };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: CloudSnow, label: t("Snow") };
  if (code >= 95) return { icon: CloudLightning, label: t("Thunderstorms") };
  return { icon: Cloud, label: t("Cloudy") };
}

/** A small forecast for a day header: icon, high and low, and the chance of rain when it's worth knowing. */
export function DayWeatherChip({ w }: { w: DayWeather }) {
  const { icon: Icon, label } = weatherLook(w.code);
  return (
    <span className="day-weather" title={`${label}, ${w.high}° / ${w.low}°${w.rain ? `, ${t("{n}% chance of rain", { n: w.rain })}` : ""}`}>
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}, </span>
      {w.high}°<span className="muted">/{w.low}°</span>
      {w.rain >= 40 && <span className="day-rain">{w.rain}%<span className="sr-only">{" "}{t("chance of rain")}</span></span>}
    </span>
  );
}

// Words that say an activity happens outside, so rain matters.
const OUTDOOR = /\b(tour|walk|walking|hike|hiking|trek|trail|beach|island|park|garden|boat|cruise|kayak|canoe|raft|rafting|snorkel|dive|diving|surf|zip ?line|horse|bike|cycling|safari|waterfall|falls|viewpoint|mirador|lake|river|mountain|volcano|picnic|market|outdoor|paraglid\w*|coffee farm|finca|farm|ruins|graffiti|street)\b/i;

/** An activity likely to be spoilt by rain (rides and transfers aside). */
export const isOutdoor = (a: ActivityItem) => a.category !== "transfer" && OUTDOOR.test(`${a.title} ${a.category ?? ""}`);
