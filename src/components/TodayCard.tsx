import { useEffect, useState } from "react";
import { BedDouble, Navigation, Paperclip, Sunrise } from "lucide-react";
import type { ItineraryItem, Trip } from "../../shared/types.ts";
import type { DayPlans, TripDays } from "../api.ts";
import { activityDays } from "../../shared/days.ts";
import { stayFor } from "../../shared/stays.ts";
import { formatDay, formatTime } from "../format.ts";
import { attachmentUrl } from "../files.ts";
import { itemIcon } from "../icons.ts";
import { DayWeatherChip } from "../tripDays.tsx";
import { nowIn, wallToMs } from "../zones.ts";
import Ico from "./Ico.tsx";

// Today, while a trip is on: what's next and how long until it, how to get there, the booking reference and tickets,
// then the rest of the day, where you sleep tonight and what's first tomorrow.

type Moment = { item: ItineraryItem; at: number; time: string; title: string; label?: string; allDay?: boolean };

const dayAfter = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);

/** Everything that happens on a day, in order, as moments in real time. */
function momentsOn(day: string, items: ItineraryItem[], days?: TripDays): Moment[] {
  const tz = days?.days[day]?.tz;
  const out: Moment[] = [];
  for (const i of items) {
    if (i.kind === "flight") {
      const dep = i.live?.departureTime ?? i.departureTime;
      if (dep.slice(0, 10) !== day) continue;
      out.push({ item: i, at: wallToMs(dep, days?.airports[i.from.toUpperCase()] ?? tz), time: formatTime(dep), title: `${i.flightNumber} ${i.from} → ${i.to}`, label: "Flight" });
    } else if (i.kind === "stay") {
      if (i.checkIn.slice(0, 10) === day) out.push({ item: i, at: wallToMs(i.checkIn, tz), time: formatTime(i.checkIn), title: i.name, label: "Check in" });
      if (i.checkOut.slice(0, 10) === day) out.push({ item: i, at: wallToMs(i.checkOut, tz), time: formatTime(i.checkOut), title: i.name, label: "Check out" });
    } else {
      const on = activityDays(i);
      if (!on.includes(day)) continue;
      const first = on[0] === day;
      out.push({ item: i, at: first ? wallToMs(i.start, tz) : wallToMs(`${day}T00:00`, tz), time: first ? formatTime(i.start) : "", title: i.title, allDay: !first });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function countdown(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `in ${h} h${m ? ` ${m} min` : ""}`;
  return h < 48 ? "tomorrow" : `in ${Math.round(h / 24)} days`;
}

/** Directions to where a booking happens (an airport by its code). */
function directionsTo(i: ItineraryItem) {
  const dest = i.kind === "flight" ? `${i.from} airport`
    : i.kind === "stay" ? (i.lat !== undefined ? `${i.lat},${i.lon}` : [i.name, i.address].filter(Boolean).join(", "))
    : i.lat !== undefined ? `${i.lat},${i.lon}` : i.location;
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : undefined;
}

/** The trip's "today", in the time zone of where you are (on this device's clock before the trip). */
export function tripToday(trip: Trip, days?: TripDays) {
  const deviceToday = nowIn().slice(0, 10);
  const tz = days?.days[deviceToday]?.tz;
  return tz ? nowIn(tz).slice(0, 10) : deviceToday;
}

/** Shows from the day before the trip to its last day. */
export const showsToday = (trip: Trip, today: string) => dayAfter(today) >= trip.startDate && today <= trip.endDate;

export default function TodayCard({ trip, items, plans, days, onShowDay }: { trip: Trip; items: ItineraryItem[]; plans: DayPlans; days?: TripDays; onShowDay: (day: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const today = tripToday(trip, days);
  if (!showsToday(trip, today)) return null;
  const before = today < trip.startDate;
  const tomorrow = dayAfter(today);
  const todays = momentsOn(today, items, days);
  const upcoming = [...todays, ...momentsOn(tomorrow, items, days)].filter((m) => !m.allDay && m.at > now - 15 * 60_000);
  const next = upcoming[0];
  const later = todays.filter((m) => m !== next);
  const tonight = stayFor(trip, items, today);
  const firstTomorrow = momentsOn(tomorrow, items, days).find((m) => m !== next);
  const places = plans[today]?.entries ?? [];
  const weather = days?.days[today]?.weather;
  const route = next && directionsTo(next.item);
  const ref = next?.item.confirmationCode;
  const files = next?.item.attachments ?? [];

  return (
    <section className="today-card card" aria-labelledby="today-title">
      <div className="today-head">
        <div>
          <span className="today-kicker">{before ? "Tomorrow your trip begins" : `Today · Day ${daysBetween(trip.startDate, today) + 1} of ${daysBetween(trip.startDate, trip.endDate) + 1}`}</span>
          <h2 id="today-title">{formatDay(today)}{days?.days[today]?.city && !before ? <span className="today-where"> in {days.days[today].city}</span> : null}</h2>
        </div>
        {weather && <DayWeatherChip w={weather} />}
      </div>

      {next ? (
        <div className="today-next">
          <span className="today-label">Next{next.label ? ` · ${next.label}` : ""}</span>
          <div className="today-next-main">
            <span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(next.item)} /></span>
            <div>
              <b>{next.title}</b>
              <span className="today-when">
                {next.at > now ? countdown(next.at - now) : "now"}
                {next.time && ` · ${!todays.includes(next) ? "tomorrow " : ""}${next.time}`}
                {next.item.kind === "flight" && next.item.live?.departureGate && ` · Gate ${next.item.live.departureGate}`}
                {next.item.kind === "flight" && next.item.live?.departureTerminal && ` · Terminal ${next.item.live.departureTerminal}`}
              </span>
              {next.item.kind === "flight" && next.item.baggage && (
                <span className="today-when">Bags: {[next.item.baggage.cabin && `cabin ${next.item.baggage.cabin}`, next.item.baggage.checked && `checked ${next.item.baggage.checked}`].filter(Boolean).join(" · ")}</span>
              )}
            </div>
          </div>
          <div className="today-actions">
            {route && <a className="button secondary" href={route} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden="true" /> Directions</a>}
            {files.map((f) => (
              <a key={f.id} className="button secondary" href={attachmentUrl(f.id)} target="_blank" rel="noopener noreferrer"><Paperclip aria-hidden="true" /> {files.length > 1 ? f.filename : "Ticket"}</a>
            ))}
            {ref && <span className="today-ref">Ref <b>{ref}</b></span>}
          </div>
        </div>
      ) : (
        <p className="muted today-none">{todays.length || places.length ? "Nothing else at a set time today." : "Nothing planned for today. A free day."}</p>
      )}

      {(later.length > 0 || places.length > 0 || trip.dayNotes?.[today]) && !before && (
        <div className="today-rest">
          <span className="today-label">Also today</span>
          <ul>
            {later.map((m) => (
              <li key={`${m.item.id}:${m.label ?? ""}`} className={m.at < now - 15 * 60_000 && !m.allDay ? "done" : ""}>
                <span className="today-time">{m.allDay ? "All day" : m.time}</span> {m.label && m.label !== "Flight" ? `${m.label}: ` : ""}{m.title}
              </li>
            ))}
            {places.length > 0 && <li><span className="today-time" /> {places.length === 1 ? places[0].title : `${places.length} places to visit`}</li>}
          </ul>
          {trip.dayNotes?.[today] && <p className="today-note small">{trip.dayNotes[today]}</p>}
        </div>
      )}

      <div className="today-foot small">
        {tonight && <span><BedDouble aria-hidden="true" /> Tonight: <b>{tonight.name}</b></span>}
        {firstTomorrow && tomorrow <= trip.endDate && !before && <span><Sunrise aria-hidden="true" /> Tomorrow: {firstTomorrow.time && `${firstTomorrow.time} `}{firstTomorrow.label && firstTomorrow.label !== "Flight" ? `${firstTomorrow.label}: ` : ""}{firstTomorrow.title}</span>}
        <button type="button" className="link" onClick={() => onShowDay(before ? trip.startDate : today)}>See the whole day</button>
      </div>
    </section>
  );
}
