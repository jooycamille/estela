// Shared between the API server and the web client.

export const TRIP_PURPOSES = ["business", "leisure", "bleisure"] as const;
export type TripPurpose = (typeof TRIP_PURPOSES)[number];

export const TRAVEL_PARTIES = ["solo", "couple", "family", "friends", "colleagues"] as const;
export type TravelParty = (typeof TRAVEL_PARTIES)[number];

export const TRAVEL_STYLES = [
  "adventure",
  "culture",
  "food",
  "relaxation",
  "nature",
  "nightlife",
  "shopping",
  "budget",
  "luxury",
] as const;
export type TravelStyle = (typeof TRAVEL_STYLES)[number];

/** A stretch of a trip with its own travel companions (e.g. solo first, then with family). */
export interface TripPart {
  id: string;
  name: string; // e.g. "Colombia with family"
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  party: TravelParty;
  companions?: string; // e.g. "Partner & their family"
  kids?: "none" | "some" | "all"; // children along: not at all, on some days, every day
  stayingWithHosts?: boolean; // staying with family/friends — no accommodation needed
}

/** The part a given day falls in (or undefined: the trip's own settings apply). */
export function partOn(trip: { parts?: TripPart[] }, day: string): TripPart | undefined {
  return trip.parts?.find((p) => p.from <= day.slice(0, 10) && day.slice(0, 10) <= p.to);
}

/** A destination: a country, a state/province/region, or a city. */
export interface TripPlace {
  type: "country" | "region" | "city";
  name: string;
  countryCode: string; // ISO 3166-1 alpha-2
  region?: string; // for cities: the state/province
  lat?: number;
  lon?: number;
}

/** One line of the "Prepare" view: a to-do before the trip or something to pack. */
export interface PrepItem {
  id: string; // stable, so ticks survive regeneration
  section: "todo" | "packing";
  group: string; // e.g. "Do soon", "For the weather"
  text: string;
  detail?: string;
  due?: string; // YYYY-MM-DDTHH:mm, local
  when?: "online" | "plane" | "arrival" | "check"; // border forms: where you fill it in
  reminders?: { at: string; label: string }[]; // push notifications: UTC moments, skipped once the item is ticked
  links?: Link[];
  source?: string; // e.g. the activity this came from
  custom?: boolean; // added by the traveller
}

export interface Trip {
  id: string;
  name: string;
  destination: string; // display text, built from places when they're set
  places?: TripPlace[];
  parts?: TripPart[];
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  purpose: TripPurpose;
  party: TravelParty;
  styles: TravelStyle[];
  notes?: string;
  prep?: { checked: string[]; custom: PrepItem[] };
  ownerId?: string; // who made the trip (and can share or delete it)
  members?: TripMember[]; // people it's shared with
  createdAt: string;
}

// ---------- People and sharing ----------

/** What someone you've added can do: change the trip, or only look. The owner can do everything. */
export type TripRole = "owner" | "editor" | "viewer";

export interface TripMember {
  userId: string;
  role: "editor" | "viewer";
  addedAt: string;
}

/** A person who can sign in. The first one is you (the admin, who manages the app's settings). */
export interface User {
  id: string;
  name: string;
  email?: string; // sign-in email (lowercase); none yet for someone invited who hasn't joined
  isAdmin: boolean;
  claimedAt?: string; // the admin: when they signed up (until then, the first visitor can set Hey Joy up)
  homeCountry?: string;
  displayCurrency?: string;
  createdAt: string;
}

/** A traveller on a trip, as shown in the Travellers panel. */
export interface TravellerView {
  userId: string;
  name: string;
  role: TripRole;
  signedIn: boolean; // has used their link on at least one device
  lastSeenAt?: string;
  you: boolean;
}

export type ItemSource = "manual" | "email";

export interface Money {
  amount: number;
  currency: string; // ISO 4217, e.g. "USD"
}

export interface Link {
  label: string;
  url: string;
}

/** A stored file (e.g. a PDF ticket from the booking email, or one the user uploaded). */
export interface StoredAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

