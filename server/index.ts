import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import "./env.ts";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { EXPENSE_CATEGORIES, TRAVEL_PARTIES, TRAVEL_STYLES, TRIP_PURPOSES, type Expense, type ListEntry, type PrepItem, type TravellerView, type Trip, type TripList, type User } from "../shared/types.ts";
import { listTheme } from "../shared/lists.ts";
import { aiEnabled } from "./ai.ts";
import { askEstela, tripContext } from "./chat.ts";
import { getAirport, searchAirports } from "./airports.ts";
import { describePlaces, matchDestination, searchPlaces } from "./places.ts";
import { getRates } from "./fx.ts";
import { prepGroupFor } from "../shared/prepAdd.ts";
import { buildPrep } from "./prep.ts";
import { describe, describeEntry, fillPhoto, photoDue, recheckDescription } from "./describe.ts";
import { acceptInvite, canSeeAttachment, changePassword, clientAddress, contactsOf, createLink, currentSessionId, findByEmail, guard, invitePreview, needsOwner, normaliseEmail, onThisMac, redeemLink, resetPassword, setUpPeople, signIn, signOut, signUp, tooMany, tripRole, userFrom, userOf } from "./auth.ts";
import { emailConfigured, sendEmail } from "./mailer.ts";
import { notifyUser, pushPublicKey, startReminderLoop, subscribe, unsubscribe } from "./push.ts";
import type { UserRecord } from "./db.ts";
import { essentialsFor } from "./essentials.ts";
import { broadPlaces, exploreIdeas } from "./exploreArea.ts";
import { localApps } from "./localApps.ts";
import { safetyTips } from "./safetyTips.ts";
import { areaGroups, daySuggestions, dayPlans, ensureGuides, entryLinks, fillEntryLinks, guideDays, guideStays, guideSuggestions, listPlaceOptions, listSuggestions, fillPrice, locateEntry } from "./lists.ts";
import { positionOn, propertiesAt, searchLodging } from "./lodging.ts";
import { assumedStops, tripPlaces } from "./tripPlaces.ts";
import { stopWeather } from "./weather.ts";
import { airportZones, dayInfo } from "./dayInfo.ts";
import { tripMap } from "./tripMap.ts";
import { isCommonsPhoto, photosNear, searchPhotos } from "./photos.ts";
import { dayLegs } from "./dayLegs.ts";
import { tripCalendar } from "./calendar.ts";
import { randomBytes } from "node:crypto";
import { AirLabsError } from "./airlabs.ts";
import { AviationstackError } from "./aviationstack.ts";
import { FLIGHT_PROVIDERS, flightServices, saveSettings, settings, usage } from "./settings.ts";
import { dropEmptyAttachments, getAttachment, MAX_ATTACHMENT_BYTES, pruneAttachments, removeIfUnused, storeAttachment } from "./attachmentStore.ts";
import { attachmentsText, relevantAttachments } from "./attachments.ts";
import { db, itemStart, newId, now, save } from "./db.ts";
import { normaliseFlightNumber, parseEmail } from "./emailParser.ts";
import { FlightDataError, getProvider, lookupSchedule, serviceProvider, refreshDueFlights, refreshFlight, simulateChange, startFlightPoller } from "./flightStatus.ts";
import { checkInbox, createInbox, reimportEmail, deleteInbox, getInbox, inboxForRecipients, inboxView, processEmail, startInboxPoller } from "./inbox.ts";
import { createItem, ItemInput, opt, upsertFromEmail, addWhereToPlaces } from "./items.ts";
import { addBookingLinks } from "./bookingLinks.ts";
import { claudeSuggestions, ruleSuggestions } from "./suggestions.ts";

const app = express();
// No CORS: the UI reaches the API through the Vite proxy (same origin), and other websites must not read or change data.
app.use(express.json({ limit: "40mb" })); // room for base64 PDF attachments
// Sign-in and trip access for every API request (see server/auth.ts).
app.use(guard);

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

/** A booking's split only names people on its trip; without a payer or anyone sharing, it isn't split. */
function keepSplitOnTrip<T extends { paidBy?: string; split?: string[] }>(tripId: string, input: T): T {
  const trip = getTrip(tripId);
  const people = trip ? tripPeople(trip) : new Set<string>();
  const split = input.split?.filter((id) => people.has(id));
  const ok = !!input.paidBy && people.has(input.paidBy) && !!split?.length;
  return { ...input, paidBy: ok ? input.paidBy : undefined, split: ok ? split : undefined };
}
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

// ---------- Accounts (see server/auth.ts) ----------

const Token = z.string().min(20).max(100);
const Email = z.string().trim().max(200).email("Enter a valid email address");
const Name = z.string().trim().min(1, "Enter your name").max(40);
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const userView = (u: UserRecord) => ({ id: u.id, name: u.name, email: u.email ?? null, isAdmin: u.isAdmin, hasPassword: !!u.passwordHash, tourPending: !!u.tourPending, homeTimeZone: u.homeTimeZone ?? null });
const fail = (res: Response, r: { error: string; status: number }) => void res.status(r.status).json({ error: r.error });

app.get("/api/auth/me", (req, res) => {
  const user = userOf(req);
  // claimHere: nobody owns Estela yet and this is the Mac it runs on, so signing up here claims it (and its trips).
  res.json({ user: user ? userView(user) : null, claimHere: !user && needsOwner() && onThisMac(req), emailReset: emailConfigured() });
});

app.post("/api/auth/signup", async (req, res) => {
  if (tooMany(`signup:${clientAddress(req)}`, 10, 60)) return void res.status(429).json({ error: "Too many sign-ups from here. Try again later." });
  const input = z.object({ name: Name, email: Email, password: z.string().max(200) }).parse(req.body);
  const r = await signUp(req, res, input);
  if ("error" in r) return fail(res, r);
  res.status(201).json({ user: userView(r.user) });
});

app.post("/api/auth/signin", async (req, res) => {
  const input = z.object({ email: Email, password: z.string().min(1, "Enter your password").max(200) }).parse(req.body);
  const r = await signIn(req, res, input);
  if ("error" in r) return fail(res, r);
  res.json({ user: userView(r.user) });
});

