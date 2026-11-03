import "./env.ts";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { TRAVEL_PARTIES, TRAVEL_STYLES, TRIP_PURPOSES, type ListEntry, type Trip } from "../shared/types.ts";
import { aiEnabled } from "./ai.ts";
import { getAirport, searchAirports } from "./airports.ts";
import { describePlaces, matchDestination, searchPlaces } from "./places.ts";
import { getRates } from "./fx.ts";
import { buildPrep } from "./prep.ts";
import { essentialsFor } from "./essentials.ts";
import { areaGroups, dayPlans, ensureGuides, guideStays, guideSuggestions, listPlaceOptions, listSuggestions, locateEntry } from "./lists.ts";
import { positionOn, propertiesAt, searchLodging } from "./lodging.ts";
import { tripPlaces } from "./tripPlaces.ts";
import { stopWeather } from "./weather.ts";
import { AirLabsError } from "./airlabs.ts";
import { AviationstackError } from "./aviationstack.ts";
import { FLIGHT_PROVIDERS, flightServices, saveSettings, settings, usage } from "./settings.ts";
import { dropEmptyAttachments, getAttachment, MAX_ATTACHMENT_BYTES, pruneAttachments, storeAttachment } from "./attachmentStore.ts";
import { attachmentsText, relevantAttachments } from "./attachments.ts";
import { db, itemStart, newId, now, save } from "./db.ts";
import { normaliseFlightNumber, parseEmail } from "./emailParser.ts";
import { FlightDataError, getProvider, lookupSchedule, serviceProvider, refreshDueFlights, refreshFlight, simulateChange, startFlightPoller } from "./flightStatus.ts";
import { checkInbox, createInbox, reimportEmail, deleteInbox, getInbox, inboxForRecipients, inboxView, processEmail, startInboxPoller } from "./inbox.ts";
import { createItem, ItemInput, opt, upsertFromEmail } from "./items.ts";
import { addBookingLinks } from "./bookingLinks.ts";
import { claudeSuggestions, ruleSuggestions } from "./suggestions.ts";

const app = express();
// No CORS: the UI reaches the API through the Vite proxy (same origin), and other websites must not read or change data.
app.use(express.json({ limit: "40mb" })); // room for base64 PDF attachments

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const PlaceInput = z.object({
  type: z.enum(["country", "region", "city"]),
  name: z.string().trim().min(1).max(120),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().max(120).optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const TripInput = z.object({
  name: z.string().trim().min(1),
  destination: z.string().trim().default(""),
  places: z
    .array(
      z.object({
        type: z.enum(["country", "region", "city"]),
        name: z.string().trim().min(1).max(120),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        region: z.string().max(120).optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
      }),
    )
    .max(20)
    .optional(),
  parts: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        name: z.string().trim().min(1, "Give each part a name").max(80),
        from: date,
        to: date,
        party: z.enum(TRAVEL_PARTIES),
        companions: opt,
        kids: z.enum(["none", "some", "all"]).optional(),
        stayingWithHosts: z.boolean().optional(),
      }),
    )
    .max(12)
    .optional()
    .transform((parts) => parts?.slice().sort((a, b) => a.from.localeCompare(b.from))),
  startDate: date,
  endDate: date,
  purpose: z.enum(TRIP_PURPOSES),
  party: z.enum(TRAVEL_PARTIES),
  styles: z.array(z.enum(TRAVEL_STYLES)).default([]),
  notes: opt,
});

const getTrip = (id: string) => db.trips.find((t) => t.id === id);
const getItem = (id: string) => db.items.find((i) => i.id === id);
const tripItems = (tripId: string) =>
  db.items.filter((i) => i.tripId === tripId).sort((a, b) => itemStart(a).localeCompare(itemStart(b)));

// ---------- Trips ----------

