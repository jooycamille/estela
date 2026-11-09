import { useEffect, useRef, useState } from "react";
import { CalendarDays, ClipboardCheck, Compass, LifeBuoy, Mail, MessageCircle, Plane, Sun, Wallet, X, type LucideIcon } from "lucide-react";

// A short welcome for a new account: one card at a time, the main ideas only. It opens once (the account remembers),
// and Help can open it again any time.

type Step = { icon: LucideIcon; title: string; text: string };

const STEPS: Step[] = [
  { icon: Plane, title: "Welcome to Estela", text: "Your trips in one calm place: what's booked, what's planned, what to prepare and what you've spent. Here's a quick look around." },
  { icon: CalendarDays, title: "Start with a trip", text: "Tap + New trip and add where you're going, your dates and who's travelling. Estela uses these for everything else: guides, weather, checklists and ideas." },
  { icon: Mail, title: "Add your bookings", text: "Add flights, stays and activities by hand, or forward your booking emails to your trip's own address and Estela adds them for you. Flights are then followed live, with your baggage allowance." },
  { icon: CalendarDays, title: "Your itinerary, day by day", text: "Each day shows what's on, the weather and how long it takes to get from one stop to the next. Use the + between cards to add something, and drag the places you plan into the order you'll visit." },
  { icon: Sun, title: "Today, the map and your calendar", text: "While you're away, Today shows what's next and how to get there. Map puts your whole trip on a map, and Calendar adds it to Apple Calendar or Google Calendar." },
  { icon: ClipboardCheck, title: "Prepare", text: "A checklist made for your trip: documents and entry rules, health, money, apps and packing. Turn on the bell to be reminded when it's time." },
  { icon: LifeBuoy, title: "Essentials", text: "For each city: the emergency number, pharmacies, hospitals and ATMs near where you're staying, safety tips, and a few phrases in the local language to learn, with how they sound." },
  { icon: Compass, title: "Suggestions and city guides", text: "Tips for your trip, and a guide for each city you stay in: places to see, food to try and what fits each day." },
  { icon: Wallet, title: "Spending", text: "Everything you've booked and spent along the way, in the currency you choose. Set a budget, and if you're travelling together, Settle up shows who owes whom." },
];
const ASK: Step = { icon: MessageCircle, title: "Ask Estela", text: "Questions about your trip, or one you're thinking about? Ask Estela, bottom right on a trip. It answers from your plans and checks the web for anything that changes." };

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
        <button type="button" className="quiet icon-only tour-close" aria-label="Close the tour" title="Close" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <span className="tour-icon" aria-hidden="true"><Icon /></span>
        <span className="tour-count">{n + 1} of {steps.length}</span>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, i) => <span key={i} className={i === n ? "on" : ""} />)}
        </div>
        <div className="tour-actions">
          {n > 0 ? <button type="button" className="quiet" onClick={() => setN(n - 1)}>Back</button> : <button type="button" className="quiet" onClick={onClose}>Skip</button>}
          <button type="button" ref={next} onClick={() => (last ? onClose() : setN(n + 1))}>{last ? "Start planning" : "Next"}</button>
        </div>
        <p className="tour-help">You can find this again under <b>?</b> Help, at the top.</p>
      </section>
    </div>
  );
}
