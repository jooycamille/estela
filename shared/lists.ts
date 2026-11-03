// What a list is about, from its name and emoji — used for wording and for suggestions.

export type ListTheme = "food" | "drinks" | "sights" | "shopping" | "nature" | "nightlife" | "general";

const THEMES: [ListTheme, RegExp][] = [
  ["drinks", /coffee|caf[eé]s?\b|bars?\b|drinks?|cocktails?|mezcal|tequila|wine|beer|brewer|☕|🍸|🍷|🍺|🍹/i],
  ["food", /eats?\b|food|foodie|restaurants?|dishes|dining|brunch|lunch|dinner|taco|snacks?|street food|bakery|bakeries|desserts?|sweets|🌮|🍽|🍲|🍜|🥘|🍣|🍰|🥟|🌯|🫓/i],
  ["nightlife", /night ?life|clubs?|party|parties|dancing|salsa|🎉|💃/i],
  ["shopping", /shop|shopping|markets?|souvenirs?|boutiques?|crafts?|🛍/i],
  ["nature", /nature|hikes?|hiking|beach(es)?|parks?|outdoors?|waterfalls?|islands?|🌿|🏖|🥾|🌴|⛰/i],
  ["sights", /places|sights?|see|visit|things to do|attractions?|museums?|landmarks?|explore|must|bucket|culture|history|🏛|📸|⭐|🗺/i],
];

export function listTheme(name: string, emoji = ""): ListTheme {
  const text = `${name} ${emoji}`;
  return THEMES.find(([, re]) => re.test(text))?.[0] ?? "general";
}

export const THEME_EMOJI: Record<ListTheme, string> = {
  food: "🌮", drinks: "☕", sights: "🏛️", shopping: "🛍️", nature: "🌿", nightlife: "🎉", general: "📝",
};

/** Headings for a list's two kinds of entries. */
import type { TravelStyle } from "./types.ts";

export const STYLE_LABELS: Record<TravelStyle, string> = {
  adventure: "🧗 Adventure", culture: "🎭 Culture", food: "🍲 Food", relaxation: "🧖 Relaxation", nature: "🌿 Nature",
  nightlife: "🌙 Nightlife", shopping: "🛍️ Shopping", budget: "💸 Budget", luxury: "✨ Luxury",
};

/** Things to do (activities) share the "thing" column when that's already called "Things to do". */
export const activitiesMerged = (theme: ListTheme) => THEME_LABELS[theme].thing === "Things to do";

export const THEME_LABELS: Record<ListTheme, { place: string; thing: string; placeOne: string; thingOne: string; done: string }> = {
  food: { place: "Places to eat", thing: "Food to try", placeOne: "Place to eat", thingOne: "Food to try", done: "tried" },
  drinks: { place: "Places to go", thing: "Drinks to try", placeOne: "Place", thingOne: "Drink to try", done: "tried" },
  sights: { place: "Places to visit", thing: "Things to do", placeOne: "Place to visit", thingOne: "Thing to do", done: "done" },
  shopping: { place: "Shops & markets", thing: "Things to buy", placeOne: "Shop or market", thingOne: "Thing to buy", done: "done" },
  nature: { place: "Places to go", thing: "Things to do", placeOne: "Place", thingOne: "Thing to do", done: "done" },
  nightlife: { place: "Places to go", thing: "Things to do", placeOne: "Place", thingOne: "Thing to do", done: "done" },
  general: { place: "Places", thing: "Things", placeOne: "Place", thingOne: "Thing", done: "done" },
};
