import { useEffect, useState } from "react";
import { api, type Alert, type TripSummary } from "../api.ts";
import { formatDateRange } from "../format.ts";
import { partySummary } from "../parts.ts";
import { flag } from "./PlaceSelect.tsx";
import SwipeActions from "./SwipeActions.tsx";
import TripForm from "./TripForm.tsx";

// Today in the traveller's own time zone ("2026-12-09"), to split upcoming from past trips.
const today = () => new Date().toLocaleDateString("en-CA");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** "Day 3 of 35" while travelling, "Tomorrow" / "In 36 days" before, "Ended 12 Jan" after. */
function when(t: TripSummary, now: string) {
  if (t.startDate <= now && now <= t.endDate) return `Day ${daysBetween(t.startDate, now) + 1} of ${daysBetween(t.startDate, t.endDate) + 1}`;
  if (t.startDate > now) {
    const n = daysBetween(now, t.startDate);
    return n === 1 ? "Tomorrow" : n < 60 ? `In ${n} days` : `In ${Math.round(n / 30.4)} months`;
  }
  const n = daysBetween(t.endDate, now);
  return n === 1 ? "Ended yesterday" : n < 60 ? `Ended ${n} days ago` : `Ended ${Math.round(n / 30.4)} months ago`;
}

export default function TripList() {
  const [trips, setTrips] = useState<TripSummary[]>();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TripSummary>();
  const [error, setError] = useState<string>();

  const load = () => {
    api.trips().then(setTrips).catch((e) => setError((e as Error).message));
    api.alerts().then(setAlerts).catch(() => {});
  };
  useEffect(load, []);

  const remove = async (t: TripSummary) => {
    const leaving = t.role !== "owner";
    if (!confirm(leaving ? `Leave "${t.name}"? You'll no longer see it.` : `Delete "${t.name}" and everything in it? This can't be undone.`)) return;
    try {
      await (leaving ? api.removeTraveller(t.id, "me") : api.deleteTrip(t.id));
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const now = today();
  // Upcoming: the trip you're on first, then soonest first. Past: most recent first.
  const upcoming = (trips ?? []).filter((t) => t.endDate >= now).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = (trips ?? []).filter((t) => t.endDate < now).sort((a, b) => b.endDate.localeCompare(a.endDate));

  if (editing) {
    return (
      <TripForm
        initial={editing}
        onCancel={() => setEditing(undefined)}
        onSubmit={async (t) => {
          await api.updateTrip(editing.id, t);
          setEditing(undefined);
          load();
        }}
      />
    );
  }

  if (creating) {
    return (
      <TripForm
        onCancel={() => setCreating(false)}
        onSubmit={async (t) => {
          const trip = await api.createTrip(t);
          location.hash = `#/trip/${trip.id}`;
        }}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Hey! Where to next?</h1>
        <button onClick={() => setCreating(true)}>+ New trip</button>
      </div>
      {trips?.length === 0 && (
        <div className="card empty">
          <p>No trips yet. Create one, then add your flights, stays and activities — or forward your booking emails and Joy will put them together.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {upcoming.length > 0 && (
        <section className="trip-section">
          <h2>Upcoming trips</h2>
          <div className="trip-grid">{upcoming.map(card)}</div>
        </section>
      )}
      {trips && trips.length > 0 && upcoming.length === 0 && (
        <div className="card empty">
          <p>No upcoming trips. Where to next? Tap <b>+ New trip</b> to start planning.</p>
        </div>
      )}
      {past.length > 0 && (
        <section className="trip-section past">
          <h2>Past trips <span className="muted small">{past.length}</span></h2>
          <div className="trip-grid">{past.map(card)}</div>
        </section>
      )}
    </>
  );

  function card(t: TripSummary) {
    const tripAlerts = alerts.filter((a) => a.tripId === t.id);
    const countries = [...new Set((t.places ?? []).map((p) => p.countryCode))];
    const status = t.startDate <= now && now <= t.endDate ? "now" : t.endDate < now ? "past" : "upcoming";
    return (
      <SwipeActions
        key={t.id}
        id={t.id}
        actions={
          <>
            {t.role !== "viewer" && (
              <button type="button" className="swipe-edit" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>✏️<span>Edit</span></button>
            )}
            {t.role === "owner" ? (
              <button type="button" className="swipe-delete" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>🗑️<span>Delete</span></button>
            ) : (
              <button type="button" className="swipe-delete" onClick={() => remove(t)} aria-label={`Leave ${t.name}`}>🚪<span>Leave</span></button>
            )}
          </>
        }
      >
        <a href={`#/trip/${t.id}`} className={`card trip-card ${status}`}>
          <div className={`trip-flags ${countries.length > 3 ? "many" : ""}`} aria-hidden="true">
            {countries.length ? countries.slice(0, 4).map((cc) => <span key={cc}>{flag(cc)}</span>) : <span>✈️</span>}
          </div>
          <div className="trip-body">
            <div className="trip-card-head">
              <h3>{t.name}</h3>
              <span className={`tag ${t.purpose}`}>{t.purpose}</span>
            </div>
            <p className={`trip-when ${status}`}>
              {status === "now" && "✈️ "}{when(t, now)}
              {t.role !== "owner" && t.ownerName && <span className="shared-by">Shared by {t.ownerName}</span>}
              {t.role === "owner" && t.travellers > 1 && <span className="shared-by">👥 {t.travellers} travellers</span>}
            </p>
            <p>
              <span className="muted">{t.destination}</span> · {formatDateRange(t.startDate, t.endDate)}
            </p>
            <p className="muted small">{t.itemCount} {t.itemCount === 1 ? "item" : "items"} · {partySummary(t)}{t.styles.length ? ` · ${t.styles.join(", ")}` : ""}</p>
            {tripAlerts.length > 0 && status !== "past" && (
              <p className="alert-inline">⚠︎ Joy spotted a change to {tripAlerts.map((a) => a.flightNumber).join(", ")}</p>
            )}
          </div>
        </a>
      </SwipeActions>
    );
  }
}
