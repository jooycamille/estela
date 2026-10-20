import type { ActivityGuide, Money } from "../shared/types.ts";
import { defaultDollar, findConfirmation, findDates, findMoney, findTimes, findTotalPrice } from "./emailHeuristics.ts";

// Rule-based parsing of tour/activity/experience bookings (GetYourGuide, Viator, Klook, Airbnb Experiences, operators).

export interface ActivityFields {
  title: string;
  start: string;
  end?: string;
  dateEstimated?: boolean;
  location?: string;
  category?: string;
  confirmationCode?: string;
  price?: Money;
  guide: ActivityGuide;
}

type Section = "bring" | "wear" | "donts" | "dos" | "info" | "meeting" | "end" | "itinerary" | "cancellation" | "stop" | "faq";

// Headings as they appear in booking emails, in priority order. "stop" headings end the current section.
const HEADINGS: [RegExp, Section][] = [
  [/^(?:what to bring|things to bring|what to pack|bring along|please bring)$/i, "bring"],
  [/^(?:what to wear|dress code|clothing)$/i, "wear"],
  [/^(?:not allowed|what not to bring|don'?ts|restrictions|prohibited(?: items)?|not permitted)$/i, "donts"],
  [/^(?:do'?s|dos)$/i, "dos"],
  [/^(?:know before you go|important information|good to know|additional information|please note|important|note from (?:the )?activity provider|before you go|need to know)$/i, "info"],
  [/^(?:meeting point|where to go|where to meet|pickup location|pick-?up location|pickup details|pick-?up point|meeting and pickup|starting point|location)$/i, "meeting"],
  [/^(?:where your activity ends|end point|ending point|drop-?off(?: location)?)$/i, "end"],
  [/^(?:itinerary|schedule|what to expect|programme|program|when to arrive|what to do on the day|your day)$/i, "itinerary"],
  [/^cancellation policy$/i, "cancellation"],
  [/^frequently asked questions$/i, "faq"],
  [/^(?:manage your booking|your mobile ticket|booking reference|pin|check booking details|see activity details|continue your trip.*|we['’]re here to help|questions about your .*|contact(?: us| them)?|your activity provider is .*|includes|what'?s included|cancel(?:lation)?)$/i, "stop"],
];
// Headings that some emails run together with the previous heading ("Important informationWhat to bring").
const GLUED = ["What to bring", "What to wear", "Not allowed", "Know before you go", "Where to go", "When to arrive", "Meeting point", "Pickup location", "Pickup details"];

const ADS = /^(?:you might also like|recommended for you|similar experiences|more things to do|top things to do|customers also booked|explore more)/im;
const PARTICIPANTS = /^\d+\s*(?:x\s*)?(?:adults?|child(?:ren)?|travell?ers?|persons?|people|participants?|guests?|seniors?|students?|youths?)\b/i;
const DURATION = /(?:•|·|\bduration:?)\s*(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|days?)\b/i;

const clean = (s: string) => s.replace(/\[image:[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
const bullet = /^\s*(?:[-•*·▪●]|\d+[.)])\s+/;
const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2);

/** Put each paragraph sentence where a traveller would look for it. */
function categorize(sentence: string): keyof ActivityGuide {
  if (/^(?:please )?(?:do not|don['’]t|never|no)\b|\b(?:not allowed|prohibited|forbidden|not permitted|avoid)\b/i.test(sentence)) return "donts";
  if (/\b(?:paid?|pay|payable)\b.*\bcash\b|\bcash\b.*\b(?:paid?|pay|fee|tax)\b|\b(?:confirm|provide|check your (?:email|phone|messages|whatsapp)|be ready|download|print|reply|send us|let us know|must (?:provide|confirm|book|arrive|bring|show))\b/i.test(sentence)) return "beforeYouGo";
  if (/\b(?:wear|clothes|clothing|shoes|swimsuit|swimwear|dress|attire|footwear)\b/i.test(sentence)) return "whatToWear";
  if (/\b(?:bring|pack)\b|\bcarry (?:your|a|an|some|cash|water|id|passport|sunscreen)\b/i.test(sentence)) return "whatToBring";
  return "goodToKnow";
}

// Marketing filler that adds nothing to a traveller's checklist.
const FLUFF = /^(?:for more information|visit your booking|it['’]s a great|expect comfortable|enjoy (?:a|the|your)\b|you['’]ll love|don['’]t miss)/i;

function push(guide: ActivityGuide, key: keyof ActivityGuide, value: string) {
  const v = value.replace(/\s+/g, " ").trim().replace(/^[-•*]\s*/, "").replace(/\s+\.$/, ".");
  if (!v || FLUFF.test(v)) return;
  const list = ((guide[key] as string[] | undefined) ??= [] as string[]) as string[];
  if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
}

/** Choose the year (start year or the next) that puts day/month inside — or nearest to — the trip. */
function yearFor(month: number, day: number, fallbackYear: number, range?: { startDate: string; endDate: string }) {
  if (!range) return fallbackYear;
  const y0 = +range.startDate.slice(0, 4);
  const iso = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const inside = [y0, y0 + 1].find((y) => iso(y) >= range.startDate && iso(y) <= range.endDate);
  return inside ?? y0;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** GetYourGuide/Viator-style "Cancel before 5:00 pm on 18 December for a full refund" → that moment. */
function cancellationDeadline(text: string, fallbackYear: number, range?: { startDate: string; endDate: string }) {
  const m = text.match(
    /cancel(?:lation is free)?\s+(?:before|by|until|up to)\s+(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?\s+(?:on\s+)?(?:(\d{1,2})\s+([A-Za-z]{3,9})|([A-Za-z]{3,9})\s+(\d{1,2}))(?:,?\s*(\d{4}))?/i,
  );
  if (!m) return;
  const day = +(m[4] ?? m[7]);
  const month = MONTHS.indexOf((m[5] ?? m[6]).slice(0, 3).toLowerCase()) + 1;
  if (!month) return;
  let h = +m[1];
  const p = m[3]?.toLowerCase()[0];
  if (p === "p" && h < 12) h += 12;
  if (p === "a" && h === 12) h = 0;
  const year = m[8] ? +m[8] : yearFor(month, day, fallbackYear, range);
  return new Date(Date.UTC(year, month - 1, day, h, +(m[2] ?? 0)));
}

const toLocal = (d: Date) => d.toISOString().slice(0, 16);

export function parseActivity(text: string, fallbackYear: number, range?: { startDate: string; endDate: string }): ActivityFields | undefined {
  const adsAt = text.search(ADS);
  // Drop email/forwarding header lines ("Date: Wed, Oct 14, 2026 at 12:12 AM" is when it was sent, not the activity).
  let body = (adsAt > 0 ? text.slice(0, adsAt) : text).replace(/^\s*(?:from|date|sent|to|cc|bcc|subject|reply-to):.*$/gim, "");
  // Some emails glue headings together ("Important informationWhat to bring"): split them onto their own lines.
  for (const h of GLUED) body = body.replace(new RegExp(`(\\S)(${h})[ \\t]*(?=\\n|$)`, "g"), "$1\n$2");
  const lines = body.split("\n").map(clean).filter(Boolean);

  // --- Title: the line above the participants line ("1 Adult (Age 7 - 99) • English • 14 hours"), skipping dates.
  const pIdx = lines.findIndex((l) => PARTICIPANTS.test(l));
  let title: string | undefined;
  let titleIdx = -1;
  if (pIdx > 0) {
    // The nearest few lines above may also hold the date and the chosen option ("Small Group in English");
    // the activity name is the longest of them that isn't a sentence.
    const candidates: number[] = [];
    for (let i = pIdx - 1; i >= Math.max(0, pIdx - 6) && candidates.length < 3; i--) {
      const l = lines[i];
      if (/^(?:new|old|was|now)$/i.test(l) || findDates(l, fallbackYear).length > 0 || l.length < 4) continue;
      if (/[.!]$/.test(l) || /\b(?:you|your)\b/i.test(l)) break;
      candidates.push(i);
    }
    titleIdx = candidates.sort((a, b) => lines[b].length - lines[a].length)[0] ?? -1;
    if (titleIdx >= 0) title = lines[titleIdx];
  }
  const labeled = body.match(/^\s*(?:activity|tour|experience|product|event|excursion|attraction)(?: name)?\s*:\s*(.+)$/im)?.[1]?.trim();
  if (labeled) title = labeled;
  if (!title) return;

  // --- Date and time. In "rescheduled" emails the new slot is labelled "New" (old one is struck through in HTML).
  let start: string | undefined;
  let dateEstimated = false;
  const header = lines.slice(Math.max(0, titleIdx), pIdx > 0 ? pIdx + 1 : titleIdx + 6);
  const newIdx = header.findIndex((l) => /^new$/i.test(l));
  const dateLine = header.slice(newIdx >= 0 ? newIdx : 0).find((l) => findDates(l, fallbackYear).length > 0) ??
    body.match(/^\s*(?:date|when|activity date|tour date|date and time)\s*:?\s*(.+)$/im)?.[1];
  if (dateLine) {
    const d = findDates(dateLine, fallbackYear)[0];
    const yearStated = /\b\d{4}\b/.test(dateLine);
    const [, mm, dd] = d.date.split("-").map(Number);
    const date = yearStated ? d.date : `${yearFor(mm, dd, fallbackYear, range)}-${d.date.slice(5)}`;
    start = `${date}T${findTimes(dateLine)[0]?.time ?? "09:00"}`;
  }
  if (!start) {
    // No date in the email: free cancellation typically ends 24 hours before the start.
    const deadline = cancellationDeadline(body, fallbackYear, range);
    if (!deadline) return;
    deadline.setUTCHours(deadline.getUTCHours() + 24);
    start = toLocal(deadline);
    dateEstimated = true;
  }

  // --- Duration → end time
  let end: string | undefined;
  const dur = (header.join(" ").match(DURATION) ?? body.match(DURATION));
  if (dur) {
    const n = Number(dur[1].replace(",", "."));
    const mins = /^d/i.test(dur[2]) ? n * 24 * 60 : /^m/i.test(dur[2]) ? n : n * 60;
    const e = new Date(`${start}:00Z`);
    e.setUTCMinutes(e.getUTCMinutes() + Math.round(mins));
    end = toLocal(e);
  }

  // --- Price: the amount shown with the booking (not the "you might also like" prices, which were cut above).
  const dollar = defaultDollar(text);
  const price =
    lines.slice(Math.max(0, titleIdx), (pIdx > 0 ? pIdx : titleIdx) + 4).map((l) => findMoney(l, dollar)).find(Boolean) ??
    findTotalPrice(body);

  // --- Sections
  const guide: ActivityGuide = {};
  let section: Section | undefined;
  let buffer: string[] = [];
  const meeting: string[] = [];
  const faq: { q: string; a: string[] }[] = [];
  const flush = () => {
    const paragraph = buffer.join(" ");
    buffer = [];
    if (!paragraph || !section) return;
    if (section === "cancellation") guide.cancellation ??= paragraph;
    else if (section === "end") guide.endPoint ??= sentences(paragraph)[0];
    else if (section === "itinerary") sentences(paragraph).forEach((s) => (/^\d{1,2}[:.]\d{2}/.test(s) ? push(guide, "itinerary", s) : push(guide, categorize(s), s)));
    else sentences(paragraph).forEach((s) => push(guide, categorize(s), s));
  };
  for (const line of lines) {
    const heading = HEADINGS.find(([re]) => re.test(line))?.[1];
    if (heading) {
      flush();
      section = heading;
      continue;
    }
    if (!section || section === "stop") continue;
    if (section === "faq") {
      if (/\?$/.test(line)) faq.push({ q: line, a: [] });
      else faq.at(-1)?.a.push(line);
      continue;
    }
    if (bullet.test(line) && ["bring", "wear", "donts", "dos"].includes(section)) {
      flush();
      const key = ({ bring: "whatToBring", wear: "whatToWear", donts: "donts", dos: "dos" } as const)[section as "bring"];
      push(guide, key, line.replace(bullet, ""));
      continue;
    }
    if (section === "meeting") {
      // Address lines (possibly wrapped) and pickup times; other sentences are categorised.
      if (/^(?:pick-?up|meet(?:ing)?|start)\b.*\b\d{1,2}[:.]\d{2}\s*[ap]\.?m/i.test(line)) {
        meeting.push(line);
        push(guide, "itinerary", `${findTimes(line)[0] ? line.match(/\d{1,2}[:.]\d{2}\s*[ap]\.?m\.?/i)![0].toUpperCase() : ""} – ${/pick/i.test(line) ? "Pickup" : "Meet"}`.trim());
        continue;
      }
      if (meeting.length === 0 || /,\s*$/.test(meeting.at(-1)!)) {
        if (meeting.length && /,\s*$/.test(meeting.at(-1)!)) meeting[meeting.length - 1] += ` ${line}`;
        else meeting.push(line);
        continue;
      }
      buffer.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  if (meeting.length) guide.meetingPoint = meeting.join(" · ");

  // FAQ answers often describe the day itself, and what to wear.
  for (const { q, a } of faq) {
    const answer = sentences(a.join(" "));
    if (/\b(?:included in the tour|activities are (?:included|part)|journey|itinerary|expect during|what happens|how will i get back|schedule|what does the .* include|island activities|start(?:s)? with)\b/i.test(q)) {
      answer.forEach((s) => push(guide, "itinerary", s));
    } else if (/\bwear\b/i.test(q) && !guide.whatToWear?.length) {
      answer.forEach((s) => push(guide, "whatToWear", s));
    }
  }

  // Provider, PIN
  const provider = body.match(/your (?:activity )?(?:provider|operator|host|guide) is\s+([^\n]+)/i)?.[1]?.trim();
  const phone = provider && body.slice(body.search(/your (?:activity )?(?:provider|operator|host|guide) is/i)).match(/\+\d[\d ()-]{6,}\d/)?.[0];
  if (provider) guide.provider = phone ? `${provider} · ${phone}` : provider;
  const pin = body.match(/^\s*PIN(?: code)?\s*:?\s*\n\s*(\S{4,16})\s*$/im)?.[1] ?? body.match(/\bPIN(?: code)?\s*:\s*(\S{4,16})/i)?.[1];
  if (pin) guide.pin = pin;
  if (dateEstimated) push(guide, "beforeYouGo", "Confirm the date and start time in your booking — the email didn't state it, so it was estimated from the cancellation deadline.");

  const category = title.match(/\b(class|cruise|tour|show|tasting|museum|workshop|hike|safari|concert|ticket|excursion|dinner|lesson)\b/i)?.[1]?.toLowerCase();
  const location = guide.meetingPoint?.split(" · ")[0];

  return { title, start, end, dateEstimated, location, category, confirmationCode: findConfirmation(body), price, guide };
}
