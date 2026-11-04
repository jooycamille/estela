import { z } from "zod";
import type { DraftItem, ItineraryItem, StoredAttachment } from "../shared/types.ts";
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
    itinerary: lines, whatToBring: lines, whatToWear: lines, dos: lines, donts: lines, beforeYouGo: lines, goodToKnow: lines,
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
  return base.kind === "flight" ? { ...base, changes: [] } : base;
}

const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const norm = (s: string) => s.trim().toLowerCase();

/** Is `input` the same booking as an existing item (e.g. the same email forwarded twice, or a schedule-change email)? */
function findExisting(tripId: string, input: ItemInputT): ItineraryItem | undefined {
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
      if (input.guide) defined.guide = { ...existing.guide, ...input.guide };
    }
    if (existing.kind === "flight" && input.kind === "flight" && input.departureTime !== existing.departureTime) {
      existing.changes.push({ at: now(), field: "Departure time (airline email)", from: existing.departureTime, to: input.departureTime, acknowledged: false });
      existing.live = undefined; // re-check against the new schedule
      toRefresh.push(existing);
    }
    Object.assign(existing, defined);
    updated++;
  }
  save();
  await Promise.allSettled(toRefresh.filter((i) => i.kind === "flight").map((f) => refreshFlight(f)));
  return { added, updated, invalid };
}