// Forgot password: emails a reset link (valid 1 hour). Always answers the same, so it can't reveal who has an account.
app.post("/api/auth/forgot", async (req, res) => {
  const { email } = z.object({ email: Email }).parse(req.body);
  const user = findByEmail(email);
  if (user && !tooMany(`forgot:${user.id}`, 3, 60) && !tooMany(`forgot-ip:${clientAddress(req)}`, 10, 60)) {
    const url = `${await publicUrl(req)}/#/reset/${createLink("reset", user.id, 60)}`;
    await sendEmail(
      user.email!,
      "Reset your Estela password",
      `Hi ${user.name},\n\nTo choose a new password for Estela, open this link (it works once, for 1 hour):\n${url}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.\n\n— Estela`,
    ).catch((err) => console.warn("Couldn't send reset email:", (err as Error).message));
  }
  res.json({ ok: true });
});

app.post("/api/auth/reset", async (req, res) => {
  const { token, password } = z.object({ token: Token, password: z.string().max(200) }).parse(req.body);
  const r = await resetPassword(req, res, token, password);
  if ("error" in r) return fail(res, r);
  res.json({ user: userView(r.user) });
});

// "Sign in another device" and the owner link from the server log.
app.post("/api/auth/redeem", (req, res) => {
  const r = redeemLink(req, res, z.object({ token: Token }).parse(req.body).token);
  if (!r) return void res.status(400).json({ error: "This link has expired or was already used. Ask for a new one." });
  res.json({ user: userView(r.user) });
});

// An invite: who it's from and which trip (shown before you sign up or in), then joining it.
app.get("/api/auth/invite/:token", (req, res) => {
  const preview = invitePreview(Token.parse(req.params.token));
  if (!preview) return void res.status(404).json({ error: "This invite has expired or was already used. Ask for a new one." });
  res.json(preview);
});

app.post("/api/auth/accept-invite", (req, res) => {
  const r = acceptInvite(userFrom(res), z.object({ token: Token }).parse(req.body).token);
  if ("error" in r) return void res.status(400).json(r);
  res.json(r);
});

// The welcome tour was finished or skipped: it doesn't open again on any device (Help can still show it).
app.post("/api/auth/tour-done", (_req, res) => {
  const user = userFrom(res);
  delete user.tourPending;
  save();
  res.json({ user: userView(user) });
});

app.patch("/api/auth/me", (req, res) => {
  const input = z.object({ name: Name.optional(), email: Email.optional(), homeTimeZone: z.string().max(60).refine(validZone, "Unknown time zone").optional() }).parse(req.body);
  const user = userFrom(res);
  if (input.homeTimeZone) user.homeTimeZone = input.homeTimeZone;
  if (input.email) {
    const email = normaliseEmail(input.email);
    const taken = findByEmail(email);
    if (taken && taken.id !== user.id) return void res.status(409).json({ error: "Another account uses that email" });
    user.email = email;
  }
  if (input.name) user.name = input.name;
  save();
  res.json({ user: userView(user) });
});

app.post("/api/auth/password", async (req, res) => {
  const { current, password } = z.object({ current: z.string().max(200).optional(), password: z.string().max(200) }).parse(req.body);
  const problem = await changePassword(req, userFrom(res), current, password);
  if (problem) return void res.status(400).json({ error: problem });
  res.json({ ok: true });
});

app.post("/api/auth/signout", (req, res) => {
  signOut(req, res);
  res.status(204).end();
});

// Your signed-in devices, and a one-time link to sign in another (valid 15 minutes).
app.get("/api/auth/devices", (req, res) => {
  const me = userFrom(res);
  const current = currentSessionId(req);
  res.json(
    db.sessions
      .filter((s) => s.userId === me.id)
      .map((s) => ({ id: s.id.slice(0, 12), device: s.device, lastSeenAt: s.lastSeenAt, current: s.id === current })),
  );
});

app.delete("/api/auth/devices/:id", (req, res) => {
  const me = userFrom(res);
  db.sessions = db.sessions.filter((s) => !(s.userId === me.id && s.id.startsWith(req.params.id) && req.params.id.length === 12));
  save();
  res.status(204).end();
});

app.post("/api/auth/device-link", async (req, res) => {
  const token = createLink("device", userFrom(res).id, 15);
  res.json({ url: `${await publicUrl(req)}/#/signin/${token}`, expiresInMinutes: 15 });
});

// ---------- Travellers on a trip ----------

const travellers = (trip: Trip, me: User): TravellerView[] =>
  [{ userId: trip.ownerId!, role: "owner" as const }, ...(trip.members ?? [])].flatMap((m) => {
    const u = db.users.find((x) => x.id === m.userId);
    if (!u) return [];
    const lastSeenAt = db.sessions.filter((s) => s.userId === u.id).map((s) => s.lastSeenAt).sort().at(-1);
    return [{ userId: u.id, name: u.name, role: m.role, signedIn: !(u as UserRecord).placeholder, lastSeenAt, you: u.id === me.id }];
  });

app.get("/api/trips/:id/members", (req, res) => {
  const trip = getTrip(req.params.id)!;
  const me = userFrom(res);
  // People you've travelled with before, to add without a new link.
  const contacts = res.locals.role === "owner" ? contactsOf(me).filter((u) => !travellers(trip, me).some((t) => t.userId === u.id)) : [];
  res.json({ travellers: travellers(trip, me), contacts: contacts.map((u) => ({ id: u.id, name: u.name })) });
});