/** Validated trip fields; the display destination comes from the chosen places when there are any. */
function tripInput(body: unknown) {
  const input = TripInput.parse(body);
  const destination = input.places?.length ? describePlaces(input.places) : input.destination;
  for (const [i, p] of (input.parts ?? []).entries()) {
    const problem =
      p.to < p.from ? `"${p.name}" ends before it starts`
      : p.from < input.startDate || p.to > input.endDate ? `"${p.name}" must be within the trip's dates`
      : i > 0 && p.from <= input.parts![i - 1].to ? `"${p.name}" overlaps "${input.parts![i - 1].name}"`
      : undefined;
    if (problem) throw new z.ZodError([{ code: "custom", path: ["parts"], message: problem, input: undefined }]);
  }
  if (!destination) throw new z.ZodError([{ code: "custom", path: ["destination"], message: "Choose at least one destination", input: undefined }]);
  return { ...input, destination };
}

app.get("/api/health", (_req, res) => {
  res.json({ ai: aiEnabled(), flightProvider: getProvider().name, flightServices: flightServices().map((c) => c.provider) });
});

app.get("/api/trips", (_req, res) => {
  res.json(
    [...db.trips]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((t) => ({ ...t, itemCount: db.items.filter((i) => i.tripId === t.id).length })),
  );
});

app.post("/api/trips", (req, res) => {
  const trip: Trip = { ...tripInput(req.body), id: newId(), createdAt: now() };
  db.trips.push(trip);
  save();
  res.status(201).json(trip);
});

app.get("/api/trips/:id", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json({ trip, items: tripItems(trip.id) });
});

app.put("/api/trips/:id", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  Object.assign(trip, tripInput(req.body));
  save();
  res.json(trip);
});

app.delete("/api/trips/:id", async (req, res) => {
  await deleteInbox(req.params.id);
  db.trips = db.trips.filter((t) => t.id !== req.params.id);
  db.items = db.items.filter((i) => i.tripId !== req.params.id);
  db.lists = db.lists.filter((l) => l.tripId !== req.params.id);
  save();
  pruneAttachments();
  res.status(204).end();
});

// ---------- Itinerary items ----------

app.post("/api/trips/:id/items", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const inputs = z.array(ItemInput).parse(Array.isArray(req.body) ? req.body : [req.body]);
  const created = inputs.map((i) => createItem(trip.id, i));
  db.items.push(...created);
  save();
  // Get live status straight away for new flights (best effort).
  await Promise.allSettled(created.filter((i) => i.kind === "flight").map((f) => refreshFlight(f)));
  res.status(201).json(created);
});

app.put("/api/items/:id", async (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return void res.status(404).json({ error: "Item not found" });
  const input = ItemInput.parse({ ...req.body, kind: item.kind });
  const flightChanged =
    item.kind === "flight" && input.kind === "flight" &&
    (item.flightNumber !== input.flightNumber || item.departureTime.slice(0, 10) !== input.departureTime.slice(0, 10));
  Object.assign(item, input);
  if (item.kind === "flight" && flightChanged) {
    item.live = undefined;
    item.changes = [];
    await refreshFlight(item).catch(() => {});
  }
  save();
  res.json(item);
});

app.delete("/api/items/:id", (req, res) => {
  db.items = db.items.filter((i) => i.id !== req.params.id);
  save();
  pruneAttachments();
  res.status(204).end();
});

// ---------- Attachments (tickets, vouchers, itineraries) ----------

