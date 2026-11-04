import type { DraftItem, ItineraryItem } from "../shared/types.ts";

// One icon per booking so entries are recognisable at a glance. Activities get a more specific icon when their
// title or category says what they are; the first matching rule wins.

export const KIND_ICON = { flight: "✈️", stay: "🏨", activity: "🎟️" } as const;

const HOME = /\b(?:apartment|apartamento|apto|loft|home|house|casa|villa|condo|studio|flat|cabin|cottage|airbnb|vrbo|entire)\b/i;

const ACTIVITY_ICONS: [RegExp, string][] = [
  // Specific first: a "Lucha Libre, Tacos & Mezcal tour" is a lucha libre night, a "Salsa class" is dancing.
  [/\b(?:lucha libre|wrestling)\b/i, "🤼"],
  [/\b(?:paraglid\w*|skydiv\w*|hot-air balloon|balloon ride|zip-?lin\w*|canopy tour)\b/i, "🪂"],
  [/\b(?:salsa|bachata|tango|dance|dancing)\b/i, "💃"],
  [/\b(?:coffee|café|cafe|cupping)\b/i, "☕"],
  [/\b(?:meeting|conference|workshop with|client|office|interview|presentation)\b/i, "💼"],
  [/\b(?:cooking|baking|culinary)\b/i, "🍳"],
  [/\b(?:islands?|beach\w*|snorkel\w*|diving|dive|surf\w*|boat\w*|catamaran|kayak\w*)\b/i, "🏝️"],
  [/\b(?:cruise|ferry|sailing)\b/i, "🛳️"],
  [/\b(?:hike|hiking|trek|waterfall|volcano|jungle|national park|nature|safari|wildlife|sloth|monkey)\b/i, "🥾"],
  [/\b(?:museum|gallery|heritage|pyramid|ruins|temple|cathedral|palace|castle|historic)\b/i, "🏛️"],
  [/\b(?:dinner|lunch|breakfast|brunch|restaurant|food|tasting|street food|wine|mezcal|tequila|coffee|market)\b/i, "🍽️"],
  [/\b(?:show|concert|theat(?:er|re)|lucha|opera|ballet|festival|game|match|stadium)\b/i, "🎭"],
  [/\b(?:spa|massage|yoga|wellness|hot spring)\b/i, "🧖"],
  [/\b(?:bike|e-bike|cycling)\b/i, "🚲"],
  [/\b(?:transfer|shuttle|pickup|car hire|rental car|train|bus)\b/i, "🚐"],
  [/\b(?:class|lesson|course)\b/i, "🧑‍🏫"],
  [/\b(?:tour|walking|excursion|day trip|sightseeing|city)\b/i, "🗺️"],
];

/** Icon for an itinerary item or an email-import draft. */
export function itemIcon(item: ItineraryItem | DraftItem): string {
  if (item.kind === "flight") return KIND_ICON.flight;
  if (item.kind === "stay") {
    // Homes and apartments: by name/address, an Airbnb confirmation code (HM + 8 characters) or an Airbnb link.
    const airbnb = /^HM[A-Z0-9]{8}$/.test(item.confirmationCode ?? "") || item.links?.some((l) => /airbnb\./i.test(l.url));
    return airbnb || HOME.test(`${item.name} ${item.address ?? ""}`) ? "🏠" : KIND_ICON.stay;
  }
  const text = `${item.title} ${item.category ?? ""}`;
  return ACTIVITY_ICONS.find(([re]) => re.test(text))?.[1] ?? KIND_ICON.activity;
}