interface ItemBase {
  id: string;
  tripId: string;
  source: ItemSource;
  emailId?: string; // inbox message this item was imported from
  confirmationCode?: string;
  price?: Money; // total paid / payable
  links?: Link[]; // e.g. "Manage booking", "Ticket"
  attachments?: StoredAttachment[];
  notes?: string;
  createdAt: string;
}

export type FlightStatusCode =
  | "scheduled"
  | "on_time"
  | "delayed"
  | "boarding"
  | "departed"
  | "landed"
  | "cancelled"
  | "diverted"
  | "unknown";

export interface FlightLive {
  status: FlightStatusCode;
  departureTime?: string; // latest known (revised/estimated) local time
  arrivalTime?: string;
  departureTerminal?: string;
  departureGate?: string;
  arrivalTerminal?: string;
  arrivalGate?: string;
  checkedAt: string;
  provider: string;
}

export interface FlightChange {
  at: string;
  field: string;
  from?: string;
  to?: string;
  acknowledged: boolean;
}

export interface FlightItem extends ItemBase {
  kind: "flight";
  flightNumber: string; // e.g. "QF1"
  airline?: string;
  from: string; // IATA code or city
  to: string;
  departureTime: string; // scheduled local time, YYYY-MM-DDTHH:mm
  arrivalTime?: string;
  seat?: string;
  live?: FlightLive;
  changes: FlightChange[];
}

export interface StayItem extends ItemBase {
  kind: "stay";
  name: string;
  address?: string;
  lat?: number; // from the address lookup (OpenStreetMap), when picked there
  lon?: number;
  checkIn: string; // YYYY-MM-DDTHH:mm
  checkOut: string;
}

/** Practical information for an activity, split into the sections a traveller checks before going. */
export interface ActivityGuide {
  itinerary?: string[]; // what happens, in order
  whatToBring?: string[];
  whatToWear?: string[];
  dos?: string[];
  donts?: string[]; // including "not allowed"
  beforeYouGo?: string[]; // things to do beforehand (pay a fee in cash, confirm pickup, …)
  goodToKnow?: string[];
  meetingPoint?: string; // meeting point or pickup location/time
  endPoint?: string;
  cancellation?: string;
  provider?: string; // operator name and contact
  pin?: string; // check-in PIN, if the booking has one
}

export const GUIDE_LIST_KEYS = ["itinerary", "whatToBring", "whatToWear", "dos", "donts", "beforeYouGo", "goodToKnow"] as const;
export const GUIDE_TEXT_KEYS = ["meetingPoint", "endPoint", "cancellation", "provider", "pin"] as const;

export interface ActivityItem extends ItemBase {
  kind: "activity";
  title: string;
  location?: string;
  lat?: number; // from the place lookup (OpenStreetMap), when picked there
  lon?: number;
  start: string; // YYYY-MM-DDTHH:mm
  end?: string;
  category?: string;
  guide?: ActivityGuide;
  dateEstimated?: boolean; // the email gave no date; it was inferred (e.g. from the cancellation deadline)
}

export type ItineraryItem = FlightItem | StayItem | ActivityItem;

/** One leg of a scheduled flight, as returned by a flight-number + date lookup. */
export interface FlightScheduleLeg {
  flightNumber: string;
  airline?: string;
  from: string; // IATA
  fromName?: string;
  to: string;
  toName?: string;
  departureTime: string; // scheduled local time, YYYY-MM-DDTHH:mm
  arrivalTime?: string;
  departureTerminal?: string;
  arrivalTerminal?: string;
  aircraft?: string;
  basis?: "weekly"; // from the airline's regular weekly timetable, not a dated flight record
}

export interface FlightLookupResult {
  legs: FlightScheduleLeg[];
  provider: string;
}

// Draft items extracted from an email, before the user saves them.
export type DraftItem =
  | Omit<FlightItem, "id" | "tripId" | "createdAt" | "live" | "changes">
  | Omit<StayItem, "id" | "tripId" | "createdAt">
  | Omit<ActivityItem, "id" | "tripId" | "createdAt">;

export interface EmailParseResult {
  items: DraftItem[];
  parser: "claude" | "heuristic";
  warnings: string[];
}

