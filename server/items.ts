import { distanceKm } from "./tripPlaces.ts";
import { z } from "zod";
import type { ActivityGuide, DraftItem, ItineraryItem, StoredAttachment, ActivityItem } from "../shared/types.ts";
import { db, newId, now, save } from "./db.ts";
import { normaliseFlightNumber } from "./emailParser.ts";
import { refreshFlight } from "./flightStatus.ts";

const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Use YYYY-MM-DDTHH:mm");
export const opt = z.string().trim().optional().transform((s) => s || undefined);

const Price = z.object({
  amount: z.coerce.number().positive("Price must be more than 0"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD"),
});
const LinkInput = z.object({ label: z.string().trim().min(1).max(60), url: z.string().trim().url("Links must be full web addresses (https://…)") });
const AttachmentRef = z
  .object({ id: z.string(), filename: z.string(), contentType: z.string(), size: z.number() })
  .refine((a) => db.attachments.some((r) => r.id === a.id), "Unknown attachment");
const lines = z.array(z.string().trim().min(1)).optional().transform((l) => (l?.length ? l : undefined));
const GuideInput = z
  .object({
    itinerary: lines, whatToBring: lines, whatToWear: lines, dos: lines, donts: lines, beforeYouGo: lines, goodToKnow: lines, included: lines, notIncluded: lines,
    meetingPoint: opt, endPoint: opt, cancellation: opt, provider: opt, pin: opt,
  })
  .optional()
  .nullable()
  .transform((g) => {
    const kept = g ? Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)) : {};
    return Object.keys(kept).length ? kept : undefined;
  });

const common = {
  source: z.enum(["manual", "email"]).default("manual"),
  emailId: z.string().optional(),
  confirmationCode: opt,
  price: Price.optional().nullable().transform((p) => p ?? undefined),
  // Splitting the cost between people on the trip (checked against who's on it when saved).
  paidBy: z.string().max(60).optional().nullable().transform((p) => p ?? undefined),
  split: z.array(z.string().max(60)).max(30).optional().nullable().transform((s) => (s?.length ? [...new Set(s)] : undefined)),
  links: z.array(LinkInput).max(10).optional().transform((l) => (l?.length ? l : undefined)),
  attachments: z.array(AttachmentRef).max(20).optional().transform((a) => (a?.length ? a : undefined)),
  notes: opt,
};
export const ItemInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("flight"),
    ...common,
    flightNumber: z.string().min(2).transform(normaliseFlightNumber),
    airline: opt,
    from: z.string().trim().toUpperCase(),
    to: z.string().trim().toUpperCase(),
    departureTime: dateTime,
    arrivalTime: dateTime.optional().or(z.literal("").transform(() => undefined)),
    seat: opt,
    baggage: z
      .object({ cabin: opt, checked: opt })
      .optional()
      .transform((b) => (b && (b.cabin || b.checked) ? { ...(b.cabin && { cabin: b.cabin }), ...(b.checked && { checked: b.checked }) } : undefined)),
  }),
  z.object({ kind: z.literal("stay"), ...common, name: z.string().trim().min(1), address: opt, lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), checkIn: dateTime, checkOut: dateTime }),
  z.object({
    kind: z.literal("activity"),
    ...common,
    title: z.string().trim().min(1),
    location: opt,
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    start: dateTime,
    end: dateTime.optional().or(z.literal("").transform(() => undefined)),
    category: opt,
    guide: GuideInput,
    dateEstimated: z.boolean().optional().transform((b) => b || undefined),
    fromReceipt: z.boolean().optional().transform((b) => b || undefined),
    includes: z
      .array(z.object({ title: z.string().trim().min(1).max(160), address: z.string().trim().max(300).optional(), lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional() }))
      .max(30)
      .optional(),
    broughtItems: z.array(z.string().max(500)).max(100).optional(),
    flightNumber: opt,
    transferLeg: z.enum(["pickup", "dropoff", "other"]).optional(),
  }),
]).superRefine((v, ctx) => {
  // Ends can't come before starts (flights are left alone: arrivals are local times and can look "earlier").
  if (v.kind === "activity" && v.end && v.end.slice(0, 16) < v.start.slice(0, 16))
    ctx.addIssue({ code: "custom", path: ["end"], message: "The end must be after the start" });
  if (v.kind === "stay" && v.checkOut.slice(0, 16) <= v.checkIn.slice(0, 16))
    ctx.addIssue({ code: "custom", path: ["checkOut"], message: "Check-out must be after check-in" });
});
export type ItemInputT = z.infer<typeof ItemInput>;

