import { LifeBuoy, CalendarDays, ClipboardCheck, Compass, Mail, MessageCircle, Plane, Smartphone, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import Ico from "./Ico.tsx";
import { t as tr } from "../i18n.ts";

// Help: what each part of Estela does, in plain words, one topic at a time. Each topic opens and closes on its own.

type Topic = { icon: LucideIcon; title: string; points: string[] };

// A function, so it's in the app's language when shown.
const topics = (): Topic[] => [
  {
    icon: Plane,
    title: tr("Trips"),
    points: [
      tr("Tap + New trip on the home page and add where you're going, your dates, who's travelling and the kind of trip it is."),
      tr("Travelling with different people at different times? Edit the trip and split it into parts, each with its own dates and companions."),
      tr("To change or delete a trip without opening it, use the ⋯ on its card (or, on a phone, swipe the card left). Inside a trip, use Edit or the bin beside it."),
    ],
  },
  {
    icon: Mail,
    title: tr("Adding bookings"),
    points: [
      tr("Under Add to your trip, choose Flight, Accommodation, Activity or Place and fill in what you know. A flight only needs its number and date."),
      tr("Import from email: paste a booking confirmation (or upload the email), and Estela finds the flights, stays and activities in it."),
      tr("Each trip also has its own email address. Forward booking emails there and they're added for you."),
      tr("On any booking you can add its price, attach a ticket or voucher, and keep links and notes."),
    ],
  },
  {
    icon: CalendarDays,
    title: tr("Your itinerary"),
    points: [
      tr("Your trip, day by day. The dates at the top jump to a day: tap one, or drag them sideways to see more."),
      tr("Point at the line under a day (on a phone, tap the faint +) to add a note, an activity, a place or a checklist item for that day."),
      tr("The pencil beside a date gives the day a heading of its own, like “Day trip to the coast”."),
      tr("Places you plan for a day show in walking order, from where you're staying and back, with how long each walk or drive takes. ✕ takes one off the day and keeps it in your guide."),
      tr("Between bookings, a line shows how far the next one is on foot or by car, with directions and public transport."),
      tr("Tap the camera on a place's photo to change it: one taken there, one you search for, your own, or none."),
      tr("Drag a place by its handle to change the order you'll visit; Best walking order puts it back."),
      tr("Public transport or By car, above your itinerary, sets how the longer trips between stops are shown."),
      tr("If two stays cover the same night, choose which is your base on the first of those nights."),
      tr("Minimize all folds every day to its date, so a long trip is easy to scan."),
      tr("While a trip is on, Today at the top shows what's next and how long until it, directions, your booking reference and tickets, and where you sleep tonight."),
      tr("Each day shows its weather forecast about two weeks ahead, and a note where the clocks change, with how far that is from home."),
      tr("Map, above the itinerary, shows your stays, bookings and planned places on a map. Pick a day to see just that day, in order."),
      tr("Calendar, at the top of a trip, adds it to Apple Calendar (it keeps itself up to date) or gives you a file for Google Calendar or Outlook."),
    ],
  },
  {
    icon: Plane,
    title: tr("Flights"),
    points: [
      tr("Flights are followed by their number and date. Delays, new times, cancellations and gate or terminal changes show on the flight."),
      tr("Check flights, above your itinerary, looks again right away."),
      tr("Each flight shows its time in the air, the time at home when you land, and your baggage allowance. Add the allowance with Edit if the booking email didn't include it."),
    ],
  },
  {
    icon: ClipboardCheck,
    title: tr("Prepare"),
    points: [
      tr("A checklist made for your trip: passports and entry rules, health and medicines, money, phone and apps, transport, and packing for the weather."),
      tr("Add your own items, edit them and tick things off. Each part folds away when you're done with it."),
      tr("The bell at the top reminds you when something is due, like online check-in or an arrival form. Turn it on once on each device."),
    ],
  },
  {
    icon: LifeBuoy,
    title: tr("Essentials"),
    points: [
      tr("For each city you stay in: the emergency number, pharmacies, hospitals, police and ATMs near your stay, useful apps and safety tips."),
      tr("Phrases to learn for each language on your trip that isn't yours, each with how it sounds."),
    ],
  },
  {
    icon: Compass,
    title: tr("Suggestions and city guides"),
    points: [
      tr("Tips for your trip: gaps in your plans, ideas for your travel style and things worth booking ahead."),
      tr("Each city you stay in gets a guide: places to see, food to try and restaurants, matched to your travel style."),
      tr("Plan by date shows what fits each day around what's booked. Add anything to a day with one tap."),
      tr("Make your own lists too, like “Coffee spots”, with + New list."),
    ],
  },
  {
    icon: Wallet,
    title: tr("Spending"),
    points: [
      tr("Everything you've booked, added up in the currency you choose (tap the currency code to change it)."),
      tr("Add what you spend along the way under On the trip: what it was, who paid and who it's shared by. Settle up shows who owes whom."),
      tr("Set a budget to see if you're on track, close to it or over, with what's left and about how much a day."),
      tr("Travelling with someone who doesn't use Estela? Add them under Sharing costs to split spending with them too."),
      tr("Add a price to any booking that's missing one, right in Spending."),
      tr("Sharing a booking's cost? Tap Split on it in Spending (or use Split this cost when you edit it), and Settle up includes it."),
      tr("See it by category and across your days, with your largest bookings and any that still need a price."),
      tr("Other currencies are converted at today's rates, so totals are estimates."),
    ],
  },
  {
    icon: MessageCircle,
    title: tr("Ask Estela"),
    points: [
      tr("On a trip, tap Ask Estela at the bottom right and ask anything you'd otherwise search for: getting around, what to do, money, safety or what's on your plan."),
      tr("It answers from your trip and searches the web for anything that changes, with the sources underneath. Check times, prices and entry rules with the official source."),
      tr("It only answers questions. To change your trip, use the itinerary."),
    ],
  },
  {
    icon: Users,
    title: tr("Travelling together"),
    points: [
      tr("Open a trip and tap Travellers to add someone. Choose whether they can edit the trip or only view it, then send them the link or show the QR code."),
      tr("Everyone sees the same trip, kept up to date."),
    ],
  },
  {
    icon: Smartphone,
    title: tr("On your phone"),
    points: [
      tr("Add Estela to your Home Screen (in Safari: Share → Add to Home Screen) to use it like an app."),
      tr("Trips you've opened are saved on the phone, so you can read them offline. Changes need a connection."),
      tr("On iPhone, reminders work in the Home Screen app."),
    ],
  },
  {
    icon: UserRound,
    title: tr("Your account"),
    points: [
      tr("Tap your initial at the top right to change your name, email or password, sign in another device with a QR code, or sign out."),
    ],
  },
];

export default function HelpView({ onTour }: { onTour: () => void }) {
  return (
    <div className="help">
      <a href="#/" className="back">{tr("← All trips")}</a>
      <h1>{tr("Help")}</h1>
      <p className="muted help-intro">{tr("What each part of Estela does. Tap a topic to open it.")}</p>
      <button type="button" className="secondary" onClick={onTour}>{tr("Take the tour again")}</button>
      <div className="help-topics">
        {topics().map((t) => (
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
