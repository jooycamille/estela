import { partOn, type Trip, type TripPart } from "../shared/types.ts";
import { formatDay } from "./format.ts";


/** "solo, then family" — or just the trip's party when it has no parts. */
export function partySummary(trip: Pick<Trip, "party" | "parts">) {
  const parties = trip.parts?.length ? trip.parts.map((p) => p.party) : [trip.party];
  return parties.filter((p, i) => p !== parties[i - 1]).join(", then ");
}

/** "With Partner & their family · kids on some days · staying with them" */
export function describePart(p: TripPart) {
  const who = p.party === "solo" ? "Solo" : p.companions ? `With ${p.companions.replace(/^with\s+/i, "")}` : p.party[0].toUpperCase() + p.party.slice(1);
  const bits = [
    who,
    p.kids === "some" ? "kids on some days" : p.kids === "all" ? "kids every day" : "",
    p.stayingWithHosts ? "staying with them" : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export const partRange = (p: TripPart) => `${formatDay(p.from)} – ${formatDay(p.to)}`;
export { partOn };
