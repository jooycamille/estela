import type { ItineraryItem, Trip } from "../shared/types.ts";
import { activityDays } from "../shared/days.ts";
import { getAirport } from "./airports.ts";
import { dayPlaces, zoneAt } from "./dayInfo.ts";
import { airportTimeZone, wallTimeToUtc } from "./time.ts";

// A trip as a calendar (iCalendar, RFC 5545) that Apple Calendar, Google Calendar or Outlook can subscribe to or import:
// flights, stays (all day, over the nights) and activities. Times are given in UTC, worked out from where each thing
// happens, so they show right wherever the calendar is opened. Confirmation codes go in, prices don't.

const HOUR = 3600_000;

/** Text for a property value: backslashes, commas, semicolons and line breaks escaped. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 bytes continue on the next line, after a space (counted in bytes, without splitting a character). */
function fold(line: string) {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const utc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 2026-12-21T18:23:00.000Z → 20261221T182300Z
const floating = (wall: string) => `${wall.slice(0, 16).replace(/[-:]/g, "")}00`; // no zone known: the calendar's own
const date = (d: string) => d.slice(0, 10).replace(/-/g, "");
const nextDay = (d: string) => new Date(Date.parse(`${d.slice(0, 10)}T12:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10);

/** DTSTART/DTEND for a wall time where it happens: in UTC when the zone is known. */
function at(name: "DTSTART" | "DTEND", wall: string, tz?: string) {
  return tz ? `${name}:${utc(wallTimeToUtc(wall, tz))}` : `${name}:${floating(wall)}`;
}
function later(wall: string, hours: number) {
  const d = new Date(Date.parse(`${wall.slice(0, 16)}:00Z`) + hours * HOUR);
  return d.toISOString().slice(0, 16);
}

export function tripCalendar(trip: Trip, items: ItineraryItem[], appUrl: string) {
  const where = dayPlaces(trip, items);
  const stamp = utc(new Date().toISOString());
  const link = `${appUrl}/#/trip/${trip.id}`;
  const events: string[][] = [];
  const event = (id: string, lines: (string | false | undefined)[]) =>
    events.push(["BEGIN:VEVENT", `UID:${id}@estela`, `DTSTAMP:${stamp}`, ...lines.filter((l): l is string => !!l), `URL:${link}`, "END:VEVENT"]);
  const description = (parts: (string | false | undefined)[]) => {
    const kept = parts.filter((p): p is string => !!p);
    return kept.length ? `DESCRIPTION:${text(kept.join("\n"))}` : undefined;
  };

  for (const i of items) {
    if (i.kind === "flight") {
      const dep = i.live?.departureTime ?? i.departureTime;
      const arr = i.live?.arrivalTime ?? i.arrivalTime;
      const from = getAirport(i.from), to = getAirport(i.to);
      const fromTz = airportTimeZone(i.from), toTz = airportTimeZone(i.to);
      event(i.id, [
        `SUMMARY:${text(`Flight ${i.flightNumber} ${i.from} → ${i.to}`)}`,
        at("DTSTART", dep, fromTz),
        arr ? at("DTEND", arr, toTz) : at("DTEND", later(dep, 2), fromTz),
        from && `LOCATION:${text(`${from.name}, ${from.city}`)}`,
        description([
          i.airline,
          `${from?.city ?? i.from} → ${to?.city ?? i.to}`,
          i.live?.departureTerminal && `Terminal ${i.live.departureTerminal}`,
          i.live?.departureGate && `Gate ${i.live.departureGate}`,
          i.seat && `Seat ${i.seat}`,
          i.baggage?.cabin && `Cabin bag ${i.baggage.cabin}`,
          i.baggage?.checked && `Checked bags ${i.baggage.checked}`,
          i.confirmationCode && `Booking reference ${i.confirmationCode}`,
          i.live?.status === "cancelled" ? "CANCELLED" : undefined,
        ]),
        i.live?.status === "cancelled" && "STATUS:CANCELLED",
      ]);
    } else if (i.kind === "stay") {
      // All day, over the nights you sleep there (the end date is the morning you leave, which a calendar leaves out).
      const out = i.checkOut.slice(0, 10) > i.checkIn.slice(0, 10) ? i.checkOut : nextDay(i.checkIn);
      event(i.id, [
        `SUMMARY:${text(`Stay: ${i.name}`)}`,
        `DTSTART;VALUE=DATE:${date(i.checkIn)}`,
        `DTEND;VALUE=DATE:${date(out)}`,
        i.address && `LOCATION:${text(i.address)}`,
        description([
          `Check-in ${i.checkIn.slice(11, 16) || "from the afternoon"}, check-out ${i.checkOut.slice(0, 10)} ${i.checkOut.slice(11, 16)}`.trim(),
          i.confirmationCode && `Booking reference ${i.confirmationCode}`,
        ]),
        "TRANSP:TRANSPARENT", // a stay doesn't make you busy all day
      ]);
    } else {
      const day = activityDays(i)[0];
      const tz = (i.lat !== undefined && i.lon !== undefined ? zoneAt(i.lat, i.lon) : undefined) ?? where[day]?.tz;
      const end = i.end && i.end > i.start ? i.end : later(i.start, i.category === "transfer" ? 1 : 2);
      event(i.id, [
        `SUMMARY:${text(i.title)}`,
        at("DTSTART", i.start, tz),
        at("DTEND", end, tz),
        (i.location ?? i.guide?.meetingPoint) && `LOCATION:${text(i.location ?? i.guide!.meetingPoint!)}`,
        description([
          i.guide?.meetingPoint && i.location && `Meeting point: ${i.guide.meetingPoint}`,
          i.guide?.pin && `PIN ${i.guide.pin}`,
          i.confirmationCode && `Booking reference ${i.confirmationCode}`,
          i.notes && i.notes.slice(0, 600),
        ]),
      ]);
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Estela//Trip calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(trip.name)}`,
    `X-WR-CALDESC:${text(`${trip.destination}, from Estela`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
