import type { Link } from "../shared/types.ts";

// What you need to ride public transport where you're staying. Written from each operator's own pages, and linked, because
// fares and cards change: review against them when updating, and leave out what they don't say. No fares here for that
// reason. A place that isn't here gets a general reminder rather than a guess.

type Transport = { text: string; detail: string; links: Link[] };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const MANILA: Transport = {
  text: "Get a beep card for Manila's trains and buses",
  detail: "The stored-value card for the LRT-1, LRT-2 and MRT-3, and many buses. Buy it at the stations, including LRT-2 Antipolo. Load it at station loading machines or in the beep app.",
  links: [{ label: "Where to buy", url: "https://beep.com.ph/where-to-buy-a-beep-card/" }, { label: "Where to load", url: "https://beep.com.ph/loading-stations/" }],
};

const CITIES: Record<string, Transport> = {
  medellin: {
    text: "Get a Cívica card for Medellín's metro",
    detail: "The contactless card for the metro, metro cable, tram and connected buses. There's a tourist card (Eventual), or a personal one you get with your passport at Niquía, Acevedo, San Javier, Itagüí or San Antonio station, Monday to Friday 9:30 to 18:30, closed on holidays. Top up with cash at station machines or in the Cívica app.",
    links: [{ label: "How to get one", url: "https://civica.metrodemedellin.gov.co/quiero-una" }, { label: "How to travel", url: "https://www.metrodemedellin.gov.co/usuarios/como-viajar-en-el-metro-de-medellin" }, { label: "Where to top up", url: "https://civica.metrodemedellin.gov.co/como-usarla/donde-recargarla" }],
  },
  "panama city": {
    text: "Get a Metro card for Panama City",
    detail: "The metro is paid with a Metro, MetroBus or RapiPass card, which you tap at the turnstile. Buy and top up at station machines and other recharge points.",
    links: [{ label: "User guide", url: "https://elmetrodepanama.com/guia-del-usuario/" }, { label: "Paying", url: "https://elmetrodepanama.com/tarifa-del-metro/" }],
  },
  singapore: {
    text: "Choose how to pay for Singapore's MRT and buses",
    detail: "Tap a contactless bank card (Amex, Mastercard, NETS or Visa), or use an EZ-Link card. A Singapore Tourist Pass gives unlimited MRT, LRT and basic buses for 1 to 5 days in a row. Foreign bank cards can't top up at kiosks, so check fees with your bank too.",
    links: [{ label: "Cards", url: "https://www.simplygo.com.sg/travel-cards/" }, { label: "Tourist Pass", url: "https://www.thesingaporetouristpass.com.sg/" }],
  },
  manila: MANILA,
  antipolo: MANILA,
  rizal: MANILA,
};

/** Each city once, in the order you get there. */
export function publicTransport(stops: { city: string; from: string }[]) {
  const seen = new Set<string>();
  return stops.flatMap((stop) => {
    const known = CITIES[fold(stop.city)];
    const item: Transport = known ?? {
      text: `Check how to pay for public transport in ${stop.city}`,
      detail: "Find out whether you need a travel card, where to buy it, and whether a contactless bank card or cash works. Google Maps doesn't give transit directions offline, so you'll need data too.",
      links: [{ label: "Search", url: `https://www.google.com/search?q=${encodeURIComponent(`${stop.city} public transport how to pay visitors`)}` }],
    };
    if (seen.has(item.text)) return [];
    seen.add(item.text);
    return [{ ...item, from: stop.from }];
  });
}
