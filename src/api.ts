import type { PriceLevel, TravellerView, TripRole, Essentials, TravelStyle, AreaGroup, Link, ListEntry, ListSuggestion, TripList, TripPlace, DraftItem, EmailParseResult, FlightChange, FlightLookupResult, ItineraryItem, PrepItem, Suggestion, Trip, TripInbox } from "../shared/types.ts";

/** Tells the app whether it's showing live data or the copy saved on this phone (see public/sw.js). */
export type ConnectionState = { offline: false } | { offline: true; savedAt?: string };
function announce(state: ConnectionState) {
  dispatchEvent(new CustomEvent<ConnectionState>("joy-connection", { detail: state }));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    announce({ offline: true });
    throw new Error(init?.method && init.method !== "GET" ? "You're offline. This change needs a connection to your Mac." : "You're offline and this hasn't been saved on this device yet.");
  }
  const savedAt = res.headers.get("X-Joy-Saved-At");
  announce(savedAt ? { offline: true, savedAt } : { offline: false });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  // Signed out (or the session was removed): the app shows its sign-in screen.
  if (res.status === 401 && body.signIn) dispatchEvent(new Event("joy-signed-out"));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body ? JSON.stringify(body) : undefined });

export type Usage = { used: number; limit: number; month: string };
export type FlightProviderName = "aerodatabox" | "airlabs" | "aviationstack";
export type FlightService = {
  provider: FlightProviderName;
  configured: boolean;
  source: "app" | "env" | null;
  route: "rapidapi" | "apimarket" | "direct" | null;
  allowHttp: boolean;
  keyHint: string | null;
  usage: Usage;
};
export type FlightDataSettings = { primary: FlightProviderName | null; services: FlightService[] };

export type StopWeather = {
  basis: "forecast" | "typical";
  high: number;
  low: number;
  hottest: number;
  coldest: number;
  rainyShare: number;
  summary: string;
  icon: string;
};
export type PrepData = {
  stops: { city: string; country: string; countryCode: string; from: string; to: string; weather: StopWeather | null }[];
  transits: { iata: string; city: string; country: string; countryCode: string; date: string }[];
  homeCountry: string | null;
  homeCountryGuess: string | null;
  todo: PrepItem[];
  packing: PrepItem[];
  custom: PrepItem[];
  checked: string[];
};

export type TripInput = Omit<Trip, "id" | "createdAt">;
export type TripSummary = Trip & { itemCount: number; role: TripRole; ownerName?: string; travellers: number };
export type Me = { id: string; name: string; email: string | null; isAdmin: boolean; hasPassword: boolean };
export type Device = { id: string; device: string; lastSeenAt: string; current: boolean };
export type InviteLink = { name: string; url: string; expiresInDays: number };
export type Travellers = { travellers: TravellerView[]; contacts: { id: string; name: string }[] };
export type Alert = { tripId: string; itemId: string; flightNumber: string; changes: FlightChange[] };

export type LodgingResult = { name?: string; address: string; lat: number; lon: number; kind: "property" | "address"; area?: string };

export type ListSuggestions = {
  theme: string;
  suggestions: ListSuggestion[];
  styles: TravelStyle[];
  styleIdeas: ListSuggestion[];
  finders: Link[];
  ai: boolean;
  guide?: { restaurants: ListSuggestion[]; food: ListSuggestion[]; activities: ListSuggestion[]; sights: ListSuggestion[] };
};
export type DayPlans = Record<string, { entries: AreaGroup["entries"]; routeUrl?: string }>;
export type EntryInput = Partial<Omit<ListEntry, "id" | "addedAt" | "day" | "price">> & { day?: string | null; price?: PriceLevel | null };

