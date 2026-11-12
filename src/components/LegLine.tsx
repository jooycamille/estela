import { Car, Footprints, TramFront } from "lucide-react";
import type { DayLeg } from "../../shared/types.ts";
import { t } from "../i18n.ts";

// Between two stops of a day: how long it takes on foot or by car, and how far, with directions (and public transport
// for the longer ones). Routes from OpenStreetMap (see server/routing.ts).

const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);
const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

export default function LegLine({ leg, note }: { leg?: DayLeg; note?: string }) {
  if (!leg) return null;
  const Icon = leg.mode === "walk" ? Footprints : leg.mode === "drive" ? Car : TramFront;
  return (
    <div className="day-leg">
      <span className="day-leg-line" aria-hidden="true" />
      <span className="day-leg-text small">
        <Icon aria-hidden="true" />
        <span className="sr-only">{leg.mode === "walk" ? t("Walk") : leg.mode === "drive" ? t("Drive") : t("Public transport")}: </span>
        {leg.mode === "transit" ? <span title={t("An estimate: tap Times for the real ones")}>{t("about {duration}", { duration: duration(leg.minutes) })}</span> : duration(leg.minutes)} · {distance(leg.km)}
        {note && <span className="muted"> {note}</span>}
        <a href={leg.url} target="_blank" rel="noopener noreferrer">{leg.mode === "transit" ? t("Times ↗") : t("Directions ↗")}</a>
        {leg.transitUrl && <a className="muted" href={leg.transitUrl} target="_blank" rel="noopener noreferrer">{t("Public transport ↗")}</a>}
        {leg.driveUrl && <a className="muted" href={leg.driveUrl} target="_blank" rel="noopener noreferrer">{t("By car ↗")}</a>}
      </span>
    </div>
  );
}