app.post("/api/trips/:id/members", async (req, res) => {
  const trip = getTrip(req.params.id)!;
  const me = userFrom(res);
  const input = z
    .object({ name: z.string().trim().min(1).max(40).optional(), userId: z.string().optional(), role: z.enum(["editor", "viewer"]) })
    .refine((b) => b.name || b.userId, "Enter their name")
    .parse(req.body);
  let user: User | undefined;
  if (input.userId) {
    // Only people you already share a trip with (so ids can't be guessed to reach strangers' accounts).
    user = contactsOf(me).find((u) => u.id === input.userId);
    if (!user) return void res.status(404).json({ error: "Person not found" });
  } else {
    // Stands in for them until they open the invite and create (or sign in to) their account.
    user = { id: newId(), name: input.name!, isAdmin: false, placeholder: true, createdAt: now() } as UserRecord;
    db.users.push(user as UserRecord);
  }
  if (user.id === trip.ownerId || trip.members?.some((m) => m.userId === user!.id)) return void res.status(409).json({ error: `${user.name} is already on this trip` });
  trip.members = [...(trip.members ?? []), { userId: user.id, role: input.role, addedAt: now() }];
  save();
  // New people get an invite link to join; people who already have an account just see the trip appear.
  const url = (user as UserRecord).placeholder ? `${await publicUrl(req)}/#/invite/${createLink("invite", user.id, 7 * 24 * 60, trip.id)}` : null;
  res.status(201).json({ travellers: travellers(trip, me), invite: url ? { name: user.name, url, expiresInDays: 7 } : null });
});

app.patch("/api/trips/:id/members/:userId", (req, res) => {
  const trip = getTrip(req.params.id)!;
  const { role } = z.object({ role: z.enum(["editor", "viewer"]) }).parse(req.body);
  const member = trip.members?.find((m) => m.userId === req.params.userId);
  if (!member) return void res.status(404).json({ error: "Not on this trip" });
  member.role = role;
  save();
  res.json({ travellers: travellers(trip, userFrom(res)) });
});

// The owner removes someone, or someone leaves.
app.delete("/api/trips/:id/members/:userId", (req, res) => {
  const trip = getTrip(req.params.id)!;
  const me = userFrom(res);
  const who = req.params.userId === "me" ? me.id : req.params.userId; // "me": leaving
  if (res.locals.role !== "owner" && who !== me.id) return void res.status(403).json({ error: "Only the trip's owner can do that" });
  if (who === trip.ownerId) return void res.status(400).json({ error: "The owner can't leave their own trip (delete it instead)" });
  trip.members = (trip.members ?? []).filter((m) => m.userId !== who);
  db.invites = db.invites.filter((i) => !(i.userId === who && i.tripId === trip.id));
  save();
  res.status(204).end();
});

// A fresh link for someone on the trip (lost the first one, or a new phone). Replaces any unused one.
app.post("/api/trips/:id/members/:userId/link", async (req, res) => {
  const trip = getTrip(req.params.id)!;
  const member = trip.members?.find((m) => m.userId === req.params.userId);
  const user = member && db.users.find((u) => u.id === member.userId);
  if (!user) return void res.status(404).json({ error: "Not on this trip" });
  if (!(user as UserRecord).placeholder) return void res.status(400).json({ error: `${user.name} has already joined` });
  res.json({ name: user.name, url: `${await publicUrl(req)}/#/invite/${createLink("invite", user.id, 7 * 24 * 60, trip.id)}`, expiresInDays: 7 });
});

// Only the trips you own or were added to.
app.get("/api/trips", (_req, res) => {
  const user = userFrom(res);
  res.json(
    db.trips
      .map((t) => ({ t, role: tripRole(user, t) }))
      .filter(({ role }) => role)
      .sort((a, b) => a.t.startDate.localeCompare(b.t.startDate))
      .map(({ t, role }) => ({
        ...t,
        role,
        ownerName: db.users.find((u) => u.id === t.ownerId)?.name,
        travellers: 1 + (t.members?.length ?? 0),
        itemCount: db.items.filter((i) => i.tripId === t.id).length,
      })),
  );
});

app.post("/api/trips", (req, res) => {
  const trip: Trip = { ...tripInput(req.body), id: newId(), ownerId: userFrom(res).id, members: [], createdAt: now() };
  db.trips.push(trip);
  save();
  res.status(201).json(trip);
});

app.get("/api/trips/:id", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json({ trip, items: tripItems(trip.id), role: res.locals.role });
});

app.put("/api/trips/:id", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  Object.assign(trip, tripInput(req.body));
  save();
  res.json(trip);
});

// Your own heading or note for a day of the itinerary. An empty one removes it.
for (const [path, field, max] of [["day-title", "dayTitles", 80], ["day-note", "dayNotes", 2000]] as const) {
  app.put(`/api/trips/:id/${path}`, (req, res) => {
    const trip = getTrip(req.params.id);
    if (!trip) return void res.status(404).json({ error: "Trip not found" });
    const { day, text } = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().trim().max(max) }).parse(req.body);
    const byDay = { ...trip[field] };
    if (text) byDay[day] = text;
    else delete byDay[day];
    trip[field] = Object.keys(byDay).length ? byDay : undefined;
    save();
    res.json(trip[field] ?? {});
  });
}

// ---------- Spending during the trip, and a budget ----------

const MoneyInput = z.object({ amount: z.number().positive().max(100_000_000), currency: z.string().regex(/^[A-Z]{3}$/) });
const ExpenseInput = z.object({
  title: z.string().trim().min(1, "Say what it was").max(120),
  amount: MoneyInput,
  day: date,
  category: z.enum(EXPENSE_CATEGORIES),
  paidBy: z.string().min(1),
  split: z.array(z.string().min(1)).min(1, "Choose who it's shared by").max(30),
});
const tripPeople = (trip: Trip) =>
  new Set([trip.ownerId, ...(trip.members ?? []).map((m) => m.userId), ...(trip.spendPeople ?? []).map((p) => p.id)].filter(Boolean) as string[]);
function expenseInput(trip: Trip, body: unknown) {
  const input = ExpenseInput.parse(body);
  const people = tripPeople(trip);
  if (!people.has(input.paidBy) || input.split.some((id) => !people.has(id))) throw new z.ZodError([{ code: "custom", path: ["split"], message: "Only people on this trip", input: undefined }]);
  return { ...input, split: [...new Set(input.split)] };
}

app.post("/api/trips/:id/expenses", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const expense: Expense = { ...expenseInput(trip, req.body), id: newId(), addedBy: userFrom(res).id, createdAt: now() };
  trip.expenses = [...(trip.expenses ?? []), expense];
  save();
  res.status(201).json(expense);
});

app.put("/api/trips/:id/expenses/:expenseId", (req, res) => {
  const trip = getTrip(req.params.id);
  const expense = trip?.expenses?.find((e) => e.id === req.params.expenseId);
  if (!trip || !expense) return void res.status(404).json({ error: "Not found" });
  Object.assign(expense, expenseInput(trip, req.body));
  save();
  res.json(expense);
});

