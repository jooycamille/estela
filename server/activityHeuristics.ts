import type { ActivityGuide, Money } from "../shared/types.ts";
import { defaultDollar, findConfirmation, findDates, findMoney, findTimes, findTotalPrice } from "./emailHeuristics.ts";

// Rule-based parsing of tour/activity/experience bookings (GetYourGuide, Viator, Klook, Airbnb Experiences, operators).

export interface ActivityFields {
  title: string;
  start: string;
  end?: string;
  dateEstimated?: boolean;
  fromReceipt?: boolean; // only an invoice or payment receipt: a later booking email fills in the rest
  notes?: string;
  location?: string;
  category?: string;
  confirmationCode?: string;
  price?: Money;
  guide: ActivityGuide;
}

type Section = "included" | "notIncluded" | "bring" | "wear" | "donts" | "dos" | "info" | "meeting" | "end" | "itinerary" | "cancellation" | "stop" | "faq";

// Headings as they appear in booking emails, in priority order. "stop" headings end the current section.
const HEADINGS: [RegExp, Section][] = [
  [/^\W*(?:what['’]?s not included|what is not included|not included|excluded|excludes|exclusions|price does not include|does not include)\W*$/i, "notIncluded"],
  [/^\W*(?:what['’]?s included|what is included|included|includes|inclusions|price includes|this (?:tour|activity|experience) includes)\W*$/i, "included"],
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
  if (!/\?$/.test(sentence)) {
    if (/\b(?:not included|isn['’]t included|not covered|additional charge|extra charge|extra cost|at your own expense)\b/i.test(sentence)) return "notIncluded";
    if (/\b(?:is|are|and|drop[- ]?off|pick[- ]?up|lunch|breakfast|dinner|entry|entrance|transport(?:ation)?)\s+(?:is\s+|are\s+)?included\b/i.test(sentence)) return "included";
  }
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

// ---------- Only an invoice or payment receipt ----------

const RECEIPT_WORD = /\b(?:receipts?|invoices?|payment (?:confirmation|confirmed|received|successful))\b/i;
const NOT_ACTIVITY_RECEIPT = /\b(?:e-?tickets?|electronic ticket|boarding pass)\b/i;
const TITLE_LABEL = /^\W*(?:trip|tour|activity|experience|event|excursion|product|service|package|class|item|description)(?: name| title| details?)?\W*:\s*(.*)$/i;
const TITLE_TABLE = /^\W*(?:description|items?|services?|products?)\b.*\b(?:qty|quantity|amount|price|total|rate|unit)\b/i;
const LINE_ITEM = /^\W*(?:\d+\s*[x×]\s+)?(.+?)\s+(?:[x×]\s*\d+\s+)?\W*(?:[A-Z]{1,3}\W?)?\d[\d.,]*\W*(?:[A-Z]{3})?\W*$/;
const NOT_A_TITLE = /^(?:sub-?total|total|tax|gst|vat|fees?|service fee|processing fee|amount|balance|discount|deposit|paid|payment|price|n\/a|none)\b|^[\W\d]*$/i;
// "Trip Date: Dec 31" says when it is. "Invoice date", "Date paid" and a bare "Date" only say when it was paid.
const ACTIVITY_DATE = /^\W*(?:(?:trip|tour|activity|experience|event|excursion|class|travel|service|departure|start|visit)\s+date|date of (?:the )?(?:trip|tour|activity|experience|event|class|travel|service|visit)|departure|departs|starts?)\W*(?::\s*(.*))?$/i;
const PAX = /^\d+\s*(?:pax|people|persons?|guests?|adults?|travell?ers?|participants?)$/i;

const subjects = (text: string) =>
  [...text.matchAll(/^\W*subject:\s*(.+)$/gim)].map((m) => m[1].replace(/^(?:\s*(?:fwd?|re)\s*:\s*)+/i, "").trim());

function isReceipt(text: string) {
  if (NOT_ACTIVITY_RECEIPT.test(subjects(text).join(" "))) return false;
  return subjects(text).some((s) => RECEIPT_WORD.test(s)) ||
    /^\W*(?:customer |payment |tax |booking |your |sales )?(?:receipt|invoice)\b[^.!?\n]{0,40}$/im.test(text);
}

/** "E-bike tour - Sam Example- 1 pax" → "E-bike tour": the name of the thing, without who's going. */
function receiptTitle(raw: string, participant?: string) {
  return raw
    .replace(/\*/g, "")
    .split(/\s+[-–—]\s*|\s*[-–—]\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !PAX.test(part) && part.toLowerCase() !== participant?.toLowerCase())
    .join(" – ")
    .trim();
}

function parseReceipt(text: string, body: string, lines: string[], fallbackYear: number, range?: { startDate: string; endDate: string }): ActivityFields | undefined {
  if (!isReceipt(text)) return;
  const usable = (t?: string) => (t && t.length >= 3 && t.length <= 150 && !NOT_A_TITLE.test(t) ? t : undefined);
  const plain = lines.map((l) => l.replace(/\*/g, "").trim());
  const valueAfter = (i: number, sameLine?: string) => sameLine?.trim() || (plain[i + 1] && !/:\s*$/.test(plain[i + 1]) ? plain[i + 1] : undefined);
  const participant = plain.map((l) => l.match(/^(?:participant|travell?er|customer|guest|lead traveller|billed to)\s*:\s*(.+)$/i)?.[1]).find(Boolean)?.trim();

  // --- What it's for: a labelled name, the invoice's first line, the subject, and at least who it's from.
  let raw: string | undefined;
  for (let i = 0; i < plain.length && !raw; i++) {
    const m = plain[i].match(TITLE_LABEL);
    if (m) raw = usable(valueAfter(i, m[1]));
  }
  if (!raw) {
    const heading = plain.findIndex((l) => TITLE_TABLE.test(l));
    if (heading >= 0) raw = usable(plain[heading + 1]?.match(LINE_ITEM)?.[1] ?? plain[heading + 1]);
  }
  if (!raw) raw = plain.map((l) => (/[x×]\s*\d+\s|^\d+\s*[x×]\s/.test(l) ? l.match(LINE_ITEM)?.[1] : undefined)).find((t) => usable(t));
  for (const subject of subjects(text)) {
    raw ??= usable(subject.match(/(?:receipt|invoice|payment)\b(?:\s+(?:#|no\.?|number)?\s*[\w-]*\d[\w-]*)?\s*(?:[-–—:]|\bfor\b)\s*(.+)$/i)?.[1]);
  }
  if (!raw) {
    const merchant = [...subjects(text), ...plain].map((l) => l.match(/\b(?:receipt|invoice|payment)\s+(?:from|to)\s+(.+?)(?:\s+#.*)?$/i)?.[1]).find(Boolean);
    raw = usable(merchant?.replace(/[.!]$/, ""));
  }
  const title = raw && receiptTitle(raw, participant);
  if (!title) return;

  // --- When: only a date that says it's the activity's, or one in its name. Otherwise it's a guess within the trip.
  const dated = (value?: string) => {
    const d = value && findDates(value, fallbackYear)[0];
    if (!d) return;
    const [, mm, dd] = d.date.split("-").map(Number);
    const date = /\b\d{4}\b/.test(value) ? d.date : `${yearFor(mm, dd, fallbackYear, range)}-${d.date.slice(5)}`;
    return { date, time: findTimes(value)[0]?.time };
  };
  let when: { date: string; time?: string } | undefined;
  for (let i = 0; i < plain.length && !when; i++) {
    const m = plain[i].match(ACTIVITY_DATE);
    if (m) when = dated(valueAfter(i, m[1]));
  }
  when ??= dated(raw);
  if (!when && !range) return;
  const dateEstimated = !when;
  const start = `${when?.date ?? range!.startDate}T${when?.time ?? "09:00"}`;

  // --- The rest. The receipt's own number isn't a booking reference, so it goes in the notes.
  const receiptLine = /\b(?:receipt|invoice|transaction|payment)\b/i;
  const ref = findConfirmation(body.split("\n").filter((l) => !receiptLine.test(l)).join("\n"));
  const receiptNo = plain.map((l) => l.match(/\b(?:receipt|invoice)\s*(?:number|no\.?|#)\s*:?\s*#?([\w-]*\d[\w-]*)/i)?.[1]).find(Boolean);
  const total = findTotalPrice(body);
  const place = plain.map((l, i) => usable(l.match(/^(?:destination|location|venue|meeting point)\s*:\s*(.+)$/i)?.[1] ?? (/^(?:destination|location|venue)\s*:$/i.test(l) && !/^-+$/.test(plain[i + 1] ?? "") ? valueAfter(i) : undefined))).find(Boolean);

  const guide: ActivityGuide = {};
  const operator = text.match(/forwarded message[^\n]*\n\s*from:\s*([^<\n]+)/i)?.[1];
  if (operator?.trim() && !/@/.test(operator)) guide.provider = operator.trim();
  if (dateEstimated) push(guide, "beforeYouGo", "Confirm the date and start time in your booking — this came from a receipt that doesn't say when it is, so the date is a placeholder.");
  else if (!when?.time) push(guide, "beforeYouGo", "Check the start time in your booking — this came from a receipt that doesn't give one.");

  return {
    title,
    start,
    dateEstimated,
    fromReceipt: true,
    location: place,
    category: title.match(/\b(class|cruise|tour|show|tasting|museum|workshop|hike|safari|concert|ticket|excursion|dinner|lesson)\b/i)?.[1]?.toLowerCase(),
    confirmationCode: ref,
    price: total && total.amount > 0 ? total : undefined,
    notes: receiptNo ? `Paid · receipt ${receiptNo}` : "Paid",
    guide,
  };
}

export function parseActivity(text: string, fallbackYear: number, range?: { startDate: string; endDate: string }): ActivityFields | undefined {
  const adsAt = text.search(ADS);
  // Drop email/forwarding header lines ("Date: Wed, Oct 14, 2026 at 12:12 AM" is when it was sent, not the activity).
  let body = (adsAt > 0 ? text.slice(0, adsAt) : text).replace(/^\s*(?:from|date|sent|to|cc|bcc|subject|reply-to):.*$/gim, "");
  // Some emails glue headings together ("Important informationWhat to bring"): split them onto their own lines.
  for (const h of GLUED) body = body.replace(new RegExp(`(\\S)(${h})[ \\t]*(?=\\n|$)`, "g"), "$1\n$2");
  // A message from the operator via Viator or Tripadvisor names the tour and date only in a (wrapped) sentence:
  // "regarding your booking reference 123 for Blue Lagoon Tour on Dec 14, 2026." Put each on its own line.
  const operatorMessage = body.match(/regarding your booking\s+reference\s+\S+(?:\s*<[^>\n]*>)?\s+for\s+([\s\S]{6,200}?)\s+on\s+([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Z][a-z]{2,8}\.?,?\s+\d{4})/);
  if (operatorMessage) {
    const [sentence, name, when] = operatorMessage;
    body = body.replace(sentence, `\n${name.replace(/\s+/g, " ")}\n${when.replace(/\s+/g, " ")}\n`);
  }
  const lines = body.split("\n").map(clean).filter(Boolean);

  // --- Title: the line above the participants line ("1 Adult (Age 7 - 99) • English • 14 hours"), skipping dates.
  const pIdx = lines.findIndex((l) => PARTICIPANTS.test(l));
  // An invoice's or receipt's dates are mostly about the payment, so it has its own, stricter rules.
  if (pIdx < 0 && !operatorMessage && isReceipt(text)) {
    const receipt = parseReceipt(text, body, lines, fallbackYear, range);
    if (receipt) return receipt;
  }
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
  if (operatorMessage) title = operatorMessage[1].replace(/\s+/g, " ");
  // Agoda: under "Activity details", "Activity <name>" with no colon (possibly wrapped), then "Date …".
  if (!title && /^\s*activity details\s*$/im.test(body)) {
    const m = body.match(/^\s*Activity\s+(?!details\b|provider\b|voucher\b)([A-Z0-9][\s\S]{6,200}?)\n\s*(?:Date|When)\b/m);
    if (m) title = clean(m[1].replace(/\s+/g, " "));
  }
  // A message from the provider (GetYourGuide): the name is in the image caption above "Booking reference".
  if (!title) {
    const at = body.search(/^\s*booking reference\s*$/im);
    const captions = at > 0 ? [...body.slice(0, at).matchAll(/\[image:\s*([^\]]+)\]/g)].map((c) => c[1].replace(/\s+/g, " ").trim()) : [];
    title = captions.filter((c) => c.length >= 12 && !/\b(?:logo|icon)\b/i.test(c)).at(-1);
    // Pasted emails lose captions: then it's the text just above "Booking reference" (it may wrap over lines).
    if (!title && at > 0) {
      const above = body.slice(0, at).split("\n").map(clean).filter(Boolean);
      const start = above.reduce((last, l, i) => (/[.!?]$|sent you a message|^\W*$/i.test(l) ? i : last), -1);
      const name = above.slice(start + 1).join(" ");
      if (name.length >= 8 && name.length <= 200) title = name;
    }
  }
  if (!title) return parseReceipt(text, body, lines, fallbackYear, range);
  // Where the name appears, so the date and price are looked for around it.
  if (titleIdx < 0) titleIdx = lines.findIndex((l) => l.includes(title!.slice(0, 25)));

  // --- Date and time. In "rescheduled" emails the new slot is labelled "New" (old one is struck through in HTML).
  let start: string | undefined;
  let dateEstimated = false;
  const header = lines.slice(Math.max(0, titleIdx), pIdx > 0 ? pIdx + 1 : titleIdx + 6);
  const newIdx = header.findIndex((l) => /^new$/i.test(l));
  // Newer GetYourGuide emails put the date just above the name ("December 10, 2026 at 4:15 AM", then the name).
  const aboveTitle = titleIdx > 0 ? lines.slice(Math.max(0, titleIdx - 3), titleIdx).reverse().find((l) => findDates(l, fallbackYear).length > 0) : undefined;
  // Else a labelled line ("Date: …", "When: …"): the first that holds a date ("When: meet at the pier" doesn't).
  const dateLine = header.slice(newIdx >= 0 ? newIdx : 0).find((l) => findDates(l, fallbackYear).length > 0) ??
    aboveTitle ??
    [...body.matchAll(/^\s*(?:date|when|activity date|tour date|date and time)\s*:?\s*(.+)$/gim)].map((m) => m[1]).find((l) => findDates(l, fallbackYear).length > 0);
  // (A "When:" line may not hold a date at all, e.g. "When: see your ticket".)
  const d = dateLine ? findDates(dateLine, fallbackYear)[0] : undefined;
  if (dateLine && d) {
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
    if (section === "included" || section === "notIncluded") {
      // A list, one per line: anything long is prose that's run on past it.
      const entry = line.replace(/^\s*(?:[-•*·▪●✓✔✗✘×x]|\d+[.)])\s+/i, "").trim();
      if (entry.length <= 120) push(guide, section, entry);
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
  // Messages from providers: "Pickup: Address: 12 Main St, City || Name: Hotel" and "ACTION NEEDED: Please send…".
  if (!guide.meetingPoint) {
    const pickup = body.match(/^\W*pick-?up\s*:\s*(?:address\s*:\s*)?([\s\S]{5,250}?)(?:\|\||\n\s*\n|\n\s*[A-Z ]{6,}:)/im)?.[1];
    if (pickup) guide.meetingPoint = pickup.replace(/\s+/g, " ").trim();
  }
  const action = body.match(/^\W*action (?:needed|required)\s*:\s*([\s\S]{5,400}?)(?:\n\s*\n|\n\W*(?:if you have|we're looking|reply to)\b)/im)?.[1];
  if (action) for (const sentence of sentences(action.replace(/\s+/g, " ").trim())) push(guide, "beforeYouGo", sentence);

  // Their reminders: "IMPORTANT REMINDER:" then bullets (cash only, carry a passport, what to bring).
  const reminders = body.match(/^\W*important reminders?\s*:\s*\n([\s\S]{5,1500}?)(?:\n\s*\n|\n\W*(?:if you have|we're looking|we are looking)\b)/im)?.[1];
  if (reminders) {
    for (const item of reminders.split(/^\s*[•*-]\s*/m)) {
      for (const sentence of sentences(item.replace(/\s+/g, " ").trim())) push(guide, categorize(sentence), sentence);
    }
  }

  // Terms stated outside a "Cancellation policy" section.
  if (!guide.cancellation) {
    const terms = body.match(/^[^\n]*\b(?:free cancell?ation|non[- ]?refundable|fully refundable|cancel (?:before|by|until|up to)\b[^\n]*refund)[^\n]*$/im)?.[0];
    if (terms && terms.length <= 200) guide.cancellation = clean(terms);
  }

  const location = guide.meetingPoint?.split(" · ")[0];

  return { title, start, end, dateEstimated, location, category, confirmationCode: findConfirmation(body), price, guide };
}
