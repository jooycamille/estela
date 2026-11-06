// What medicines to pack and what to ask a doctor, from where you're going and what you're doing. No doses, and anything
// prescription-only is worded as a question for a doctor. Written from the US CDC and the UK's TravelHealthPro and
// travel advice, linked from the checklist because this changes: review against them when updating.

import type { ActivityItem, Link } from "../shared/types.ts";

export const CHECKED = "2026-11-07";

const CDC_PAGE: Record<string, string> = { MX: "mexico", PA: "panama", CO: "colombia", SG: "singapore", PH: "philippines" };
const MOSQUITO_BORNE = new Set(["MX", "PA", "CO", "SG", "PH"]); // dengue or Zika, on each country's CDC page
const STOMACH_BUGS = new Set(["MX", "PA", "CO", "SG", "PH"]); // CDC's higher-risk regions, among the countries here
const TYPHOID_FOR_MOST = new Set(["MX", "PA", "PH"]);

const MALARIA: Record<string, string> = {
  MX: "In Mexico it's only Campeche, Chiapas and southern Chihuahua.",
  PA: "In Panama it's parts of several provinces and comarcas, including Colón, Darién, Panamá, Emberá and Kuna Yala, but not Panama City or the Canal Zone.",
  CO: "In Colombia it's lower areas (below 1,700 m says the US CDC, 800 m says Australia), but not Bogotá, Cartagena or Medellín.",
  PH: "In the Philippines it's Palawan and Mindanao, not metro Manila.",
};

// About this high, in metres. Altitude illness usually starts above about 2,400 to 2,500 m, lower for some people.
const HIGH_CITIES: Record<string, number> = { bogota: 2640, "mexico city": 2240 };
const ILLNESS_FROM = 2400;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const about = (a: ActivityItem) => `${a.title} ${(a.guide?.itinerary ?? []).join(" ")}`;
const ON_WATER = /\b(boat|ferry|cruise|catamaran|sailing|kayak|canoe|island hopping|canal transit)\b/i;
const VERY_HIGH = /altitude|\bnevado\b|high elevation/i;

export type HealthItem = { text: string; detail?: string; source?: string };

export function healthAdvice(countries: string[], cities: string[], activities: ActivityItem[], countryName: (code: string) => string, list: (xs: string[]) => string, home?: string) {
  const named = (keep: (code: string) => boolean) => list(countries.filter(keep).map(countryName));
  const packing: HealthItem[] = [
    { text: "Pain and fever relief", detail: "Such as paracetamol (acetaminophen) or ibuprofen." },
    { text: "Diarrhoea medicine and rehydration salts", detail: countries.some((c) => STOMACH_BUGS.has(c)) ? `Travellers' diarrhoea is the most common travel illness, and more common in ${named((c) => STOMACH_BUGS.has(c))}.` : undefined },
    { text: "Antihistamine", detail: "For allergies, bites and stings." },
    { text: "Antacid" },
    { text: "First-aid kit", detail: "Plasters, antiseptic and the like." },
    { text: "Hand sanitiser", detail: "At least 60% alcohol." },
  ];

  if (countries.some((c) => MOSQUITO_BORNE.has(c))) {
    packing.push({ text: "Insect repellent", detail: `With DEET or picaridin. ${named((c) => MOSQUITO_BORNE.has(c))} ${countries.filter((c) => MOSQUITO_BORNE.has(c)).length === 1 ? "has" : "have"} mosquito-borne diseases such as dengue.` });
  }
  const onWater = activities.filter((a) => ON_WATER.test(about(a)));
  if (onWater.length) packing.push({ text: "Motion sickness medicine", source: list(onWater.map((a) => a.title)) });

  const malaria = countries.filter((c) => MALARIA[c]).map((c) => MALARIA[c]);
  if (malaria.length) packing.push({ text: "Malaria tablets, only if a doctor prescribes them", detail: `Only needed for some areas. ${malaria.join(" ")} Tell your doctor exactly where you're going, including day trips.` });

  const highCities = cities.filter((c) => (HIGH_CITIES[fold(c)] ?? 0) >= ILLNESS_FROM);
  const highActivities = activities.filter((a) => VERY_HIGH.test(`${a.title} ${JSON.stringify(a.guide ?? {})}`));
  if (highCities.length || highActivities.length) {
    packing.push({
      text: "Altitude sickness medicine, only if a doctor advises it",
      detail: "Going up gradually matters most. A doctor can say whether you need it and have you try it before you go.",
      source: list([...highCities, ...highActivities.map((a) => a.title)]),
    });
  }

  // Worth raising with a doctor, by where you're going.
  const ask = ["which medicines on your packing list suit you", "an antibiotic to carry for severe diarrhoea"];
  if (countries.some((c) => TYPHOID_FOR_MOST.has(c))) ask.push(`the typhoid vaccine, recommended for most travellers to ${named((c) => TYPHOID_FOR_MOST.has(c))}`);
  if (malaria.length) ask.push("whether anywhere you're going has malaria");
  const nearlyHigh = cities.filter((c) => (HIGH_CITIES[fold(c)] ?? 0) > 0 && !highCities.includes(c));
  if (nearlyHigh.length) ask.push(`altitude: ${list(nearlyHigh.map((c) => `${c} is about ${HIGH_CITIES[fold(c)].toLocaleString("en")} m`))}, just under where altitude illness usually starts, though some people feel it lower`);
  const clinicLinks: Link[] = countries.filter((c) => CDC_PAGE[c]).map((c) => ({ label: `CDC: ${countryName(c)}`, url: `https://wwwnc.cdc.gov/travel/destinations/traveler/none/${CDC_PAGE[c]}` }));
  const clinic = { text: "See a doctor or travel clinic", detail: `At least a month before you go if you can. Ask about ${list(ask)}.`, links: clinicLinks };

  return { packing, clinic, yellowFever: yellowFever(countries, home) };
}

