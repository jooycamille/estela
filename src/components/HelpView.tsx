import { CalendarDays, ClipboardCheck, Compass, Mail, MessageCircle, Plane, Smartphone, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import Ico from "./Ico.tsx";

// Help: what each part of Estela does, in plain words, one topic at a time. Each topic opens and closes on its own.

type Topic = { icon: LucideIcon; title: string; points: string[] };

const TOPICS: Topic[] = [
  {
    icon: Plane,
    title: "Trips",
    points: [
      "Tap + New trip on the home page and add where you're going, your dates, who's travelling and the kind of trip it is.",
      "Travelling with different people at different times? Edit the trip and split it into parts, each with its own dates and companions.",
      "To change or delete a trip, open it and use Edit, or the bin beside it. On a phone you can also swipe a trip on the home page.",
    ],
  },
  {
    icon: Mail,
    title: "Adding bookings",
    points: [
      "Under Add to your trip, choose Flight, Accommodation, Activity or Place and fill in what you know. A flight only needs its number and date.",
      "Import from email: paste a booking confirmation (or upload the email), and Estela finds the flights, stays and activities in it.",
      "Each trip also has its own email address. Forward booking emails there and they're added for you.",
      "On any booking you can add its price, attach a ticket or voucher, and keep links and notes.",
    ],
  },
  {
    icon: CalendarDays,
    title: "Your itinerary",
    points: [
      "Your trip, day by day. The dates at the top jump to a day: tap one, or drag them sideways to see more.",
      "Point at the line under a day (on a phone, tap the faint +) to add a note, an activity, a place or a checklist item for that day.",
      "The pencil beside a date gives the day a heading of its own, like “Day trip to the coast”.",
      "Places you plan for a day show as cards in walking order, with a route in Maps. ✕ takes one off the day and keeps it in your guide.",
      "Minimize all folds every day to its date, so a long trip is easy to scan.",
    ],
  },
  {
    icon: Plane,
    title: "Flights",
    points: [
      "Flights are followed by their number and date. Delays, new times, cancellations and gate or terminal changes show on the flight.",
      "Check flights, above your itinerary, looks again right away.",
    ],
  },
  {
    icon: ClipboardCheck,
    title: "Prepare",
    points: [
      "A checklist made for your trip: passports and entry rules, health and medicines, money, phone and apps, transport, and packing for the weather.",
      "Add your own items, edit them and tick things off. Each part folds away when you're done with it.",
      "The bell at the top reminds you when something is due, like online check-in or an arrival form. Turn it on once on each device.",
    ],
  },
  {
    icon: Compass,
    title: "Suggestions and city guides",
    points: [
      "Tips for your trip: gaps in your plans, ideas for your travel style and things worth booking ahead.",
      "Each city you stay in gets a guide: essentials near where you sleep (emergency number, pharmacies, hospitals, ATMs), safety tips, useful apps, places to see, food to try and restaurants.",
      "Plan by date shows what fits each day around what's booked. Add anything to a day with one tap.",
      "Make your own lists too, like “Coffee spots”, with + New list.",
    ],
  },
  {
    icon: Wallet,
    title: "Spending",
    points: [
      "Everything you've booked, added up in the currency you choose (tap the currency code to change it).",
      "See it by category and across your days, with your largest bookings and any that still need a price.",
      "Other currencies are converted at today's rates, so totals are estimates.",
    ],
  },
  {
    icon: MessageCircle,
    title: "Ask Estela",
    points: [
      "On a trip, tap Ask Estela at the bottom right and ask anything you'd otherwise search for: getting around, what to do, money, safety or what's on your plan.",
      "It answers from your trip and searches the web for anything that changes, with the sources underneath. Check times, prices and entry rules with the official source.",
      "It only answers questions. To change your trip, use the itinerary.",
    ],
  },
  {
    icon: Users,
    title: "Travelling together",
    points: [
      "Open a trip and tap Travellers to add someone. Choose whether they can edit the trip or only view it, then send them the link or show the QR code.",
      "Everyone sees the same trip, kept up to date.",
    ],
  },
  {
    icon: Smartphone,
    title: "On your phone",
    points: [
      "Add Estela to your Home Screen (in Safari: Share → Add to Home Screen) to use it like an app.",
      "Trips you've opened are saved on the phone, so you can read them offline. Changes need a connection.",
      "On iPhone, reminders work in the Home Screen app.",
    ],
  },
  {
    icon: UserRound,
    title: "Your account",
    points: [
      "Tap your initial at the top right to change your name, email or password, sign in another device with a QR code, or sign out.",
    ],
  },
];

export default function HelpView({ onTour }: { onTour: () => void }) {
  return (
    <div className="help">
      <a href="#/" className="back">← All trips</a>
      <h1>Help</h1>
      <p className="muted help-intro">What each part of Estela does. Tap a topic to open it.</p>
      <button type="button" className="secondary" onClick={onTour}>Take the tour again</button>
      <div className="help-topics">
        {TOPICS.map((t) => (
          <details key={t.title} className="help-topic">
            <summary>
              <span className="help-icon"><Ico icon={t.icon} /></span>
              {t.title}
            </summary>
            <ul>
              {t.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