app.get("/api/attachments/:id", (req, res) => {
  const a = getAttachment(req.params.id);
  if (!a) return void res.status(404).json({ error: "File not found" });
  // Only PDFs and raster images open in the browser; anything else (e.g. HTML/SVG, which could run scripts) downloads.
  const viewable = /^(?:application\/pdf|image\/(?:png|jpe?g|gif|webp))$/i.test(a.contentType);
  res.setHeader("Content-Type", viewable ? a.contentType : "application/octet-stream");
  res.setHeader("Content-Disposition", `${viewable ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(a.path);
});

app.post("/api/items/:id/attachments", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return void res.status(404).json({ error: "Item not found" });
  const { filename, contentType, data } = AttachmentInput.parse(req.body);
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return void res.status(413).json({ error: "Files must be 15 MB or smaller" });
  const stored = storeAttachment({ filename, contentType, data: bytes });
  item.attachments = [...(item.attachments ?? []), stored];
  save();
  res.status(201).json(item);
});

app.delete("/api/items/:id/attachments/:attachmentId", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return void res.status(404).json({ error: "Item not found" });
  item.attachments = item.attachments?.filter((a) => a.id !== req.params.attachmentId);
  if (!item.attachments?.length) item.attachments = undefined;
  save();
  pruneAttachments();
  res.json(item);
});

// ---------- Email import ----------

const AttachmentInput = z.object({ filename: z.string(), contentType: z.string().default("application/pdf"), data: z.string() });
const decodeAttachments = (list: z.infer<typeof AttachmentInput>[]) =>
  list.map((a) => ({ filename: a.filename, contentType: a.contentType, data: new Uint8Array(Buffer.from(a.data, "base64")) }));

// Pasted email text and/or uploaded files (PDF itineraries, e-tickets).
app.post("/api/parse-email", async (req, res) => {
  const { email, tripId, attachments } = z
    .object({ email: z.string().default(""), tripId: z.string().optional(), attachments: z.array(AttachmentInput).max(5).default([]) })
    .refine((b) => b.email.trim().length >= 10 || b.attachments.length > 0, "Paste an email or upload a PDF")
    .parse(req.body);
  const files = decodeAttachments(attachments);
  const text = email + (await attachmentsText(files));
  if (!text.trim()) return void res.json({ items: [], parser: "heuristic", warnings: ["Couldn't read any text from that PDF (it may be a scanned image)."] });
  const result = await parseEmail(text, tripId ? getTrip(tripId) : undefined);
  // Keep uploaded tickets/itineraries with the bookings found in them (nothing to keep them with otherwise).
  if (result.items.length) {
    const stored = relevantAttachments(files).map((f) => storeAttachment(f));
    for (const item of result.items) item.attachments = [...(item.attachments ?? []), ...stored];
  }
  res.json(result);
});

// Per-trip forwarding address. Emails sent to it are parsed and loaded into the trip.
app.get("/api/trips/:id/inbox", (req, res) => {
  const inbox = getInbox(req.params.id);
  res.json(inbox ? inboxView(inbox) : null);
});

app.post("/api/trips/:id/inbox", async (req, res) => {
  if (!getTrip(req.params.id)) return void res.status(404).json({ error: "Trip not found" });
  try {
    res.status(201).json(inboxView(await createInbox(req.params.id)));
  } catch (err) {
    res.status(502).json({ error: `Couldn't create a forwarding address: ${(err as Error).message}` });
  }
});

app.post("/api/trips/:id/inbox/check", async (req, res) => {
  const inbox = getInbox(req.params.id);
  if (!inbox) return void res.status(404).json({ error: "No forwarding address for this trip" });
  try {
    const received = await checkInbox(inbox);
    res.json({ inbox: inboxView(inbox), received: received.length });
  } catch (err) {
    res.status(502).json({ error: `Couldn't check the inbox: ${(err as Error).message}` });
  }
});

