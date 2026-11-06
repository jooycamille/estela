// Which dates an activity is on, so one that runs for several days shows on each of them.

const LATE_NIGHT_UNTIL = "06:00"; // ending before this is a late night out, not another day of it
const MOST_DAYS = 31; // anything longer is more likely a mistyped end date, so it stays on its start date

export function activityDays(activity: { start: string; end?: string }): string[] {
  const first = activity.start.slice(0, 10);
  if (!activity.end || activity.end <= activity.start) return [first];
  const days: string[] = [];
  const last = activity.end.slice(0, 10);
  for (let d = new Date(`${first}T12:00:00Z`); d.toISOString().slice(0, 10) <= last; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  if (days.length > MOST_DAYS) return [first];
  if (days.length > 1 && activity.end.slice(11, 16) < LATE_NIGHT_UNTIL) days.pop();
  return days;
}