export function createItem(tripId: string, input: ItemInputT): ItineraryItem {
  const base = { ...input, id: newId(), tripId, createdAt: now() };
  if (base.kind === "flight") return { ...base, changes: [] };
  if (base.kind === "activity") addWhereToPlaces(base as ActivityItem);
  return base;
}

const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]*$/i;
/** The name in a Where: its first part, unless that's a plus code, or too short to mean anything alone ("Brgy, 267 San Jose"). */
function whereName(location: string) {
  const parts = location.split(",").map((p) => p.trim()).filter((p) => p && !PLUS_CODE.test(p));
  if (!parts.length) return location.trim();
  return parts[0].length <= 4 && parts[1] ? `${parts[0]}, ${parts[1]}` : parts[0];
}
const SAME_SPOT_KM = 0.15;

/**
 * Puts an activity's Where among its places. Remembers what it added: a place you remove stays removed, and changing the
 * Where swaps the old one for the new. Rides are left out, as they aren't somewhere you're visiting. True if anything changed.
 */
export function addWhereToPlaces(activity: ActivityItem) {
  if (activity.category === "transfer" || !activity.location?.trim()) return false;
  const location = activity.location.trim();
  if (activity.placeFromWhere === location) return false;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const previous = activity.placeFromWhere ? whereName(activity.placeFromWhere) : undefined;
  const places = (activity.includes ?? []).filter((p) => !previous || !same(p.title, previous));
  const title = whereName(location);
  const { lat, lon } = activity;
  const covered = places.some((p) => same(p.title, title) || (lat !== undefined && lon !== undefined && p.lat !== undefined && p.lon !== undefined && distanceKm({ lat, lon }, { lat: p.lat, lon: p.lon }) <= SAME_SPOT_KM));
  activity.includes = covered ? places : [...places, { title, address: location, ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}) }];
  activity.placeFromWhere = location;
  return true;
}

const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const norm = (s: string) => s.trim().toLowerCase();

/** Is `input` the same booking as an existing item (e.g. the same email forwarded twice, or a schedule-change email)? */
function findExisting(tripId: string, input: ItemInputT): ItineraryItem | undefined {
  return findExact(tripId, input) ?? findReceiptMatch(tripId, input);
}

const COMMON_WORDS = new Set(["tour", "tours", "trip", "the", "and", "with", "experience", "activity", "class", "from", "for", "city", "day", "private", "group", "small", "ticket", "tickets"]);
const titleWords = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !COMMON_WORDS.has(w));

/**
 * A receipt rarely names a booking the way its confirmation does ("E-bike tour" and "City E-Bike Tour with Tacos") or
 * shares its reference. It's the same booking when all of the shorter name's words are in the longer one, on the same
 * day; or, when one of the dates is only a guess, with two or more such words.
 */
function findReceiptMatch(tripId: string, input: ItemInputT): ItineraryItem | undefined {
  if (input.kind !== "activity") return;
  const wanted = titleWords(input.title);
  return db.items.find((i) => {
    if (i.tripId !== tripId || i.kind !== "activity" || !(input.fromReceipt || i.fromReceipt)) return false;
    if (i.confirmationCode && input.confirmationCode) return false;
    const have = titleWords(i.title);
    const [short, long] = wanted.length <= have.length ? [wanted, have] : [have, wanted];
    if (short.length === 0 || !short.every((w) => long.includes(w))) return false;
    return sameDay(i.start, input.start) || ((!!input.dateEstimated || !!i.dateEstimated) && short.length >= 2);
  });
}

