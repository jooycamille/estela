import { isEnglish, locale } from "./i18n.ts";

// Times are stored as local wall-clock strings (YYYY-MM-DDTHH:mm), so format without time-zone conversion.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDay(d: string) {
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  if (!isEnglish()) return new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(dt);
  return `${DAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** "Dec" / "dic" and "Wed" / "mié": short month and weekday names in the app's language (dates in UTC). */
export const shortMonth = (dt: Date) =>
  isEnglish() ? MONTHS[dt.getUTCMonth()] : new Intl.DateTimeFormat(locale(), { month: "short", timeZone: "UTC" }).format(dt);
export const shortWeekday = (dt: Date) =>
  isEnglish() ? DAYS[dt.getUTCDay()] : new Intl.DateTimeFormat(locale(), { weekday: "short", timeZone: "UTC" }).format(dt);

export function formatDateRange(a: string, b: string) {
  return `${formatDay(a)} – ${formatDay(b)} ${b.slice(0, 4)}`;
}

export const formatTime = (t?: string) => (t ? t.slice(11, 16) : "");

/** "13:20" or "Tue, 4 Nov 13:20" when the date differs from `sameDayAs`. */
export function formatTimeOn(t: string | undefined, sameDayAs: string) {
  if (!t) return "";
  return t.slice(0, 10) === sameDayAs.slice(0, 10) ? formatTime(t) : `${formatDay(t)} ${formatTime(t)}`;
}
