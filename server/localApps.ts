import type { LocalApp } from "../shared/types.ts";

// Apps worth having in a place. Only add one confirmed on the company's or a government's own page for that place, and link
// it, since apps change and availability differs by city. Places with none here still get the two that work anywhere.

const EVERYWHERE: LocalApp[] = [
  { name: "Google Maps", kind: "Getting around", why: "Save the area before you go so maps work offline. Offline, you get driving directions but not walking or transit.", url: "https://support.google.com/maps/answer/6291838" },
  { name: "Google Translate", kind: "Language", why: "Download the local language so it works with no signal.", url: "https://support.google.com/translate/answer/6142473" },
];

const COUNTRY: Record<string, LocalApp[]> = {
  SG: [
    { name: "Grab", kind: "Getting around", why: "Rides, plus food delivery.", url: "https://www.grab.com/sg/" },
    { name: "Gojek", kind: "Getting around", why: "Cars and taxis, as an alternative to Grab.", url: "https://www.gojek.com/sg/" },
    { name: "MyICA", kind: "Official", why: "Submit your free SG Arrival Card within 3 days before you arrive. Ignore companies that charge for it.", url: "https://www.ica.gov.sg/enter-transit-depart/entering-singapore/sg-arrival-card" },
  ],
  PH: [
    { name: "Grab", kind: "Getting around", why: "The main ride-hailing app, including in Metro Manila.", url: "https://www.grab.com/ph/transport/" },
    { name: "beep", kind: "Getting around", why: "For the beep card used on Manila's LRT and MRT trains.", url: "https://www.beep.com.ph/" },
    { name: "eGovPH", kind: "Official", why: "The government's app, linked from the free eTravel system for arriving travellers.", url: "https://etravel.gov.ph/" },
  ],
};

const CITY: Record<string, LocalApp[]> = {
  "mexico city": [
    { name: "Uber", kind: "Getting around", why: "Rides at any hour, and you avoid unlicensed taxis.", url: "https://www.uber.com/global/en/cities/mexico-city/" },
    { name: "DiDi", kind: "Getting around", why: "Another ride app that runs here.", url: "https://web.didiglobal.com/mx/" },
    { name: "911 CDMX", kind: "Safety", why: "Can warn you up to 60 seconds before some earthquakes. It only works with a local phone number.", url: "https://www.gov.uk/foreign-travel-advice/mexico/safety-and-security" },
  ],
  "panama city": [
    { name: "Uber", kind: "Getting around", why: "UK advice is to use ride apps or hotel transport rather than taxis.", url: "https://www.uber.com/global/en/cities/panama-city/" },
    { name: "DiDi", kind: "Getting around", why: "Another ride app that runs here.", url: "https://web.didiglobal.com/pa/" },
    { name: "Metro de Panamá", kind: "Getting around", why: "The official app for the city's metro.", url: "https://www.elmetrodepanama.com/" },
  ],
  medellin: [
    { name: "Uber", kind: "Getting around", why: "UK advice is not to hail taxis on the street, so book one by app.", url: "https://www.uber.com/global/en/cities/medellin/" },
    { name: "inDrive", kind: "Getting around", why: "Another ride app, in the main areas of the city.", url: "https://indrive.com/es-co/cities/medellin" },
    { name: "Cívica", kind: "Getting around", why: "The official app for the Metro de Medellín and the city's Cívica card.", url: "https://civica.metrodemedellin.gov.co/civica-app" },
  ],
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** This place's own apps first, then the ones that work anywhere. */
export function localApps(countryCode?: string, city?: string): LocalApp[] {
  return [...((city && CITY[fold(city)]) || []), ...((countryCode && COUNTRY[countryCode]) || []), ...EVERYWHERE];
}