app.delete("/api/trips/:id/expenses/:expenseId", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  trip.expenses = trip.expenses?.filter((e) => e.id !== req.params.expenseId);
  if (!trip.expenses?.length) delete trip.expenses;
  save();
  res.status(204).end();
});

// Trip-mates who don't use Estela: names to share costs with (they can't sign in or see the trip).
app.post("/api/trips/:id/spend-people", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { name } = z.object({ name: z.string().trim().min(1, "Add their name").max(40) }).parse(req.body);
  const person = { id: `p_${newId()}`, name };
  trip.spendPeople = [...(trip.spendPeople ?? []), person].slice(0, 30);
  save();
  res.status(201).json(person);
});

app.delete("/api/trips/:id/spend-people/:personId", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const id = req.params.personId;
  const inUse = trip.expenses?.some((e) => e.paidBy === id || e.split.includes(id)) || tripItems(trip.id).some((i) => i.paidBy === id || i.split?.includes(id));
  if (inUse) return void res.status(409).json({ error: "They're part of some of your spending or a split booking. Take them off those first." });
  trip.spendPeople = trip.spendPeople?.filter((p) => p.id !== id);
  if (!trip.spendPeople?.length) delete trip.spendPeople;
  save();
  res.status(204).end();
});

app.put("/api/trips/:id/budget", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { budget } = z.object({ budget: MoneyInput.nullable() }).parse(req.body);
  if (budget) trip.budget = budget;
  else delete trip.budget;
  save();
  res.json({ budget: trip.budget ?? null });
});

// How you get around on this trip, beyond walking distance: public transport or a car.
app.put("/api/trips/:id/get-around", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  trip.getAround = z.object({ mode: z.enum(["transit", "car"]) }).parse(req.body).mode;
  save();
  res.json({ getAround: trip.getAround });
});

// Two stays on the same nights: which is your base (for those nights).
app.put("/api/trips/:id/night-stay", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { days, stayId } = z.object({ days: z.array(date).min(1).max(60), stayId: z.string() }).parse(req.body);
  const stay = db.items.find((i) => i.id === stayId && i.tripId === trip.id && i.kind === "stay");
  if (!stay) return void res.status(400).json({ error: "That stay isn't on this trip" });
  trip.nightStay = { ...trip.nightStay };
  for (const d of days) trip.nightStay[d] = stayId;
  save();
  res.json(trip.nightStay);
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
  const inputs = z.array(ItemInput).parse(Array.isArray(req.body) ? req.body : [req.body]).map((i) => keepSplitOnTrip(trip.id, i));
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
  const input = keepSplitOnTrip(item.tripId, ItemInput.parse({ ...req.body, kind: item.kind }));
  const flightChanged =
    item.kind === "flight" && input.kind === "flight" &&
    (item.flightNumber !== input.flightNumber || item.departureTime.slice(0, 10) !== input.departureTime.slice(0, 10));
  Object.assign(item, input);
  if (item.kind === "activity") addWhereToPlaces(item);
  if (item.kind === "flight" && flightChanged) {
    item.live = undefined;
    item.changes = [];
    await refreshFlight(item).catch(() => {});
  }
  save();
  res.json(item);
});

// Who paid for a booking and who shares it (from Spending), or not split (null).
app.put("/api/items/:id/split", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return void res.status(404).json({ error: "Item not found" });
  const { split } = z.object({ split: z.object({ paidBy: z.string(), split: z.array(z.string()).min(1).max(30) }).nullable() }).parse(req.body);
  const kept = split && keepSplitOnTrip(item.tripId, { ...split });
  item.paidBy = kept?.paidBy;
  item.split = kept?.split;
  save();
  res.json(item);
});

// Just a booking's price (from Spending), leaving everything else as it is.
app.put("/api/items/:id/price", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return void res.status(404).json({ error: "Item not found" });
  const { price } = z.object({ price: z.object({ amount: z.number().positive().max(100_000_000), currency: z.string().regex(/^[A-Z]{3}$/) }).nullable() }).parse(req.body);
  item.price = price ?? undefined;
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
  if (!a || !canSeeAttachment(userFrom(res), a.id)) return void res.status(404).json({ error: "File not found" });
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
  const stored = storeAttachment({ filename, contentType, data: bytes }, undefined, userFrom(res).id);
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
    const stored = relevantAttachments(files).map((f) => storeAttachment(f, undefined, userFrom(res).id));
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
  // No city known yet: typical weather for the country's largest city (the page says so).
  const weatherStops = places.stops.length ? places.stops : assumedStops(trip);
  const weather = await Promise.all(
    weatherStops.map((s) =>
      stopWeather(s).catch((err) => {
        console.warn(`Weather for ${s.city} unavailable:`, (err as Error).message);
        return null;
      }),
    ),
  );
  const ok = weather.filter((w) => w !== null);
  // Your own home country (the admin's was an app-wide setting before sign-in existed).
  const user = userFrom(res);
  const home = user.homeCountry ?? (user.isAdmin ? settings.homeCountry : undefined);
  const { todo, packing } = buildPrep(trip, items, places, ok, home ?? places.homeCountry, countryName);
  res.json({
    stops: weatherStops.map((s, i) => ({ ...s, weather: weather[i] })),
    transits: places.transits,
    homeCountry: home ?? null,
    homeCountryGuess: places.homeCountry ?? null,
    todo,
    packing,
    custom: (trip.prep?.custom ?? []).map((c) => (c.group === "Your items" ? { ...c, group: prepGroupFor(c.section, c.text) } : c)), // added before they were sorted
    checked: trip.prep?.checked ?? [],
  });
});

// Day by day: where you are, its time zone and (within about two weeks) the forecast. Plus each flight's airport zones
// and your home zone, so times can be shown both ways.
app.get("/api/trips/:id/days", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const items = tripItems(trip.id);
  res.json({ days: await dayInfo(trip, items), airports: airportZones(items), home: userFrom(res).homeTimeZone ?? null });
});

// How far it is between a day's stops (walking or driving), for the itinerary.
app.get("/api/trips/:id/day-legs", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json(await dayLegs(trip, tripItems(trip.id), db.lists.filter((l) => l.tripId === trip.id)));
});

