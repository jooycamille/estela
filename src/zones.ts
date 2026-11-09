// Time zones in the browser. Booking times are wall-clock times where they happen ("2026-12-21T13:23" in Bogotá);
// these turn them into real moments, and say how far apart two places are.

/** Minutes the zone is ahead of UTC at a moment (e.g. -300 for Bogotá). */
export function offsetMinutes(tz: string, atMs = Date.now()) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(atMs))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
  } catch {
    return 0;
  }
}

/** "2026-12-21T13:23" in a zone → milliseconds since 1970. Without a zone, the device's own. */
export function wallToMs(wall: string, tz?: string) {
  const [d, t = "00:00"] = wall.slice(0, 16).split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  if (!tz) return new Date(y, m - 1, day, h, min).getTime();
  const guess = Date.UTC(y, m - 1, day, h, min);
  let ms = guess - offsetMinutes(tz, guess) * 60_000;
  ms = guess - offsetMinutes(tz, ms) * 60_000; // again, in case daylight saving changes in between
  return ms;
}

/** A moment as wall-clock time in a zone: "2026-12-21T13:23". */
export function msToWall(ms: number, tz?: string) {
  const shifted = tz ? ms + offsetMinutes(tz, ms) * 60_000 : ms - new Date(ms).getTimezoneOffset() * 60_000;
  return new Date(shifted).toISOString().slice(0, 16);
}

/** "now" where a zone is (or on this device). */
export const nowIn = (tz?: string) => msToWall(Date.now(), tz);

/** How far `tz` is from `from`, in hours: "+6", "-1.5" or 0. */
export function hoursApart(tz: string, from: string, atMs = Date.now()) {
  return (offsetMinutes(tz, atMs) - offsetMinutes(from, atMs)) / 60;
}

const hrs = (h: number) => {
  const a = Math.abs(h);
  const whole = Math.floor(a), mins = Math.round((a - whole) * 60);
  return mins ? `${whole} h ${mins} min` : `${whole} hour${whole === 1 ? "" : "s"}`;
};

/** "6 hours ahead of home", "1 h 30 min behind home", or undefined when it's the same time. */
export function differenceText(tz: string, from: string, label = "home", atMs = Date.now()) {
  const h = hoursApart(tz, from, atMs);
  if (!h) return undefined;
  return `${hrs(h)} ${h > 0 ? "ahead of" : "behind"} ${label}`;
}

/** Short name of a zone's city: "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export const zoneCity = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");
