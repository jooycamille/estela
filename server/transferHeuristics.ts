import type { ActivityGuide } from "../shared/types.ts";
import type { ActivityFields } from "./activityHeuristics.ts";
import { findConfirmation, findDates, findTimes, findTotalPrice } from "./emailHeuristics.ts";

// Airport pick-ups, drop-offs and other booked rides (Booking.com Rides and emails labelled the same way). They're saved
// as activities tagged "transfer", and linked to the flight they're for.

const plain = (s: string) => s.replace(/[*​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const AIRPORT = /\bairport\b|\(([A-Z]{3})\)/i;
const airportCode = (place: string) => place.match(/\(([A-Z]{3})\)/)?.[1];
const shortPlace = (place: string) => airportCode(place) ?? (place.split(",")[0].trim() || place);

export function parseTransfer(text: string, fallbackYear: number): (ActivityFields & { flightNumber?: string; transferLeg: "pickup" | "dropoff" | "other" }) | undefined {
  const subject = [...text.matchAll(/^\W*subject:\s*(.+)$/gim)].map((m) => m[1]).join(" ");
  const rideEmail = /\bride is confirmed\b|\bbooking\.com rides\b/i.test(text) || /\b(?:transfer|taxi|shuttle|ride)\b|🚕/i.test(subject);
  if (!rideEmail) return;
  const body = text.replace(/^\s*(?:from|date|sent|to|cc|bcc|subject|reply-to):.*$/gim, "");
  const lines = body.split("\n").map(plain).filter(Boolean);

  // --- Route and time: "Your journey", then date and time, from, date, to. Or labelled "Pick-up: …" and "Drop-off: …".
  let from: string | undefined;
  let to: string | undefined;
  let when: string | undefined;
  const heading = lines.findIndex((l) => /^your (?:journey|ride|transfer)$/i.test(l));
  if (heading >= 0) {
    for (const line of lines.slice(heading + 1, heading + 8)) {
      if (/^(?:change route|your flight|flight number)/i.test(line)) break;
      if (findDates(line, fallbackYear).length > 0 && line.length < 60) when ??= line;
      else if (!from) from = line;
      else if (!to) to = line;
    }
  }
  const labelled = (re: RegExp) => lines.map((l) => l.match(re)?.[1]?.trim()).find(Boolean);
  from ??= labelled(/^(?:pick-?up(?: location| point| from| address)?)\s*:\s*(.+)$/i);
  to ??= labelled(/^(?:drop-?off(?: location| point| at| address)?|destination)\s*:\s*(.+)$/i);
  when ??= labelled(/^(?:pick-?up (?:date(?: and time)?|time)|transfer date|travel date)\s*:\s*(.+)$/i);
  if (!from || !to || !when) return;
  const date = findDates(when, fallbackYear)[0];
  if (!date) return;
  const start = `${date.date}T${findTimes(when)[0]?.time ?? "09:00"}`;

  const transferLeg = AIRPORT.test(from) ? "pickup" : AIRPORT.test(to) ? "dropoff" : "other";
  const name = { pickup: "Airport pick-up", dropoff: "Airport drop-off", other: "Transfer" }[transferLeg];

  // --- The rest
  const guide: ActivityGuide = { meetingPoint: from, endPoint: to };
  const provider = labelled(/^provided by\s*:\s*(.+)$/i);
  if (provider) guide.provider = provider;
  const free = body.match(/^\W*(free cancell?ation[^\n]*)(\n[^\n]*\))?/im);
  const noRefund = body.match(/^[^\n]*\bnon[- ]?refundable\b[^\n]*/im);
  if (free) guide.cancellation = plain(`${free[1]} ${free[2] ?? ""}`);
  else if (noRefund) guide.cancellation = plain(noRefund[0]);
  const flexible = body.match(/flexible pick-?up time\W*\n([\s\S]{10,300}?)\n\s*-{3,}/i)?.[1];
  if (flexible) guide.goodToKnow = [plain(flexible)];

  return {
    title: `${name}: ${shortPlace(from)} → ${shortPlace(to)}`,
    start,
    location: from,
    category: "transfer",
    confirmationCode: findConfirmation(body) ?? body.match(/booking reference\W*\n\W*([A-Z0-9-]{5,})/i)?.[1],
    price: findTotalPrice(body),
    guide,
    flightNumber: labelled(/^flight(?: number| no\.?)?\s*:\s*([A-Z0-9]{2}\s?\d{1,4})\b/i)?.replace(/\s+/g, "").toUpperCase(),
    transferLeg,
  };
}