// The trip on a map: stays, bookings, saved places and flights.
app.get("/api/trips/:id/map", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json(await tripMap(trip, tripItems(trip.id), db.lists.filter((l) => l.tripId === trip.id)));
});

// ---------- Calendar ----------

// Your private calendar link for a trip: Apple Calendar (or any calendar that can reach this Mac) subscribes and keeps
// it up to date. Each person on the trip has their own link, and it stops working if they leave the trip.
app.post("/api/trips/:id/calendar", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const { reset } = z.object({ reset: z.boolean().optional() }).parse(req.body ?? {});
  const user = userFrom(res);
  const tokens = (user.calendarTokens ??= {});
  if (reset || !tokens[trip.id]) {
    tokens[trip.id] = randomBytes(24).toString("base64url");
    save();
  }
  const url = `${await publicUrl(req)}/api/calendar/${tokens[trip.id]}.ics`;
  res.json({ url, webcal: url.replace(/^https?:/, "webcal:"), reachable: !/\/\/(localhost|127\.0\.0\.1)/.test(url) });
});

// The calendar itself, fetched by a calendar app (no sign-in: the link's secret is the key).
app.get("/api/calendar/:file", (req, res) => {
  const token = req.params.file.replace(/\.ics$/, "");
  if (tooMany(`calendar:${clientAddress(req)}`, 120, 60)) return void res.status(429).end();
  const user = token.length >= 20 ? db.users.find((u) => Object.values(u.calendarTokens ?? {}).includes(token)) : undefined;
  const tripId = user && Object.entries(user.calendarTokens ?? {}).find(([, t]) => t === token)?.[0];
  const trip = tripId ? getTrip(tripId) : undefined;
  if (!user || !trip || !tripRole(user, trip)) return void res.status(404).type("text/plain").send("This calendar link no longer works.");
  res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${trip.name.replace(/[^\w -]/g, "").trim() || "trip"}.ics"`, "Cache-Control": "no-store" });
  void publicUrl(req).then((base) => res.send(tripCalendar(trip, tripItems(trip.id), base)));
});

/** The checklist without weather (enough for reminders), for the trip owner's home country. */
async function checklistFor(trip: Trip) {
  const items = tripItems(trip.id);
  const owner = db.users.find((u) => u.id === trip.ownerId);
  const home = owner?.homeCountry ?? (owner?.isAdmin ? settings.homeCountry : undefined);
  const places = tripPlaces(trip, items);
  return buildPrep(trip, items, places, [], home ?? places.homeCountry, countryName).todo;
}

// ---------- Ask Estela (chat) ----------

// A day's questions per person, so a stuck tab or a long evening of questions can't run up a big bill.
const CHAT_PER_DAY = 60;
const chatCount = new Map<string, { day: string; n: number }>();

const ChatInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(6000) })).min(1).max(40),
});

// Streams the answer as server-sent events: "text" as it's written, "search" when Estela looks something up, "sources" for
// the pages it used, then "done" (or "error"). Anyone on the trip can ask, viewers included: asking changes nothing.
app.post("/api/trips/:id/chat", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  if (!aiEnabled()) return void res.status(503).json({ error: "Ask Estela needs Claude turned on (an Anthropic API key in .env)." });
  const { messages } = ChatInput.parse(req.body);
  const user = userFrom(res);
  const today = new Date().toLocaleDateString("en-CA");
  const used = chatCount.get(user.id);
  const count = used?.day === today ? used.n : 0;
  if (count >= CHAT_PER_DAY) return void res.status(429).json({ error: `That's ${CHAT_PER_DAY} questions today. Estela can answer more tomorrow.` });
  chatCount.set(user.id, { day: today, n: count + 1 });

  const items = tripItems(trip.id);
  const home = user.homeCountry ?? (user.isAdmin ? settings.homeCountry : undefined);
  const places = tripPlaces(trip, items);
  const checked = new Set(trip.prep?.checked ?? []);
  const todos = [...buildPrep(trip, items, places, [], home ?? places.homeCountry, countryName).todo, ...(trip.prep?.custom ?? []).filter((c) => c.section === "todo")]
    .filter((t) => !checked.has(t.id));
  const planned = db.lists.filter((l) => l.tripId === trip.id).flatMap((l) => l.entries.filter((e) => e.day));
  const context = tripContext({ trip, items, planned, todos, today, homeCountry: home ? countryName(home) : undefined });

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // Closing the chat (or the tab) stops the answer, and the bill for it.
  const stop = new AbortController();
  res.on("close", () => stop.abort());
  try {
    await askEstela(context, messages, {
      onText: (t) => send("text", t),
      onSearch: (q) => send("search", q),
      onSources: (s) => send("sources", s),
    }, stop.signal);
    send("done", {});
  } catch (err) {
    if (!stop.signal.aborted) {
      console.warn("Ask Estela failed:", (err as Error).message);
      send("error", "Estela couldn't answer just now. Try again in a moment.");
    }
  }
  res.end();
});

// ---------- Reminders (push notifications) ----------

// What's still to come on a trip, for the bell. Items you've ticked aren't reminded.
app.get("/api/trips/:id/reminders", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const ticked = new Set(trip.prep?.checked ?? []);
  const now = new Date().toISOString();
  const todo = await checklistFor(trip);
  res.json(
    todo
      .filter((i) => !ticked.has(i.id))
      .flatMap((i) => (i.reminders ?? []).map((r) => ({ ...r, item: i.text })))
      .filter((r) => r.at > now)
      .sort((a, b) => a.at.localeCompare(b.at)),
  );
});

app.get("/api/push/key", (_req, res) => {
  res.json({ publicKey: pushPublicKey() });
});

