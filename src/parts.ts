import { t } from "./i18n.ts";
import { partyLabel } from "./labels.ts";
import { partOn, type Trip, type TripPart } from "../shared/types.ts";
import { formatDay } from "./format.ts";


/** "solo, then family" — or just the trip's party when it has no parts. */
export function partySummary(trip: Pick<Trip, "party" | "parts">) {
  const parties = trip.parts?.length ? trip.parts.map((p) => p.party) : [trip.party];
  return parties.filter((p, i) => p !== parties[i - 1]).map(partyLabel).join(t(", then "));
}

/** "With Partner & their family · kids on some days · staying with them" */
export function describePart(p: TripPart) {
  const label = partyLabel(p.party);
  const who = p.party === "solo" ? t("Solo") : p.companions ? t("With {who}", { who: p.companions.replace(/^with\s+/i, "") }) : label[0].toUpperCase() + label.slice(1);
  const bits = [
    who,
    p.kids === "some" ? t("kids on some days") : p.kids === "all" ? t("kids every day") : "",
    p.stayingWithHosts ? t("staying with them") : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export const partRange = (p: TripPart) => `${formatDay(p.from)} – ${formatDay(p.to)}`;
export { partOn };
