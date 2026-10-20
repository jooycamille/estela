import { useEffect, useState } from "react";
import { api, type Alert, type TripSummary } from "../api.ts";
import { formatDateRange } from "../format.ts";
import { partySummary } from "../parts.ts";
import TripForm from "./TripForm.tsx";

export default function TripList() {
  const [trips, setTrips] = useState<TripSummary[]>();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.trips().then(setTrips);
    api.alerts().then(setAlerts);
  }, []);

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
      <div className="trip-grid">
        {trips?.map((t) => {
          const tripAlerts = alerts.filter((a) => a.tripId === t.id);
          return (
            <a key={t.id} href={`#/trip/${t.id}`} className="card trip-card">
              <div className="trip-card-head">
                <h3>{t.name}</h3>
                <span className={`tag ${t.purpose}`}>{t.purpose}</span>
              </div>
              <p className="muted">{t.destination}</p>
              <p>{formatDateRange(t.startDate, t.endDate)}</p>
              <p className="muted small">{t.itemCount} items · {partySummary(t)}{t.styles.length ? ` · ${t.styles.join(", ")}` : ""}</p>
              {tripAlerts.length > 0 && (
                <p className="alert-inline">⚠︎ Joy spotted a change to {tripAlerts.map((a) => a.flightNumber).join(", ")}</p>
              )}
            </a>
          );
        })}
      </div>
    </>
  );
}