app.post("/api/trips/:id/inbox/emails/:emailId/reimport", async (req, res) => {
  const inbox = getInbox(req.params.id);
  if (!inbox) return void res.status(404).json({ error: "No forwarding address for this trip" });
  try {
    const email = await reimportEmail(inbox, req.params.emailId);
    res.json({ email, inbox: inboxView(inbox) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.delete("/api/trips/:id/inbox", async (req, res) => {
  await deleteInbox(req.params.id);
  res.status(204).end();
});

/**
 * Webhook for inbound email providers (Postmark, Mailgun, SendGrid inbound parse, Cloudflare Email Workers).
 * Mail to a trip address (trip-<token>@INBOUND_EMAIL_DOMAIN) loads into that trip; anything else is matched
 * to a trip by date. Requires ?token=INBOUND_EMAIL_SECRET.
 */
app.post("/api/inbound-email", express.urlencoded({ extended: true, limit: "10mb" }), async (req, res) => {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || req.query.token !== secret) return void res.status(401).json({ error: "Unauthorized" });
  const body = req.body as Record<string, unknown>;
  const str = (...keys: string[]) => keys.map((k) => body[k]).find((v): v is string => typeof v === "string" && v.length > 0);
  const subject = str("subject", "Subject") ?? "";
  const from = str("from", "From", "sender");
  // Postmark-style JSON attachments: [{ Name, ContentType, Content (base64) }]
  const rawAttachments = Array.isArray(body.Attachments) ? (body.Attachments as Record<string, string>[]) : [];
  const files = relevantAttachments(
    rawAttachments.map((a) => ({ filename: a.Name ?? "", contentType: a.ContentType ?? "", data: new Uint8Array(Buffer.from(a.Content ?? "", "base64")) })),
  );
  const attached = await attachmentsText(files);
  const text = (str("text", "TextBody", "body-plain", "plain") ?? str("html", "HtmlBody", "body-html") ?? "") + attached;
  const recipients = [str("OriginalRecipient", "To", "to", "recipient"), JSON.stringify(body.envelope ?? "")].join(" ");

  const inbox = inboxForRecipients(recipients);
  if (inbox) {
    const entry = await processEmail(inbox, { id: str("MessageID", "Message-Id", "message-id") ?? crypto.randomUUID(), from, subject, body: text, files });
    return void res.json(entry);
  }
  // No trip address: place each booking in the trip whose dates contain it.
  const result = await parseEmail(`Subject: ${subject}

${text}`);
  let added = 0, unmatched = 0;
  for (const draft of result.items) {
    const parsed = ItemInput.safeParse(draft);
    const start = parsed.success ? itemStart(createItem("", parsed.data)).slice(0, 10) : "";
    const trip = db.trips.find((t) => t.startDate <= start && t.endDate >= start);
    if (!trip) { unmatched++; continue; }
    added += (await upsertFromEmail(trip.id, [draft])).added;
  }
  res.json({ added, unmatched });
});

// ---------- Flight status ----------

// ---------- Airports ----------

app.get("/api/airports", (req, res) => {
  const q = z.string().max(60).default("").parse(req.query.q);
  res.json(searchAirports(q));
});

app.get("/api/airports/:code", (req, res) => {
  const airport = getAirport(req.params.code);
  if (!airport) return void res.status(404).json({ error: "Unknown airport code" });
  res.json(airport);
});

// ---------- Prepare: weather, before-you-go checklist, packing list ----------

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

app.get("/api/trips/:id/prep", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const items = tripItems(trip.id);
  const places = tripPlaces(trip, items);
  const weather = await Promise.all(
    places.stops.map((s) =>
      stopWeather(s).catch((err) => {
        console.warn(`Weather for ${s.city} unavailable:`, (err as Error).message);
        return null;
      }),
    ),
  );
  const ok = weather.filter((w) => w !== null);
  const home = settings.homeCountry;
  const { todo, packing } = buildPrep(trip, items, places, ok, home ?? places.homeCountry, countryName);
  res.json({
    stops: places.stops.map((s, i) => ({ ...s, weather: weather[i] })),
    transits: places.transits,
    homeCountry: home ?? null,
    homeCountryGuess: places.homeCountry ?? null,
    todo,
    packing,
    custom: trip.prep?.custom ?? [],
    checked: trip.prep?.checked ?? [],
  });
});

app.put("/api/trips/:id/prep/check", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { id, checked } = z.object({ id: z.string().min(1).max(200), checked: z.boolean() }).parse(req.body);
  const prep = (trip.prep ??= { checked: [], custom: [] });
  prep.checked = checked ? [...new Set([...prep.checked, id])] : prep.checked.filter((x) => x !== id);
  save();
  res.json({ checked: prep.checked });
});

app.post("/api/trips/:id/prep/custom", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { section, text } = z.object({ section: z.enum(["todo", "packing"]), text: z.string().trim().min(1).max(200) }).parse(req.body);
  const prep = (trip.prep ??= { checked: [], custom: [] });
  const item = { id: `custom:${newId()}`, section, group: "Your items", text, custom: true };
  prep.custom.push(item);
  save();
  res.status(201).json(item);
});

app.delete("/api/trips/:id/prep/custom/:itemId", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip?.prep) return void res.status(404).json({ error: "Not found" });
  trip.prep.custom = trip.prep.custom.filter((c) => c.id !== req.params.itemId);
  trip.prep.checked = trip.prep.checked.filter((c) => c !== req.params.itemId);
  save();
  res.status(204).end();
});

