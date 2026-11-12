import type { TravelParty, TravelStyle, TripPurpose } from "../shared/types.ts";
import { locale, t } from "./i18n.ts";

// Words for values saved with a trip (its purpose, who's going, its styles), in the app's language. Functions, not
// constants: the language is loaded after modules are, so t() must only run when something is shown.

export function purposeLabel(p: TripPurpose) {
  return { business: t("business"), leisure: t("leisure"), bleisure: t("bleisure") }[p] ?? p;
}

export function partyLabel(p: TravelParty) {
  return { solo: t("solo"), couple: t("couple"), family: t("family"), friends: t("friends"), colleagues: t("colleagues") }[p] ?? p;
}

export function styleLabel(s: TravelStyle) {
  return (
    {
      adventure: t("adventure"),
      culture: t("culture"),
      food: t("food"),
      relaxation: t("relaxation"),
      nature: t("nature"),
      nightlife: t("nightlife"),
      shopping: t("shopping"),
      budget: t("budget"),
      luxury: t("luxury"),
    }[s] ?? s
  );
}

/** A list in the language's own way: "food, culture, nature" / "美食、文化、自然". */
export const listOf = (items: string[]) => new Intl.ListFormat(locale(), { style: "short", type: "unit" }).format(items);