app.post("/api/push/subscribe", (req, res) => {
  const sub = z
    .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
    .parse(req.body.subscription);
  const ua = req.get("user-agent") ?? "";
  subscribe(userFrom(res).id, sub, /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : "Device");
  res.status(201).json({ ok: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  unsubscribe(userFrom(res).id, z.object({ endpoint: z.string().max(1000) }).parse(req.body).endpoint);
  res.status(204).end();
});

app.post("/api/push/test", async (_req, res) => {
  const sent = await notifyUser(userFrom(res).id, { title: "Estela", body: "Reminders are on. Estela will nudge you when it's time for Check-MIG, check-in and more.", url: "/#/" });
  res.json({ sent });
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
  const { section, text, day } = z
    .object({ section: z.enum(["todo", "packing"]), text: z.string().trim().min(1).max(200), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .parse(req.body);
  const prep = (trip.prep ??= { checked: [], custom: [] });
  // Added from a day of the itinerary: it's for that day, and shows there too.
  const item: PrepItem = { id: `custom:${newId()}`, section, group: prepGroupFor(section, text), text, custom: true, ...(day ? { due: `${day}T09:00` } : {}) };
  prep.custom.push(item);
  save();
  res.status(201).json(item);
});

app.patch("/api/trips/:id/prep/custom/:itemId", (req, res) => {
  const trip = getTrip(req.params.id);
  const item = trip?.prep?.custom.find((c) => c.id === req.params.itemId);
  if (!trip || !item) return void res.status(404).json({ error: "Not found" });
  const { text } = z.object({ text: z.string().trim().min(1).max(200) }).parse(req.body);
  item.text = text;
  item.group = prepGroupFor(item.section, text); // a corrected word can show where it really belongs
  save();
  res.json(item);
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
  userFrom(res).homeCountry = country;
  save();
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
  price: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
  notes: z.string().trim().max(2000).optional().transform((s) => s || undefined),
  address: z.string().trim().max(300).optional().transform((s) => s || undefined),
  area: z.string().trim().max(120).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  link: httpUrl.optional().or(z.literal("").transform(() => undefined)),
  links: z.array(z.object({ label: z.string().trim().min(1).max(60), url: httpUrl })).max(4).optional(),
  done: z.boolean().optional(),
  day: date.nullable().optional(),
});

const getList = (id: string) => db.lists.find((l) => l.id === id);

/** Is this a dish or drink, so that a description must be about food? */
const isFood = (list: TripList, kind: ListEntry["kind"]) => {
  if (kind !== "thing") return false;
  const theme = listTheme(list.name, list.emoji);
  return !!list.auto || theme === "food" || theme === "drinks";
};

/** Descriptions from Wikipedia saved before they were checked for bands, films and same-named places elsewhere. Each
 *  is checked once (gently: a free service); one that can't be reached is checked at the next start. */
async function recheckDescriptions() {
  for (const list of db.lists) {
    for (const entry of list.entries) {
      if (entry.descriptionChecked || !entry.links?.some((l) => l.label === "Wikipedia")) continue;
      const removed = await recheckDescription(entry).catch(() => undefined);
      if (removed === undefined) return;
      if (removed) console.log(`Removed a wrong description from "${entry.title}" (it was about something else with that name).`);
      entry.descriptionChecked = true;
      save();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

/** Food entries saved with no description, for instance when Wikipedia couldn't be reached at the time. */
async function fillMissingDescriptions() {
  for (const list of db.lists) {
    for (const entry of list.entries) {
      if (entry.kind === "thing" && !entry.notes && !entry.noDescription) {
        await describeEntry(entry, list.place?.countryCode, isFood(list, entry.kind)).then(save).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 1500)); // go gently on a free service
      }
      await fillPrice(entry, list).then(save).catch((e) => console.warn(`Couldn't look up a restaurant's price: ${(e as Error).message}`));
    }
  }
}

app.get("/api/trips/:id/lists", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  // A guide for each city you're staying in, made (and tidied) automatically.
  const items = tripItems(trip.id);
  if ([ensureGuides(trip, items), fillEntryLinks(trip, items)].some(Boolean)) save();
  res.json(db.lists.filter((l) => l.tripId === req.params.id));
});

app.get("/api/trips/:id/guide-days", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json(guideDays(trip, tripItems(trip.id)));
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
  const { autoDescribe, ...input } = EntryInput.extend({ autoDescribe: z.boolean().optional() }).parse(req.body); // false: you cleared it yourself
  let entry: ListEntry = { ...input, day: input.day ?? undefined, price: input.price ?? undefined, id: newId(), done: input.done ?? false, addedAt: now() };
  // Find it on the map (for grouping nearby places) unless it was picked there already.
  entry = await locateEntry(entry, list, trip, tripItems(trip.id)).catch(() => entry);
  // Keep the idea's links ("Where to try it", tours, map); make them for things you typed yourself.
  // A link to where the description came from doesn't count: you still want those.
  if (!entry.links?.some((l) => l.label !== "Wikipedia")) entry.links = [...(entryLinks(entry, list, trip, tripItems(trip.id)) ?? []), ...(entry.links ?? [])];
  list.entries.push(entry);
  save();
  // Comes with a description unless you wrote your own, and a restaurant with its price. If that's slow, it arrives
  // with the next refresh.
  const added = entry;
  const lookups: Promise<unknown>[] = [fillPrice(added, list).then(save).catch((e) => console.warn(`Couldn't look up a restaurant's price: ${(e as Error).message}`))];
  if (added.kind !== "place" && !added.notes) {
    if (autoDescribe === false) added.noDescription = true;
    else lookups.push(describeEntry(added, list.place?.countryCode, isFood(list, added.kind)).then(save).catch(() => undefined));
  }
  await Promise.race([Promise.all(lookups), new Promise((resolve) => setTimeout(resolve, 3000))]);
  res.status(201).json(entry);
});

// ---------- Choosing a place's photo ----------

// Photos taken at or near a place (Wikimedia Commons), with the one it has now first. No position: found by its name.
app.get("/api/lists/:id/entries/:entryId/photos", async (req, res) => {
  const list = getList(req.params.id);
  const entry = list?.entries.find((e) => e.id === req.params.entryId);
  if (!list || !entry) return void res.status(404).json({ error: "Not found" });
  try {
    const found = entry.lat !== undefined && entry.lon !== undefined ? await photosNear(entry.lat, entry.lon) : [];
    const more = found.length < 4 ? await searchPhotos([entry.title, list.place?.name].filter(Boolean).join(" ")) : [];
    const seen = new Set<string>();
    res.json([...found, ...more].filter((p) => (seen.has(p.page) ? false : (seen.add(p.page), true))).slice(0, 24));
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach Wikimedia Commons just now (${(err as Error).message}). Try again in a moment.` });
  }
});

app.get("/api/photo-search", async (req, res) => {
  const q = z.string().trim().min(2).max(120).parse(req.query.q);
  try {
    res.json(await searchPhotos(q));
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach Wikimedia Commons just now (${(err as Error).message}).` });
  }
});

// Set a place's photo: one picked from Commons, one you upload (a JPEG, PNG or WebP, shrunk on your device first), or
// none. Your choice stays: Estela doesn't look for another.
app.put("/api/lists/:id/entries/:entryId/photo", (req, res) => {
  const list = getList(req.params.id);
  const entry = list?.entries.find((e) => e.id === req.params.entryId);
  if (!list || !entry) return void res.status(404).json({ error: "Not found" });
  const input = z
    .union([
      z.object({ pick: z.object({ url: z.string().url().max(1000), page: z.string().url().max(1000) }) }),
      z.object({ upload: z.object({ filename: z.string().max(200), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(8_000_000) }) }),
      z.object({ none: z.literal(true) }),
    ])
    .parse(req.body);
  const before = entry.photo?.own ? entry.photo.url.match(/^\/api\/attachments\/([\w-]+)$/)?.[1] : undefined;
  if ("pick" in input) {
    if (!isCommonsPhoto(input.pick.url, input.pick.page)) return void res.status(400).json({ error: "Only photos from Wikimedia can be chosen here. Upload your own instead." });
    entry.photo = { url: input.pick.url, page: input.pick.page, near: true };
  } else if ("upload" in input) {
    const stored = storeAttachment({ filename: input.upload.filename, contentType: input.upload.contentType, data: Buffer.from(input.upload.data, "base64") }, undefined, userFrom(res).id);
    entry.photo = { url: `/api/attachments/${stored.id}`, near: true, own: true };
  } else {
    entry.photo = null;
  }
  entry.photoPicked = true;
  save();
  if (before) removeIfUnused(before); // a photo of yours it replaced
  res.json(entry);
});

app.patch("/api/lists/:id/entries/:entryId", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  const entry = list?.entries.find((e) => e.id === req.params.entryId);
  if (!list || !trip || !entry) return res.status(404).json({ error: "Not found" });
  const input = EntryInput.partial().parse(req.body);
  const moved = input.title !== undefined && input.title !== entry.title && input.lat === undefined;
  Object.assign(entry, { ...input, day: input.day === undefined ? entry.day : input.day ?? undefined, price: input.price === undefined ? entry.price : input.price ?? undefined });
  if ("notes" in req.body) entry.noDescription = !entry.notes; // cleared by you stays cleared
  if ("price" in req.body) entry.priceChecked = true; // likewise
  // Renamed or changed to a place without picking it on the map: look it up again.
  if (moved || (input.kind === "place" && entry.lat === undefined)) {
    Object.assign(entry, { lat: undefined, lon: undefined, area: undefined });
    Object.assign(entry, await locateEntry(entry, list, trip, tripItems(trip.id)).catch(() => entry));
  }
  // Renamed: it's a different place now, so its price is too.
  if (moved && !("price" in req.body)) Object.assign(entry, { price: undefined, priceChecked: undefined });
  await fillPrice(entry, list).catch(() => undefined);
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

// A description for something being typed into a list. Nothing found isn't an error.
app.get("/api/lists/:id/describe", async (req, res) => {
  const list = getList(req.params.id);
  if (!list) return void res.status(404).json({ error: "List not found" });
  const q = z.string().trim().min(1).max(160).safeParse(req.query.q);
  if (!q.success) return void res.json({});
  const kind = req.query.kind === "thing" ? "thing" : "activity";
  res.json((await describe(q.data, list.place?.countryCode, isFood(list, kind)).catch(() => undefined)) ?? {});
});

app.get("/api/lists/:id/suggestions", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  if (!list || !trip) return res.status(404).json({ error: "List not found" });
  res.json(list.auto ? guideSuggestions(list, trip, tripItems(trip.id)) : await listSuggestions(list, trip, tripItems(trip.id)));
});

// What could fit on each day, for the itinerary.
app.get("/api/trips/:id/day-suggestions", (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  res.json(daySuggestions(trip, tripItems(trip.id)));
});

// Days that only name a town, and what's there.
app.get("/api/trips/:id/explore", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return void res.status(404).json({ error: "Trip not found" });
  const items = tripItems(trip.id);
  res.json(await broadPlaces(trip, items, db.lists.filter((l) => l.tripId === trip.id), guideDays(trip, items)));
});