app.put("/api/settings/home-country", (req, res) => {
  const { country } = z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/) }).parse(req.body);
  settings.homeCountry = country;
  saveSettings();
  res.json({ homeCountry: country });
});

// ---------- Destinations ----------

app.get("/api/places", (req, res) => {
  const q = z.string().max(80).default("").parse(req.query.q);
  res.json(searchPlaces(q));
});

app.get("/api/places/match", (req, res) => {
  const text = z.string().max(300).default("").parse(req.query.text);
  res.json(matchDestination(text));
});

// ---------- Accommodation lookup (property ↔ address) ----------

app.get("/api/lodging/search", async (req, res) => {
  const { q, tripId, date, scope, lat, lon } = z
    .object({
      q: z.string().max(120).default(""),
      tripId: z.string().optional(),
      date: z.string().optional(),
      scope: z.enum(["lodging", "any"]).default("lodging"),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lon: z.coerce.number().min(-180).max(180).optional(),
    })
    .parse(req.query);
  const trip = tripId ? getTrip(tripId) : undefined;
  const near =
    lat !== undefined && lon !== undefined ? { lat, lon } : trip ? positionOn(trip, tripItems(trip.id), (date || trip.startDate).slice(0, 10)) : undefined;
  try {
    res.json(await searchLodging(q, near, scope));
  } catch (err) {
    console.warn("Lodging search failed:", (err as Error).message);
    res.json([]);
  }
});

app.get("/api/lodging/at", async (req, res) => {
  const { lat, lon, address } = z
    .object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), address: z.string().max(200).optional() })
    .parse(req.query);
  try {
    res.json(await propertiesAt(lat, lon, address));
  } catch {
    res.json([]);
  }
});

// ---------- Your own lists ----------

const ListInput = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().trim().min(1).max(16).refine((e) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e) && !/[\p{L}\p{N}]{2}/u.test(e), "Choose an emoji for the icon"),
  place: PlaceInput.nullable().optional(),
});
const httpUrl = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "Use an http(s) link");
const EntryInput = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.enum(["place", "thing", "activity"]),
  section: z.enum(["eat", "see"]).optional(),
  notes: z.string().trim().max(2000).optional().transform((s) => s || undefined),
  address: z.string().trim().max(300).optional().transform((s) => s || undefined),
  area: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  link: httpUrl.optional().or(z.literal("").transform(() => undefined)),
  done: z.boolean().optional(),
  day: date.nullable().optional(),
});

const getList = (id: string) => db.lists.find((l) => l.id === id);

app.get("/api/trips/:id/lists", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  // A guide for each city you're staying in, made (and tidied) automatically.
  if (ensureGuides(trip, tripItems(trip.id))) save();
  res.json(db.lists.filter((l) => l.tripId === req.params.id));
});

app.post("/api/trips/:id/lists", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  const input = ListInput.parse(req.body);
  const list = { id: newId(), tripId: trip.id, name: input.name, emoji: input.emoji, place: input.place ?? undefined, entries: [], createdAt: now() };
  db.lists.push(list);
  save();
  res.status(201).json(list);
});

app.patch("/api/lists/:id", (req, res) => {
  const list = getList(req.params.id);
  if (!list) return res.status(404).json({ error: "List not found" });
  const input = ListInput.partial().parse(req.body);
  Object.assign(list, { ...input, place: input.place === undefined ? list.place : input.place ?? undefined });
  save();
  res.json(list);
});

app.delete("/api/lists/:id", (req, res) => {
  if (getList(req.params.id)?.auto) return res.status(400).json({ error: "Destination guides follow your trip and can't be deleted." });
  db.lists = db.lists.filter((l) => l.id !== req.params.id);
  save();
  res.status(204).end();
});

app.post("/api/lists/:id/entries", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  if (!list || !trip) return res.status(404).json({ error: "List not found" });
  const input = EntryInput.parse(req.body);
  let entry: ListEntry = { ...input, day: input.day ?? undefined, id: newId(), done: input.done ?? false, addedAt: now() };
  // Find it on the map (for grouping nearby places) unless it was picked there already.
  entry = await locateEntry(entry, list, trip, tripItems(trip.id)).catch(() => entry);
  list.entries.push(entry);
  save();
  res.status(201).json(entry);
});