function findExact(tripId: string, input: ItemInputT): ItineraryItem | undefined {
  return db.items.find((i) => {
    if (i.tripId !== tripId || i.kind !== input.kind) return false;
    if (i.kind === "flight" && input.kind === "flight") {
      return i.flightNumber === input.flightNumber && sameDay(i.departureTime, input.departureTime);
    }
    if (i.kind === "stay" && input.kind === "stay") {
      return (
        (!!i.confirmationCode && i.confirmationCode === input.confirmationCode) ||
        (norm(i.name) === norm(input.name) && sameDay(i.checkIn, input.checkIn)) ||
        // Same nights from an email import: almost certainly the same booking (e.g. a re-import after a parser fix).
        (i.source === "email" && sameDay(i.checkIn, input.checkIn) && sameDay(i.checkOut, input.checkOut))
      );
    }
    if (i.kind === "activity" && input.kind === "activity") {
      // A booking reference identifies the booking even when it's rescheduled.
      if (i.confirmationCode && input.confirmationCode) return i.confirmationCode === input.confirmationCode;
      return norm(i.title) === norm(input.title) && i.start === input.start;
    }
    return false;
  });
}

/**
 * Adds email-extracted bookings to a trip. A booking that already exists is updated
 * (only with fields the email actually contains) instead of duplicated.
 */
export async function upsertFromEmail(tripId: string, drafts: DraftItem[], emailId?: string, files: StoredAttachment[] = []) {
  let added = 0, updated = 0, invalid = 0;
  const toRefresh: ItineraryItem[] = [];
  for (const draft of drafts) {
    const parsed = ItemInput.safeParse({ ...draft, source: "email", emailId, attachments: [...(draft.attachments ?? []), ...files] });
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const input = parsed.data;
    const existing = findExisting(tripId, input);
    if (!existing) {
      const item = createItem(tripId, input);
      db.items.push(item);
      toRefresh.push(item);
      added++;
      continue;
    }
    const defined = Object.fromEntries(
      Object.entries(input).filter(([k, v]) => v !== undefined && v !== "" && k !== "source" && k !== "attachments"),
    );
    // Keep files already attached (including ones the user added) and add new ones.
    const merged = [...(existing.attachments ?? []), ...(input.attachments ?? [])];
    existing.attachments = merged.filter((f, i) => merged.findIndex((g) => g.id === f.id) === i);
    // A follow-up email that only mentions checked bags keeps the cabin allowance you already had.
    if (existing.kind === "flight" && input.kind === "flight" && input.baggage) defined.baggage = { ...existing.baggage, ...input.baggage };
    if (existing.kind === "activity" && input.kind === "activity") {
      // Never replace a real or user-confirmed time with an estimate.
      if (input.dateEstimated && !existing.dateEstimated) {
        delete defined.start;
        delete defined.end;
        delete defined.dateEstimated;
      } else if (!input.dateEstimated) {
        existing.dateEstimated = undefined;
      }
      // A shorter follow-up email mustn't wipe details an earlier one gave (the pickup, what to bring).
      if (input.guide) {
        defined.guide = { ...existing.guide, ...input.guide };
        // Keep what you added yourself alongside what this email lists.
        for (const key of ["included", "notIncluded"] as const) {
          const both = [...new Set([...(existing.guide?.[key] ?? []), ...(input.guide[key] ?? [])])];
          if (both.length) (defined.guide as ActivityGuide)[key] = both;
        }
      }
      if (input.fromReceipt && !existing.fromReceipt) {
        // The booking's own email knows better: a receipt only fills in what's missing, or replaces a guessed date.
        const datesKnown = !!existing.dateEstimated && !input.dateEstimated;
        for (const key of Object.keys(defined)) {
          if (datesKnown && (key === "start" || key === "end")) continue;
          if (key === "guide" || existing[key as keyof typeof existing] !== undefined) delete defined[key];
        }
        delete defined.fromReceipt;
        if (input.guide) defined.guide = { ...input.guide, ...existing.guide };
      } else if (existing.fromReceipt && !input.fromReceipt) {
        existing.fromReceipt = undefined; // now the real booking email has arrived
      }
    }
    if (existing.kind === "flight" && input.kind === "flight" && input.departureTime !== existing.departureTime) {
      existing.changes.push({ at: now(), field: "Departure time (airline email)", from: existing.departureTime, to: input.departureTime, acknowledged: false });
      existing.live = undefined; // re-check against the new schedule
      toRefresh.push(existing);
    }
    Object.assign(existing, defined);
    if (existing.kind === "activity") addWhereToPlaces(existing);
    updated++;
  }
  save();
  await Promise.allSettled(toRefresh.filter((i) => i.kind === "flight").map((f) => refreshFlight(f)));
  return { added, updated, invalid };
}
