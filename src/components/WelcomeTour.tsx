import { useEffect, useRef, useState } from "react";
import { CalendarDays, ClipboardCheck, Compass, LifeBuoy, Mail, MessageCircle, Plane, Sun, Wallet, X, type LucideIcon } from "lucide-react";
import { t } from "../i18n.ts";

// A short welcome for a new account: one card at a time, the main ideas only. It opens once (the account remembers),
// and Help can open it again any time.

type Step = { icon: LucideIcon; title: string; text: string };

const STEPS: Step[] = [
  { icon: Plane, get title() { return t("Welcome to Estela"); }, get text() { return t("Your trips in one calm place: what's booked, what's planned, what to prepare and what you've spent. Here's a quick look around."); } },
  { icon: CalendarDays, get title() { return t("Start with a trip"); }, get text() { return t("Tap + New trip and add where you're going, your dates and who's travelling. Estela uses these for everything else: guides, weather, checklists and ideas."); } },
  { icon: Mail, get title() { return t("Add your bookings"); }, get text() { return t("Add flights, stays and activities by hand, or forward your booking emails to your trip's own address and Estela adds them for you. Flights are then followed live, with your baggage allowance."); } },
  { icon: CalendarDays, get title() { return t("Your itinerary, day by day"); }, get text() { return t("Each day shows what's on, the weather and how long it takes to get from one stop to the next. Use the + between cards to add something, and drag the places you plan into the order you'll visit."); } },
  { icon: Sun, get title() { return t("Today, the map and your calendar"); }, get text() { return t("While you're away, Today shows what's next and how to get there. Map puts your whole trip on a map, and Calendar adds it to Apple Calendar or Google Calendar."); } },
  { icon: ClipboardCheck, get title() { return t("Prepare"); }, get text() { return t("A checklist made for your trip: documents and entry rules, health, money, apps and packing. Turn on the bell to be reminded when it's time."); } },
  { icon: LifeBuoy, get title() { return t("Essentials"); }, get text() { return t("For each city: the emergency number, pharmacies, hospitals and ATMs near where you're staying, safety tips, and a few phrases in the local language to learn, with how they sound."); } },
  { icon: Compass, get title() { return t("Suggestions and city guides"); }, get text() { return t("Tips for your trip, and a guide for each city you stay in: places to see, food to try and what fits each day."); } },
  { icon: Wallet, get title() { return t("Spending"); }, get text() { return t("Everything you've booked and spent along the way, in the currency you choose. Set a budget, and if you're travelling together, Settle up shows who owes whom."); } },
];
const ASK: Step = { icon: MessageCircle, get title() { return t("Ask Estela"); }, get text() { return t("Questions about your trip, or one you're thinking about? Ask Estela, bottom right on a trip. It answers from your plans and checks the web for anything that changes."); } };

export default function WelcomeTour({ ai, onClose }: { ai: boolean; onClose: () => void }) {
  const steps = ai ? [...STEPS, ASK] : STEPS;
  const [n, setN] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const step = steps[n];
  const last = n === steps.length - 1;
  const Icon = step.icon;

  useEffect(() => {
    next.current?.focus();
  }, [n]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setN((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setN((i) => Math.max(i - 1, 0));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose, steps.length]);

  return (
    <div className="tour-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
        <button type="button" className="quiet icon-only tour-close" aria-label={t("Close the tour")} title={t("Close")} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <span className="tour-icon" aria-hidden="true"><Icon /></span>
        <span className="tour-count">{t("{v1} of {length}", { v1: n + 1, length: steps.length })}</span>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => <span key={i} className={i === n ? "on" : ""} />)}
        </div>
        <div className="tour-actions">
          {n > 0 ? <button type="button" className="quiet" onClick={() => setN(n - 1)}>{t("Back")}</button> : <button type="button" className="quiet" onClick={onClose}>{t("Skip")}</button>}
          <button type="button" ref={next} onClick={() => (last ? onClose() : setN(n + 1))}>{last ? t("Start planning") : t("Next")}</button>
        </div>
        <p className="tour-help">{t("You can find this again under")}{" "}<b>?</b>{" "}{t("Help, at the top.")}</p>
      </section>
    </div>
  );
}