app.patch("/api/lists/:id/entries/:entryId", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  const entry = list?.entries.find((e) => e.id === req.params.entryId);
  if (!list || !trip || !entry) return res.status(404).json({ error: "Not found" });
  const input = EntryInput.partial().parse(req.body);
  const moved = input.title !== undefined && input.title !== entry.title && input.lat === undefined;
  Object.assign(entry, { ...input, day: input.day === undefined ? entry.day : input.day ?? undefined });
  // Renamed or changed to a place without picking it on the map: look it up again.
  if (moved || (input.kind === "place" && entry.lat === undefined)) {
    Object.assign(entry, { lat: undefined, lon: undefined, area: undefined });
    Object.assign(entry, await locateEntry(entry, list, trip, tripItems(trip.id)).catch(() => entry));
  }
  save();
  res.json(entry);
});

app.delete("/api/lists/:id/entries/:entryId", (req, res) => {
  const list = getList(req.params.id);
  if (!list) return res.status(404).json({ error: "List not found" });
  list.entries = list.entries.filter((e) => e.id !== req.params.entryId);
  save();
  res.status(204).end();
});

app.post("/api/lists/:id/dismiss", (req, res) => {
  const list = getList(req.params.id);
  if (!list) return res.status(404).json({ error: "List not found" });
  const { title } = z.object({ title: z.string().trim().min(1).max(160) }).parse(req.body);
  list.dismissed = [...new Set([...(list.dismissed ?? []), title])];
  save();
  res.status(204).end();
});

app.get("/api/lists/:id/suggestions", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  if (!list || !trip) return res.status(404).json({ error: "List not found" });
  res.json(list.auto ? guideSuggestions(list, trip, tripItems(trip.id)) : await listSuggestions(list, trip, tripItems(trip.id)));
});

// Pharmacies, hospitals/clinics, police and ATMs near each stay in a guide's city.
app.get("/api/lists/:id/essentials", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  if (!list || !trip || !list.auto) return res.status(404).json({ error: "Guide not found" });
  const items = tripItems(trip.id);
  const p = list.place;
  const near = p?.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : positionOn(trip, items, trip.startDate);
  if (!near) return res.json({ emergency: undefined, stays: [] });
  res.json(await essentialsFor(guideStays(list, trip, items), near, p?.countryCode));
});

app.get("/api/trips/:id/list-places", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  res.json(listPlaceOptions(trip, tripItems(trip.id)));
});

app.get("/api/trips/:id/areas", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  res.json(areaGroups(trip, tripItems(trip.id)));
});

app.get("/api/trips/:id/day-plans", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  res.json(dayPlans(trip, tripItems(trip.id)));
});

/** Plan (or unplan) several list entries for a day at once — "cover this area on Fri 11 Dec". */
app.post("/api/trips/:id/plan-day", (req, res) => {
  const { day, entries } = z
    .object({ day: date.nullable(), entries: z.array(z.object({ listId: z.string(), entryId: z.string() })).max(100) })
    .parse(req.body);
  for (const { listId, entryId } of entries) {
    const entry = getList(listId)?.entries.find((e) => e.id === entryId);
    if (entry && getList(listId)!.tripId === req.params.id) entry.day = day ?? undefined;
  }
  save();
  res.status(204).end();
});

// ---------- Currency ----------

// Exchange rates (cached) plus the currency the user wants totals shown in.
app.get("/api/fx", async (_req, res) => {
  try {
    res.json({ ...(await getRates()), displayCurrency: settings.displayCurrency ?? null });
  } catch {
    res.status(502).json({ error: "Exchange rates are unavailable right now", displayCurrency: settings.displayCurrency ?? null });
  }
});

app.put("/api/settings/display-currency", (req, res) => {
  const { currency } = z.object({ currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/) }).parse(req.body);
  settings.displayCurrency = currency;
  saveSettings();
  res.json({ displayCurrency: currency });
});