export const api = {
  lists: (tripId: string) => request<TripList[]>(`/trips/${tripId}/lists`),
  createList: (tripId: string, body: { name: string; emoji: string; place: TripPlace | null }) => request<TripList>(`/trips/${tripId}/lists`, json("POST", body)),
  updateList: (id: string, body: { name?: string; emoji?: string; place?: TripPlace | null }) => request<TripList>(`/lists/${id}`, json("PATCH", body)),
  deleteList: (id: string) => request<void>(`/lists/${id}`, json("DELETE")),
  addEntry: (listId: string, body: EntryInput) => request<ListEntry>(`/lists/${listId}/entries`, json("POST", body)),
  updateEntry: (listId: string, entryId: string, body: EntryInput) => request<ListEntry>(`/lists/${listId}/entries/${entryId}`, json("PATCH", body)),
  deleteEntry: (listId: string, entryId: string) => request<void>(`/lists/${listId}/entries/${entryId}`, json("DELETE")),
  dismissSuggestion: (listId: string, title: string) => request<void>(`/lists/${listId}/dismiss`, json("POST", { title })),
  essentials: (listId: string) => request<Essentials>(`/lists/${listId}/essentials`),
  listSuggestions: (listId: string) => request<ListSuggestions>(`/lists/${listId}/suggestions`),
  listPlaces: (tripId: string) => request<TripPlace[]>(`/trips/${tripId}/list-places`),
  areas: (tripId: string) => request<AreaGroup[]>(`/trips/${tripId}/areas`),
  dayPlans: (tripId: string) => request<DayPlans>(`/trips/${tripId}/day-plans`),
  planDay: (tripId: string, day: string | null, entries: { listId: string; entryId: string }[]) =>
    request<void>(`/trips/${tripId}/plan-day`, json("POST", { day, entries })),
  searchPlaces: (q: string, near?: { lat: number; lon: number }, tripId?: string) =>
    request<LodgingResult[]>(`/lodging/search?${new URLSearchParams({ q, scope: "any", ...(near ? { lat: String(near.lat), lon: String(near.lon) } : {}), ...(tripId ? { tripId } : {}) })}`),
  searchLodging: (q: string, tripId?: string, date?: string) =>
    request<LodgingResult[]>(`/lodging/search?${new URLSearchParams({ q, ...(tripId ? { tripId } : {}), ...(date ? { date } : {}) })}`),
  lodgingAt: (lat: number, lon: number, address?: string) =>
    request<LodgingResult[]>(`/lodging/at?${new URLSearchParams({ lat: String(lat), lon: String(lon), ...(address ? { address } : {}) })}`),
  health: () => request<{ ai: boolean; flightProvider: string; flightServices: FlightProviderName[] }>("/health"),
  flightData: () => request<FlightDataSettings>("/settings/flight-data"),
  saveFlightData: (body: { provider: FlightProviderName; apiKey: string; route?: string; allowHttp?: boolean }) =>
    request<FlightDataSettings>("/settings/flight-data", json("PUT", body)),
  updateFlightData: (body: { provider: FlightProviderName; monthlyUnits?: number; primary?: true; allowHttp?: boolean }) =>
    request<FlightDataSettings>("/settings/flight-data", json("PATCH", body)),
  removeFlightData: (provider: FlightProviderName) => request<FlightDataSettings>(`/settings/flight-data/${provider}`, json("DELETE")),
  testFlightData: (provider: FlightProviderName) =>
    request<FlightDataSettings & { ok: boolean; sample: string }>("/settings/flight-data/test", json("POST", { provider })),
  fx: () =>
    request<{ base: string; rates: Record<string, number>; updatedAt: string; stale?: boolean; displayCurrency: string | null }>("/fx"),
  setDisplayCurrency: (currency: string) => request<{ displayCurrency: string }>("/settings/display-currency", json("PUT", { currency })),
  prep: (tripId: string) => request<PrepData>(`/trips/${tripId}/prep`),
  checkPrep: (tripId: string, id: string, checked: boolean) =>
    request<{ checked: string[] }>(`/trips/${tripId}/prep/check`, json("PUT", { id, checked })),
  addPrep: (tripId: string, section: "todo" | "packing", text: string) =>
    request<PrepItem>(`/trips/${tripId}/prep/custom`, json("POST", { section, text })),
  deletePrep: (tripId: string, id: string) => request<void>(`/trips/${tripId}/prep/custom/${encodeURIComponent(id)}`, json("DELETE")),
  setHomeCountry: (country: string) => request<{ homeCountry: string }>("/settings/home-country", json("PUT", { country })),
  trips: () => request<TripSummary[]>("/trips"),
  trip: (id: string) => request<{ trip: Trip; items: ItineraryItem[]; role: TripRole }>(`/trips/${id}`),
  pushKey: () => request<{ publicKey: string }>("/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => request<{ ok: true }>("/push/subscribe", json("POST", { subscription })),
  pushUnsubscribe: (endpoint: string) => request<void>("/push/unsubscribe", json("POST", { endpoint })),
  pushTest: () => request<{ sent: number }>("/push/test", json("POST")),
  me: () => request<{ user: Me | null; claimHere: boolean; emailReset: boolean }>("/auth/me"),
  signUp: (body: { name: string; email: string; password: string }) => request<{ user: Me }>("/auth/signup", json("POST", body)),
  signIn: (body: { email: string; password: string }) => request<{ user: Me }>("/auth/signin", json("POST", body)),
  forgot: (email: string) => request<{ ok: true }>("/auth/forgot", json("POST", { email })),
  reset: (token: string, password: string) => request<{ user: Me }>("/auth/reset", json("POST", { token, password })),
  redeem: (token: string) => request<{ user: Me }>("/auth/redeem", json("POST", { token })),
  invite: (token: string) => request<{ tripName: string; invitedBy: string; invitedName?: string }>(`/auth/invite/${token}`),
  acceptInvite: (token: string) => request<{ tripId: string }>("/auth/accept-invite", json("POST", { token })),
  updateMe: (body: { name?: string; email?: string }) => request<{ user: Me }>("/auth/me", json("PATCH", body)),
  changePassword: (current: string | undefined, password: string) => request<{ ok: true }>("/auth/password", json("POST", { current, password })),
  signOut: () => request<void>("/auth/signout", json("POST")),
  devices: () => request<Device[]>("/auth/devices"),
  removeDevice: (id: string) => request<void>(`/auth/devices/${id}`, json("DELETE")),
  deviceLink: () => request<{ url: string; expiresInMinutes: number }>("/auth/device-link", json("POST")),
  travellers: (tripId: string) => request<Travellers>(`/trips/${tripId}/members`),
  addTraveller: (tripId: string, body: { name?: string; userId?: string; role: "editor" | "viewer" }) =>
    request<{ travellers: TravellerView[]; invite: InviteLink | null }>(`/trips/${tripId}/members`, json("POST", body)),
  setTravellerRole: (tripId: string, userId: string, role: "editor" | "viewer") =>
    request<{ travellers: TravellerView[] }>(`/trips/${tripId}/members/${userId}`, json("PATCH", { role })),
  removeTraveller: (tripId: string, userId: string) => request<void>(`/trips/${tripId}/members/${userId}`, json("DELETE")),
  travellerLink: (tripId: string, userId: string) => request<InviteLink>(`/trips/${tripId}/members/${userId}/link`, json("POST")),
  createTrip: (t: TripInput) => request<Trip>("/trips", json("POST", t)),
  updateTrip: (id: string, t: TripInput) => request<Trip>(`/trips/${id}`, json("PUT", t)),
  deleteTrip: (id: string) => request<void>(`/trips/${id}`, json("DELETE")),
  addItems: (tripId: string, items: DraftItem[]) => request<ItineraryItem[]>(`/trips/${tripId}/items`, json("POST", items)),
  updateItem: (id: string, item: DraftItem) => request<ItineraryItem>(`/items/${id}`, json("PUT", item)),
  deleteItem: (id: string) => request<void>(`/items/${id}`, json("DELETE")),
  parseEmail: (email: string, tripId?: string, attachments: { filename: string; contentType: string; data: string }[] = []) =>
    request<EmailParseResult>("/parse-email", json("POST", { email, tripId, attachments })),
  lookupFlight: (flightNumber: string, date: string) =>
    request<FlightLookupResult>(`/flights/lookup?flightNumber=${encodeURIComponent(flightNumber)}&date=${date}`),
  uploadAttachment: (itemId: string, file: { filename: string; contentType: string; data: string }) =>
    request<ItineraryItem>(`/items/${itemId}/attachments`, json("POST", file)),
  removeAttachment: (itemId: string, attachmentId: string) =>
    request<ItineraryItem>(`/items/${itemId}/attachments/${attachmentId}`, json("DELETE")),
  refreshFlights: (tripId: string) => request<{ checked: number; changed: number }>(`/trips/${tripId}/refresh-flights`, json("POST")),
  acknowledge: (id: string) => request<ItineraryItem>(`/items/${id}/acknowledge`, json("POST")),
  simulateChange: (id: string) => request<ItineraryItem>(`/items/${id}/simulate-change`, json("POST")),
  inbox: (tripId: string) => request<TripInbox | null>(`/trips/${tripId}/inbox`),
  createInbox: (tripId: string) => request<TripInbox>(`/trips/${tripId}/inbox`, json("POST")),
  checkInbox: (tripId: string) => request<{ inbox: TripInbox; received: number }>(`/trips/${tripId}/inbox/check`, json("POST")),
  reimportEmail: (tripId: string, emailId: string) =>
    request<{ inbox: TripInbox }>(`/trips/${tripId}/inbox/emails/${encodeURIComponent(emailId)}/reimport`, json("POST")),
  deleteInbox: (tripId: string) => request<void>(`/trips/${tripId}/inbox`, json("DELETE")),
  alerts: () => request<Alert[]>("/alerts"),
  suggestions: (tripId: string, ai: boolean) =>
    request<{ suggestions: Suggestion[]; ai: boolean; error?: string }>(`/trips/${tripId}/suggestions${ai ? "?ai=1" : ""}`),
};

// ---------- Saving a trip for offline use ----------

const savedRecently = new Map<string, number>();

/**
 * Loads everything a trip's screens need, in the background, so the offline worker keeps a copy: itinerary, guides
 * and their essentials, lists, checklist, day plans and ticket files. At most every 15 minutes per trip.
 */
export async function saveTripOffline(tripId: string, items: ItineraryItem[], lists: TripList[]) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  if (Date.now() - (savedRecently.get(tripId) ?? 0) < 15 * 60_000) return;
  savedRecently.set(tripId, Date.now());
  const urls = [
    "/api/health", "/api/fx", "/api/trips",
    `/api/trips/${tripId}`, `/api/trips/${tripId}/lists`, `/api/trips/${tripId}/prep`, `/api/trips/${tripId}/day-plans`,
    `/api/trips/${tripId}/areas`, `/api/trips/${tripId}/suggestions`,
    ...lists.map((l) => `/api/lists/${l.id}/suggestions`),
    ...items.flatMap((i) => (i.attachments ?? []).map((a) => `/api/attachments/${a.id}`)),
    // Last: the first lookup of nearby essentials can take a while.
    ...lists.filter((l) => l.auto).map((l) => `/api/lists/${l.id}/essentials`),
  ];
  for (const url of urls) await fetch(url).catch(() => undefined);
}

/** Signing out also removes this device's offline copy of your trips. */
export async function signOutHere() {
  await api.signOut().catch(() => undefined);
  if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
}