// ---------- Per-trip forwarding inbox ----------

export interface InboxEmail {
  id: string;
  from?: string;
  subject: string;
  receivedAt: string;
  status: "imported" | "no_bookings" | "error";
  added: number;
  updated: number;
  preview?: string; // first lines, so e.g. a Gmail forwarding-confirmation code is visible
  error?: string;
  canReimport?: boolean;
}

/** What the client sees: never includes the inbox credentials. */
export interface TripInbox {
  address: string;
  provider: "mailtm" | "domain";
  createdAt: string;
  lastCheckedAt?: string;
  pollSeconds: number;
  emails: InboxEmail[];
}

export interface Suggestion {
  title: string;
  description: string;
  category: "logistics" | "productivity" | "food" | "sightseeing" | "wellness" | "packing" | "safety" | "experience";
  day?: string; // YYYY-MM-DD the suggestion applies to
  source: "rules" | "claude";
  /** What to look for on booking sites; the server turns this into links. */
  search?: { kind: "activity" | "stay" | "transfer"; query?: string; checkIn?: string; checkOut?: string };
  links?: Link[]; // GetYourGuide, Viator, Klook, Booking.com, Agoda…
  place?: string; // the city the links search in
}

// ---------- Your own lists ("Mexico Eats", "Mexico Places") ----------

/** Something on a list: a place to go (restaurant, museum…), a thing to try (a dish, a drink), or a thing to do (an activity). */
export interface ListEntry {
  id: string;
  title: string;
  kind: "place" | "thing" | "activity";
  section?: "eat" | "see"; // in destination guides: a restaurant, or a place to visit
  price?: PriceLevel; // restaurants: $ cheap eats · $$ mid-range · $$$ splurge
  notes?: string;
  address?: string;
  area?: string; // neighbourhood, from the map (for grouping nearby places)
  lat?: number;
  lon?: number;
  link?: string; // your own link (a booking, a recommendation)
  links?: Link[]; // where to try it, map, tour searches — from Joy
  done: boolean; // been there / tried it
  day?: string; // YYYY-MM-DD it's planned for
  addedAt: string;
}

export interface TripList {
  id: string;
  tripId: string;
  name: string;
  emoji: string;
  auto?: boolean; // a destination guide Joy made for one of your cities
  place?: TripPlace; // what it's about (Mexico, Mexico City…); none = anywhere on the trip
  entries: ListEntry[];
  dismissed?: string[]; // suggestion titles you said no to
  createdAt: string;
}

/** How pricey a restaurant is, for that city: 1 = $ cheap eats, 2 = $$ mid-range, 3 = $$$ splurge. */
export type PriceLevel = 1 | 2 | 3;

export interface ListSuggestion {
  title: string;
  kind: "place" | "thing" | "activity";
  style?: TravelStyle; // for "things to do for your style"
  price?: PriceLevel;
  detail?: string;
  city?: string;
  links?: Link[];
  tag?: string; // e.g. "Christmas", "Day trip", "Book ahead"
  source: "rules" | "claude";
}

/** Places from your lists that are close together, so one day can cover them. */
export interface AreaGroup {
  area: string;
  city?: string;
  entries: (ListEntry & { listId: string; listEmoji: string; listName: string })[];
  suggestedDays: string[]; // days you're nearby with little else on
  routeUrl?: string; // Google Maps directions through them, in walking order
}

// ---------- Nearby essentials (per stay) ----------

export type EssentialKind = "pharmacy" | "hospital" | "clinic" | "police" | "atm";

export interface EssentialPlace {
  name: string;
  kind: EssentialKind;
  address?: string;
  lat: number;
  lon: number;
  km: number; // straight-line distance from the stay
  open247?: boolean;
  phone?: string;
}

export interface StayEssentials {
  stayId: string;
  stayName: string;
  located: "exact" | "approximate" | "not-found";
  places: Record<EssentialKind, EssentialPlace[]>;
  directionsFrom?: string; // "lat,lon" of the stay, for map directions
}

export interface Essentials {
  emergency?: { number: string; note?: string };
  stays: StayEssentials[];
}