// Flight data settings: one key per service; the primary is tried first, the others are fallbacks.
// Keys are never sent back to the browser, only a masked hint.
const flightDataView = () => {
  const services = flightServices();
  return {
    primary: services[0]?.provider ?? null,
    services: FLIGHT_PROVIDERS.map((provider) => {
      const c = services.find((x) => x.provider === provider);
      return {
        provider,
        configured: !!c,
        source: c?.source ?? null,
        route: c?.route ?? null,
        allowHttp: !!c?.allowHttp,
        keyHint: c ? `••••${c.apiKey.slice(-4)}` : null,
        usage: usage(provider),
      };
    }),
  };
};
const ProviderName = z.enum(FLIGHT_PROVIDERS);

app.get("/api/settings/flight-data", (_req, res) => res.json(flightDataView()));

// Add or replace one service's key (other services are kept).
app.put("/api/settings/flight-data", (req, res) => {
  const { provider, route, apiKey, monthlyUnits, allowHttp } = z
    .object({
      provider: ProviderName,
      route: z.enum(["rapidapi", "apimarket", "direct"]).optional(),
      apiKey: z.string().trim().min(10, "That doesn't look like an API key"),
      monthlyUnits: z.coerce.number().int().positive().optional(),
      allowHttp: z.boolean().optional(),
    })
    .parse(req.body);
  const previous = settings.flightServices?.[provider];
  settings.flightServices = {
    ...settings.flightServices,
    [provider]: { apiKey, route: provider === "aerodatabox" ? route ?? "rapidapi" : undefined, monthlyUnits: monthlyUnits ?? previous?.monthlyUnits, allowHttp },
  };
  // The first service you add becomes the primary.
  if (!settings.primary || !flightServices().some((c) => c.provider === settings.primary)) settings.primary = provider;
  saveSettings();
  res.json(flightDataView());
});

// Change a service's allowance or HTTP option, or make it the primary.
app.patch("/api/settings/flight-data", (req, res) => {
  const { provider, monthlyUnits, primary, allowHttp } = z
    .object({
      provider: ProviderName,
      monthlyUnits: z.coerce.number().int().positive().max(10_000_000).optional(),
      primary: z.literal(true).optional(),
      allowHttp: z.boolean().optional(),
    })
    .parse(req.body);
  if (!flightServices().some((c) => c.provider === provider)) return void res.status(400).json({ error: "Add a key for this service first" });
  if (primary) settings.primary = provider;
  if (monthlyUnits !== undefined || allowHttp !== undefined) {
    const current = settings.flightServices?.[provider];
    if (!current) return void res.status(400).json({ error: "This key comes from .env — set its options there, or save the key here." });
    settings.flightServices = { ...settings.flightServices, [provider]: { ...current, ...(monthlyUnits !== undefined && { monthlyUnits }), ...(allowHttp !== undefined && { allowHttp }) } };
  }
  saveSettings();
  res.json(flightDataView());
});

app.delete("/api/settings/flight-data/:provider", (req, res) => {
  const provider = ProviderName.parse(req.params.provider);
  if (settings.flightServices) delete settings.flightServices[provider];
  if (settings.primary === provider) settings.primary = flightServices()[0]?.provider;
  saveSettings();
  res.json(flightDataView());
});

// One real lookup on a single service to confirm its key works: a long-running daily flight, two weeks out
// (today for Aviationstack, whose free plan may not include future schedules, so the test is a single request).
app.post("/api/settings/flight-data/test", async (req, res) => {
  const provider = ProviderName.parse(req.body?.provider);
  const config = flightServices().find((c) => c.provider === provider);
  if (!config) return void res.status(400).json({ error: "Add an API key for this service first" });
  const date = new Date(Date.now() + (provider === "aviationstack" ? 0 : 14) * 86400_000).toISOString().slice(0, 10);
  try {
    const legs = await serviceProvider(config).schedule("BA117", date);
    const sample = legs[0] ? `${legs[0].flightNumber} ${legs[0].from} → ${legs[0].to} on ${date}` : `connected (no BA117 found for ${date})`;
    res.json({ ok: true, sample, ...flightDataView() });
  } catch (err) {
    const known = err instanceof FlightDataError || err instanceof AviationstackError || err instanceof AirLabsError;
    res.status(502).json({ error: known ? (err as Error).message : `Couldn't reach ${provider}: ${(err as Error).message}` });
  }
});

