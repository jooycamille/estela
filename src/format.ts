// Times are stored as local wall-clock strings (YYYY-MM-DDTHH:mm), so format without time-zone conversion.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDay(d: string) {
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return `${DAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function formatDateRange(a: string, b: string) {
  return `${formatDay(a)} – ${formatDay(b)} ${b.slice(0, 4)}`;
}

export const formatTime = (t?: string) => (t ? t.slice(11, 16) : "");

/** "13:20" or "Tue, 4 Nov 13:20" when the date differs from `sameDayAs`. */
export function formatTimeOn(t: string | undefined, sameDayAs: string) {
  if (!t) return "";
  return t.slice(0, 10) === sameDayAs.slice(0, 10) ? formatTime(t) : `${formatDay(t)} ${formatTime(t)}`;
}