app.get("/api/trips/:id/explore/ideas", async (req, res) => {
  if (!getTrip(req.params.id)) return void res.status(404).json({ error: "Trip not found" });
  const { lat, lon, name } = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180), name: z.string().trim().min(1).max(120) }).parse(req.query);
  res.json(await exploreIdeas({ lat, lon }, name));
});

// Pharmacies, hospitals/clinics, police and ATMs near each stay in a guide's city.
app.get("/api/lists/:id/essentials", async (req, res) => {
  const list = getList(req.params.id);
  const trip = list && getTrip(list.tripId);
  if (!list || !trip || !list.auto) return res.status(404).json({ error: "Guide not found" });
  const items = tripItems(trip.id);
  const p = list.place;
  const near = p?.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : positionOn(trip, items, trip.startDate);
  if (!near) return res.json({ emergency: undefined, stays: [], tips: safetyTips(p?.countryCode, p?.name), apps: localApps(p?.countryCode, p?.name) });
  res.json(await essentialsFor(guideStays(list, trip, items), near, p?.countryCode, p?.name));
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

app.get("/api/trips/:id/day-plans", async (req, res) => {
  const trip = getTrip(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  // A photo for each place planned for a day, looked up once (a few at a time, so the itinerary isn't held up long).
  // One at a time, so Wikipedia isn't asked too much at once; if it says to wait, the rest are looked up next time.
  const unlooked = db.lists.filter((l) => l.tripId === trip.id).flatMap((l) => l.entries.filter((e) => e.day && photoDue(e)).map((e) => ({ e, cc: l.place?.countryCode }))).slice(0, 6);
  let found = false;
  for (const { e, cc } of unlooked) {
    const looked = await fillPhoto(e, cc).catch(() => undefined);
    if (looked === undefined) break;
    found ||= looked;
  }
  if (found) save();
  res.json(dayPlans(trip, tripItems(trip.id)));
});

/** Plan (or unplan) several list entries for a day at once — "cover this area on Fri 11 Dec". */
app.post("/api/trips/:id/plan-day", (req, res) => {
  const { day, entries } = z
    .object({ day: date.nullable(), entries: z.array(z.object({ listId: z.string(), entryId: z.string() })).max(100) })
    .parse(req.body);
  for (const { listId, entryId } of entries) {
    const entry = getList(listId)?.entries.find((e) => e.id === entryId);
    if (entry && getList(listId)!.tripId === req.params.id && entry.day !== (day ?? undefined)) {
      entry.day = day ?? undefined;
      delete entry.dayOrder; // a new day: it joins that day's route in walking order
    }
  }
  save();
  res.status(204).end();
});

// Your own order for a day's places (dragged into place), or back to walking order (entries: null).
app.post("/api/trips/:id/day-order", (req, res) => {
  const { day, entries } = z
    .object({ day: date, entries: z.array(z.object({ listId: z.string(), entryId: z.string() })).max(100).nullable() })
    .parse(req.body);
  const onDay = db.lists.filter((l) => l.tripId === req.params.id).flatMap((l) => l.entries.filter((e) => e.day === day));
  for (const e of onDay) delete e.dayOrder;
  (entries ?? []).forEach(({ listId, entryId }, n) => {
    const entry = getList(listId)?.tripId === req.params.id ? getList(listId)!.entries.find((e) => e.id === entryId && e.day === day) : undefined;
    if (entry) entry.dayOrder = n;
  });
  save();
  res.status(204).end();
});

// ---------- Currency ----------

// Exchange rates (cached) plus the currency the user wants totals shown in.
app.get("/api/fx", async (_req, res) => {
  const user = userFrom(res);
  const displayCurrency = user.displayCurrency ?? (user.isAdmin ? settings.displayCurrency : undefined) ?? null;
  try {
    res.json({ ...(await getRates()), displayCurrency });
  } catch {
    res.status(502).json({ error: "Exchange rates are unavailable right now", displayCurrency });
  }
});

app.put("/api/settings/display-currency", (req, res) => {
  const { currency } = z.object({ currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/) }).parse(req.body);
  userFrom(res).displayCurrency = currency;
  save();
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
  const user = userFrom(res);
  const alerts = db.items.flatMap((i) =>
    i.kind === "flight" && i.changes.some((c) => !c.acknowledged) && tripRole(user, getTrip(i.tripId))
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

// ---------- The app itself (after `npm run build`) ----------
// One address for everything, so Tailscale (or anything else) only has to forward a single port. In development the
// Vite server serves the app instead and this folder may be stale or missing.
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
if (existsSync(join(DIST, "index.html"))) {
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders: (res, file) => {
        // Hashed build files never change; the page and the offline worker must always be fresh.
        res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(DIST, "index.html"));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

/**
 * The address people open on their phones: PUBLIC_URL if set, else this Mac's Tailscale HTTPS name (as used by
 * `tailscale serve`), else localhost.
 */
let publicUrlCache: string | undefined;
async function publicUrl(req?: Request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  // Opened through Tailscale or a host: links use that same address.
  const host = req?.get("x-forwarded-host") ?? req?.get("host");
  if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return `${req!.get("x-forwarded-proto") ?? req!.protocol}://${host}`;
  if (publicUrlCache) return publicUrlCache;
  const { execFile } = await import("node:child_process");
  for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    const name = await new Promise<string | undefined>((resolve) =>
      execFile(bin, ["status", "--json"], { timeout: 4000 }, (err, out) => {
        try {
          resolve(err ? undefined : (JSON.parse(out).Self?.DNSName as string | undefined)?.replace(/\.$/, ""));
        } catch {
          resolve(undefined);
        }
      }),
    );
    if (name) return (publicUrlCache = `https://${name}`);
  }
  return `http://localhost:${port}`;
}

const port = Number(process.env.API_PORT ?? 3001);
// Only this Mac can connect (not others on the same café or hotel Wi-Fi). Your phone reaches it through Tailscale,
// which forwards to this address. Set HOST=0.0.0.0 only if you understand that anyone on your network could then
// read and change your trips.
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, (err?: Error) => {
  // Express 5 calls this even when listening fails. A second copy must not start the pollers: each copy keeps its
  // own in-memory data and saves it to the same file, so they would overwrite each other's changes.
  if (err) {
    console.error(`API port ${port} is already in use — is Estela already running? Exiting so data isn't overwritten.`);
    process.exit(1);
  }
  // You sign in on this Mac with a fresh one-time link (valid 1 hour); other devices are signed in from the app.
  const admin = setUpPeople();
  if (needsOwner()) {
    // Claiming Estela (and the trips already in it): sign up on this Mac, or (e.g. once deployed) open this link.
    console.log(`\n  Welcome! Create your account at http://localhost:${port} on this Mac to set up Estela.`);
    publicUrl().then((url) => console.log(`  Not on this Mac (e.g. deployed)? This one-time owner link works for 24 hours:\n  ${url}/#/signin/${createLink("owner", admin.id, 24 * 60)}\n`));
  }
  console.log(`Estela on http://${host === "127.0.0.1" ? "localhost" : host}:${port} (Claude: ${aiEnabled() ? "on" : "off — using rule-based fallbacks"})`);
  const dropped = dropEmptyAttachments();
  if (dropped) console.log(`Removed ${dropped} empty attachment file(s); re-import their emails to attach them again.`);
  pruneAttachments();
  startFlightPoller();
  startReminderLoop(checklistFor);
  startInboxPoller();
  fillMissingDescriptions();
  recheckDescriptions();
  // Activities saved before the Where was added to their places. Each only gets this once.
  if (db.items.map((i) => i.kind === "activity" && addWhereToPlaces(i)).some(Boolean)) save();
  setInterval(fillMissingDescriptions, 30 * 60_000);
});
