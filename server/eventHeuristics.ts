import type { ActivityGuide } from "../shared/types.ts";
import type { ActivityFields } from "./activityHeuristics.ts";
import { findDates, findTimes, findTotalPrice } from "./emailHeuristics.ts";

// Tickets to concerts, shows and games (Ticketmaster and the like): the name, then the date and time, then the venue.

const plain = (s: string) => s.replace(/\[image:[^\]]*\]?/gi, "").replace(/[*​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
const TICKET_LINE = /^\d+\s*x?\s*(?:[\w-]+\s+){0,3}tickets?\b/i;

function categoryOf(text: string) {
  if (/\b(?:vs\.?|versus|match|game|fc|cup)\b/i.test(text)) return "match";
  if (/\b(?:theat(?:er|re)|musical|ballet|opera|comedy)\b/i.test(text)) return "show";
  if (/\b(?:concert|tour|live|festival|stadium|estadio|arena|foro|auditorio)\b/i.test(text)) return "concert";
  return "event";
}

export function parseEventTicket(text: string, fallbackYear: number): ActivityFields | undefined {
  const subject = [...text.matchAll(/^\W*subject:\s*(.+)$/gim)].map((m) => m[1]).join(" ");
  const body = text.replace(/^\s*(?:from|date|sent|to|cc|bcc|subject|reply-to):.*$/gim, "");
  const lines = body.split("\n").map(plain).filter(Boolean);

  // The name, a line with both date and time, and the venue, with a ticket mentioned right after or in the subject.
  const at = lines.findIndex((l, i) => {
    if (i === 0 || i + 1 >= lines.length || l.length > 60) return false;
    if (!findDates(l, fallbackYear).length || !findTimes(l).length) return false;
    const ticketed = lines.slice(i + 1, i + 4).some((n) => TICKET_LINE.test(n)) || /\btickets?\b/i.test(subject);
    return ticketed && !/[.!?]$/.test(lines[i - 1]) && !/\b(?:order|booking|hello|thank|dear)\b/i.test(lines[i - 1]);
  });
  if (at < 0) return;
  const title = lines[at - 1];
  const venue = TICKET_LINE.test(lines[at + 1]) ? undefined : lines[at + 1];
  if (title.length < 3 || title.length > 120) return;

  const date = findDates(lines[at], fallbackYear)[0];
  const start = `${date.date}T${findTimes(lines[at])[0].time}`;

  const afterLabel = (label: RegExp) => {
    const i = lines.findIndex((l) => label.test(l));
    if (i < 0) return;
    const same = lines[i].replace(label, "").replace(/^\W+/, "").trim();
    return same || lines[i + 1];
  };
  const seat = [["Section", /^(?:section|sección|sec)\b\W*/i], ["Row", /^(?:row|fila)\b\W*/i], ["Seat", /^(?:seat|asiento)\b\W*/i]]
    .flatMap(([name, label]) => {
      const value = afterLabel(label as RegExp);
      return value && value.length <= 20 ? [`${name} ${value}`] : [];
    });

  const guide: ActivityGuide = {};
  if (/\bmobile tickets?\b/i.test(body)) guide.beforeYouGo = ["Have your mobile ticket ready in the app or your phone's wallet before you get there."];
  if (/\bcannot be used for (?:event )?entry\b/i.test(body)) (guide.beforeYouGo ??= []).push("This email won't get you in: you need the ticket itself.");

  return {
    title,
    start,
    location: venue,
    category: categoryOf(`${title} ${venue ?? ""}`),
    confirmationCode: body.match(/\border\b[^\n]*?(?:#|number is|number:?)\s*\n?\s*([A-Z0-9][A-Z0-9/-]{4,})/i)?.[1],
    price: findTotalPrice(body),
    notes: seat.length ? seat.join(" · ") : undefined,
    guide,
  };
}