// Scheduled details for a flight number on a date, so the user can confirm instead of typing them.
app.get("/api/flights/lookup", async (req, res) => {
  const { flightNumber, date } = z
    .object({ flightNumber: z.string().min(2).transform(normaliseFlightNumber), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .parse(req.query);
  try {
    res.json(await lookupSchedule(flightNumber, date));
  } catch (err) {
    console.warn("Flight lookup failed:", (err as Error).message);
    const reason =
      err instanceof FlightDataError || err instanceof AviationstackError || err instanceof AirLabsError ? (err as Error).message : "Couldn't look up this flight right now.";
    res.status(502).json({ error: `${reason} You can enter the details manually.` });
  }
});

app.post("/api/trips/:id/refresh-flights", async (req, res) => {
  res.json(await refreshDueFlights({ force: true, tripId: req.params.id }));
});

app.post("/api/items/:id/refresh", async (req, res) => {
  const item = getItem(req.params.id);
  if (item?.kind !== "flight") return void res.status(404).json({ error: "Flight not found" });
  await refreshFlight(item);
  res.json(item);
});

app.post("/api/items/:id/acknowledge", (req, res) => {
  const item = getItem(req.params.id);
  if (item?.kind !== "flight") return void res.status(404).json({ error: "Flight not found" });
  item.changes.forEach((c) => (c.acknowledged = true));
  save();
  res.json(item);
});

// Dev-only: make the mock provider report a delay + gate change.
app.post("/api/items/:id/simulate-change", async (req, res) => {
  const item = getItem(req.params.id);
  if (item?.kind !== "flight") return void res.status(404).json({ error: "Flight not found" });
  if (getProvider().name !== "mock") return void res.status(400).json({ error: "Only available with the mock provider" });
  simulateChange(item);
  await refreshFlight(item);
  res.json(item);
});

app.get("/api/alerts", (_req, res) => {
  const alerts = db.items.flatMap((i) =>
    i.kind === "flight" && i.changes.some((c) => !c.acknowledged)
      ? [{ tripId: i.tripId, itemId: i.id, flightNumber: i.flightNumber, changes: i.changes.filter((c) => !c.acknowledged) }]
      : [],
  );
  res.json(alerts);
});

// ---------- Suggestions ----------

app.get("/api/trips/:id/suggestions", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const items = tripItems(trip.id);
  const rules = ruleSuggestions(trip, items);
  const withLinks = (list: typeof rules) => addBookingLinks(list, trip, items);
  if (req.query.ai !== "1") return void res.json({ suggestions: withLinks(rules), ai: aiEnabled() });
  try {
    const ai = await claudeSuggestions(trip, items);
    // Keep rule-based itinerary warnings (they're grounded in data); let Claude handle the ideas.
    const warnings = rules.filter((s) => s.category === "logistics" || s.category === "safety");
    res.json({ suggestions: withLinks(ai ? [...warnings, ...ai] : rules), ai: aiEnabled() });
  } catch (err) {
    console.warn("Claude suggestions failed:", (err as Error).message);
    res.json({ suggestions: withLinks(rules), ai: aiEnabled(), error: "AI suggestions unavailable right now" });
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, (err?: Error) => {
  // Express 5 calls this even when listening fails. A second copy must not start the pollers: each copy keeps its
  // own in-memory data and saves it to the same file, so they would overwrite each other's changes.
  if (err) {
    console.error(`API port ${port} is already in use — is Hey Joy already running? Exiting so data isn't overwritten.`);
    process.exit(1);
  }
  console.log(`Hey Joy API on http://localhost:${port} (Claude: ${aiEnabled() ? "on" : "off — using rule-based fallbacks"})`);
  const dropped = dropEmptyAttachments();
  if (dropped) console.log(`Removed ${dropped} empty attachment file(s); re-import their emails to attach them again.`);
  pruneAttachments();
  startFlightPoller();
  startInboxPoller();
});