/** Official sources disagree about Colombia, so this says so and sends you to check, rather than picking one. */
function yellowFever(countries: string[], home?: string) {
  const colombia = countries.includes("CO"), panama = countries.includes("PA");
  if (!colombia && !panama) return undefined;
  const parts: string[] = [];
  if (colombia) parts.push("Official sources differ on Colombia: Australia's Smartraveller and the UK say a certificate is needed if you're arriving from certain countries (Angola, Brazil, DR Congo or Uganda), while the US CDC says all arrivals aged 1 and over. Some national parks and high-risk areas may ask for one too. Smartraveller says to get vaccinated before you go; the CDC says it's generally not needed if you only visit Barranquilla, Cali, Cartagena or Medellín.");
  if (panama) parts.push("Panama wants a certificate if you're arriving from a country with yellow fever risk. The vaccine is recommended for mainland areas east of the Canal Zone, but not for Panama City.");
  parts.push("Colombia and Panama are both on the list of risk countries, so check the rules for every country you go to next.");
  if (home === "AU") parts.push("Coming home, Australia asks for a certificate if you stayed overnight in a risk country in the 6 days before you arrive, though you can still enter without one.");
  parts.push("Ask a travel clinic and your airline. The vaccine comes from an approved clinic, at least 10 days before you travel.");
  const links: Link[] = [
    ...(colombia ? [{ label: "CDC: Colombia", url: "https://wwwnc.cdc.gov/travel/destinations/traveler/none/colombia" }, { label: "UK: Colombia entry", url: "https://www.gov.uk/foreign-travel-advice/colombia/entry-requirements" }] : []),
    ...(panama ? [{ label: "UK: Panama entry", url: "https://www.gov.uk/foreign-travel-advice/panama/entry-requirements" }] : []),
    ...(colombia ? [{ label: "Smartraveller: Colombia", url: "https://www.smartraveller.gov.au/destinations/americas/colombia" }] : []),
    { label: "Vaccine and Australia's rule", url: "https://www.healthdirect.gov.au/conditions/viral-infections/yellow-fever" },
    { label: "Risk countries", url: "https://nathnacyfzone.org.uk/factsheet/65/countries-with-risk-of-yellow-fever-transmission" },
  ];
  return { text: "Check the yellow fever rules for your route", detail: parts.join(" "), links };
}
