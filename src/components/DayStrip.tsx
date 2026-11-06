import { useEffect, useRef, useState } from "react";

// A strip of the trip's days that stays at the top while you scroll the itinerary: tap a day to jump to it. The day
// you're looking at is highlighted (and kept in view on a phone). Days with nothing on them are greyed out, so gaps
// stand out. "Today" appears while you're on the trip.

export type DayInfo = {
  day: string;
  icons: string[];
  hasContent: boolean; // a section for this day in the itinerary to jump to
  planned?: boolean; // bookings or planned places on this day (greyed out without, unless you're staying somewhere)
  staying?: boolean; // a night at a booked stay (not a gap, though nothing may be planned)
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parse = (d: string) => new Date(`${d}T12:00:00Z`);
export const dayId = (day: string) => `day-${day}`;

/** Stick just below the header (its height differs between phone and computer). */
export function useStickBelowHeader() {
  useEffect(() => {
    const place = () => {
      const h = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 60;
      document.documentElement.style.setProperty("--topbar-h", `${Math.round(h)}px`);
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, []);
}

export default function DayStrip({ days, onEmptyDay, onJump }: { days: DayInfo[]; onEmptyDay?: (day: string) => void; onJump?: (day: string) => void }) {
  const [active, setActive] = useState<string>();
  const strip = useRef<HTMLDivElement>(null);
  const today = new Date().toLocaleDateString("en-CA");
  const onTrip = days.some((d) => d.day === today);

  useStickBelowHeader();

  // Highlight the day whose section is nearest the top of the screen.
  useEffect(() => {
    const onScroll = () => {
      const offset = (strip.current?.getBoundingClientRect().bottom ?? 120) + 12;
      let current: string | undefined;
      for (const d of days) {
        const el = document.getElementById(dayId(d.day));
        if (el && el.getBoundingClientRect().top <= offset) current = d.day;
      }
      setActive((a) => current ?? (a && !days.find((d) => d.day === a)?.hasContent ? a : days[0]?.day));
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, [days]);

  // Keep the highlighted day visible in the strip (it scrolls sideways on phones).
  useEffect(() => {
    if (!active) return;
    const chip = strip.current?.querySelector<HTMLElement>(`[data-day="${active}"]`);
    const row = chip?.parentElement;
    // Instant: a smooth scroll here would cancel the page's own smooth scroll to the day.
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2 });
  }, [active]);

  const jump = (day: string) => {
    // A day with nothing of its own (even a night at your hotel) offers to add something for that day.
    const info = days.find((d) => d.day === day);
    if (!info?.hasContent && onEmptyDay) {
      setActive(day);
      return onEmptyDay(day);
    }
    const target = info?.hasContent ? day : days.find((d) => d.day >= day && d.hasContent)?.day ?? day;
    onJump?.(target);
    // Scroll the page itself, landing just below the header and this strip (an element's scrollIntoView gets
    // cancelled when the strip re-renders mid-scroll).
    const el = document.getElementById(dayId(target));
    const stripBottom = strip.current?.getBoundingClientRect().height ?? 80;
    const header = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 60;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header - stripBottom - 8, behavior: "smooth" });
  };

  return (
    <div className="day-strip" ref={strip}>
      <div className="day-strip-row" role="tablist" aria-label="Jump to a day">
        {onTrip && (
          <button type="button" className="day-chip-today" onClick={() => jump(today)}>
            Today
          </button>
        )}
        {days.map((d, i) => {
          const date = parse(d.day);
          const newMonth = i === 0 || d.day.slice(5, 7) !== days[i - 1].day.slice(5, 7);
          return (
            <button
              key={d.day}
              type="button"
              role="tab"
              data-day={d.day}
              aria-selected={active === d.day}
              aria-label={`${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${d.hasContent ? "" : ", nothing planned"}`}
              className={`day-chip ${active === d.day ? "on" : ""} ${(d.planned ?? d.hasContent) || d.staying ? "" : "empty"} ${d.day === today ? "today" : ""}`}
              onClick={() => jump(d.day)}
            >
              <span className="day-chip-month">{newMonth ? MONTHS[date.getUTCMonth()] : " "}</span>
              <span className="day-chip-weekday">{WEEKDAYS[date.getUTCDay()]}</span>
              <span className="day-chip-date">{date.getUTCDate()}</span>
              <span className="day-chip-icons" aria-hidden="true">{d.icons.slice(0, 3).join("") || "·"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
