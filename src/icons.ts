import {
  Bike, BriefcaseBusiness, Bus, Coffee, ChefHat, Drama, Flower2, GraduationCap, Hotel, House, Landmark, Map as MapIcon, MapPin, Mountain, Music,
  Palmtree, Plane, Ship, ShoppingBag, Sparkles, Swords, Ticket, Trees, Utensils, Wind, Wine, NotebookText, PartyPopper,
  type LucideIcon,
} from "lucide-react";
import { listTheme, type ListTheme } from "../shared/lists.ts";
import type { DraftItem, ItineraryItem, TravelStyle, TripList } from "../shared/types.ts";

// One line icon per booking so entries are recognisable at a glance. Activities get a more specific icon when their
// title or category says what they are; the first matching rule wins.

export type { LucideIcon };

export const KIND_ICON = { flight: Plane, stay: Hotel, activity: Ticket } as const;

const HOME = /\b(?:apartment|apartamento|apto|loft|home|house|casa|villa|condo|studio|flat|cabin|cottage|airbnb|vrbo|entire)\b/i;

const ACTIVITY_ICONS: [RegExp, LucideIcon][] = [
  // Specific first: a "Lucha Libre, Tacos & Mezcal tour" is a lucha libre night, a "Salsa class" is dancing.
  [/\b(?:lucha libre|wrestling)\b/i, Swords],
  [/\b(?:paraglid\w*|skydiv\w*|hot-air balloon|balloon ride|zip-?lin\w*|canopy tour)\b/i, Wind],
  [/\b(?:salsa|bachata|tango|dance|dancing)\b/i, Music],
  [/\b(?:coffee|café|cafe|cupping)\b/i, Coffee],
  [/\b(?:meeting|conference|workshop with|client|office|interview|presentation)\b/i, BriefcaseBusiness],
  [/\b(?:cooking|baking|culinary)\b/i, ChefHat],
  [/\b(?:islands?|beach\w*|snorkel\w*|diving|dive|surf\w*|boat\w*|catamaran|kayak\w*)\b/i, Palmtree],
  [/\b(?:cruise|ferry|sailing)\b/i, Ship],
  [/\b(?:hike|hiking|trek|waterfall|volcano|jungle|national park|nature|safari|wildlife|sloth|monkey)\b/i, Mountain],
  [/\b(?:museum|gallery|heritage|pyramid|ruins|temple|cathedral|palace|castle|historic)\b/i, Landmark],
  [/\b(?:dinner|lunch|breakfast|brunch|restaurant|food|tasting|street food|wine|mezcal|tequila|coffee|market)\b/i, Utensils],
  [/\b(?:show|concert|theat(?:er|re)|lucha|opera|ballet|festival|game|match|stadium)\b/i, Drama],
  [/\b(?:spa|massage|yoga|wellness|hot spring)\b/i, Flower2],
  [/\b(?:bike|e-bike|cycling)\b/i, Bike],
  [/\b(?:transfer|shuttle|pickup|car hire|rental car|train|bus)\b/i, Bus],
  [/\b(?:class|lesson|course)\b/i, GraduationCap],
  [/\b(?:tour|walking|excursion|day trip|sightseeing|city)\b/i, MapIcon],
];

/** Icon for an itinerary item or an email-import draft. */
export function itemIcon(item: ItineraryItem | DraftItem): LucideIcon {
  if (item.kind === "flight") return KIND_ICON.flight;
  if (item.kind === "stay") {
    // Homes and apartments: by name/address, an Airbnb confirmation code (HM + 8 characters) or an Airbnb link.
    const airbnb = /^HM[A-Z0-9]{8}$/.test(item.confirmationCode ?? "") || item.links?.some((l) => /airbnb\./i.test(l.url));
    return airbnb || HOME.test(`${item.name} ${item.address ?? ""}`) ? House : KIND_ICON.stay;
  }
  if (item.category === "transfer") return Bus;
  const text = `${item.title} ${item.category ?? ""}`;
  return ACTIVITY_ICONS.find(([re]) => re.test(text))?.[1] ?? KIND_ICON.activity;
}

export const THEME_ICON: Record<ListTheme, LucideIcon> = {
  food: Utensils, drinks: Wine, sights: Landmark, shopping: ShoppingBag, nature: Trees, nightlife: PartyPopper, general: NotebookText,
};

/** What a list is about: the theme you picked (saved as its emoji), or else from its name ("Mexico Eats" is food). */
export const listThemeOf = (list: Pick<TripList, "name" | "emoji">): ListTheme => listTheme(list.name, list.emoji);

/** A city guide gets a map pin; your own lists an icon for what they're about ("Mexico Eats" → fork and knife). */
export const listIcon = (list: Pick<TripList, "auto" | "name" | "emoji">): LucideIcon => (list.auto ? MapPin : THEME_ICON[listThemeOf(list)]);

export const STYLE_ICON: Record<TravelStyle, LucideIcon> = {
  adventure: Mountain, culture: Drama, food: Utensils, relaxation: Flower2, nature: Trees, nightlife: Music, shopping: ShoppingBag,
  budget: Ticket, luxury: Sparkles,
};
