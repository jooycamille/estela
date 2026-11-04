// What a booking's cancellation terms come to, from their wording. The tag on the card and the reminders both use this,
// so they can't disagree. Works from the saved text, so bookings imported earlier are covered too.

export type Cancellation =
  | { kind: "free"; until?: string; timed?: boolean } // until: YYYY-MM-DDTHH:mm at the activity's local time
  | { kind: "partial" }
  | { kind: "nonrefundable" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function minusFromStart(start: string, amount: number, unit: string) {
  const hours = /^d/i.test(unit) ? amount * 24 : amount;
  return new Date(Date.parse(`${start.slice(0, 16)}:00Z`) - hours * 3_600_000).toISOString().slice(0, 16);
}

function namedDeadline(text: string, start: string) {
  const date = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?/g)?.map((m) => m.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?(?:\s+(\d{4}))?/)!)
    .map((m) => ({ day: +m[1], month: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), year: m[3] && +m[3] }))
    .find((d) => d.month >= 0)
    ?? text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/g)?.map((m) => m.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/)!)
      .map((m) => ({ day: +m[2], month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), year: m[3] && +m[3] }))
      .find((d) => d.month >= 0);
  if (!date) return;
  const time = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i) ?? text.match(/\b(\d{1,2}):(\d{2})\b/);
  let hour = time ? +time[1] : 0;
  const meridiem = time?.[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  const stamp = (year: number) => `${year}-${pad(date.month + 1)}-${pad(date.day)}T${pad(hour)}:${time?.[2] ?? "00"}`;
  // No year given: the last such date before the activity.
  let year = date.year || +start.slice(0, 4);
  if (!date.year && stamp(year) > start.slice(0, 16)) year--;
  return { until: stamp(year), timed: !!time };
}

export function cancellationOf(item: { start: string; guide?: { cancellation?: string } }): Cancellation | undefined {
  const text = item.guide?.cancellation?.replace(/\s+/g, " ").trim();
  if (!text) return;
  const noRefund = /\bnon[- ]?refundable\b|\bno refunds?\b|\bnot refundable\b|\bcan(?:'|’|no)t be cancell?ed\b|\bcannot be cancell?ed\b/i.test(text);
  const free = /\bfree cancell?ation\b|\brisk[- ]free\b|\bcancell?ation is free\b|\bcancel for free\b|\bfull(?:y)? refund|\bfully refundable\b|\bcancel\s+(?:before|by|until|up to)\b/i.test(text);
  const before = text.match(/\b(\d{1,3})\s*(hours?|hrs?|days?)\s*(?:before|prior|in advance|ahead)\b/i);
  const within = noRefund && !free ? text.match(/\bwithin\s+(\d{1,3})\s*(hours?|hrs?|days?)\b/i) : undefined;
  const relative = before ?? within;
  if (free || within) {
    if (relative) return { kind: "free", until: minusFromStart(item.start, +relative[1], relative[2]), timed: true };
    const named = namedDeadline(text, item.start);
    return named ? { kind: "free", ...named } : { kind: "free" };
  }
  if (noRefund) return { kind: "nonrefundable" };
  if (/\b\d{1,3}\s*%\s*(?:refund|back)\b|\bpartial(?:ly)? refund/i.test(text)) return { kind: "partial" };
}

/** The flight a ride is for: by the number in its email, or for a drop-off, the next flight from that airport. */
export function flightForTransfer<F extends { flightNumber: string; from: string; to: string; departureTime: string; arrivalTime?: string }>(
  ride: { start: string; flightNumber?: string; transferLeg?: string; title: string },
  flights: F[],
): F | undefined {
  const day = (t: string) => Date.parse(`${t.slice(0, 10)}T00:00:00Z`);
  const near = (t?: string) => !!t && Math.abs(day(t) - day(ride.start)) <= 86_400_000;
  const number = ride.flightNumber?.replace(/\s+/g, "").toUpperCase();
  if (number) {
    const match = flights.find((f) => f.flightNumber === number && (near(f.arrivalTime) || near(f.departureTime)));
    if (match) return match;
  }
  if (ride.transferLeg === "dropoff") {
    const code = ride.title.match(/→\s*([A-Z]{3})\b/)?.[1];
    return code ? flights.filter((f) => f.from === code && f.departureTime >= ride.start.slice(0, 16)).sort((a, b) => a.departureTime.localeCompare(b.departureTime))[0] : undefined;
  }
}
