import { useEffect, useState } from "react";
import { CalendarPlus, Copy, Download } from "lucide-react";
import { api } from "../api.ts";

/**
 * Your trip in your calendar: Apple Calendar subscribes to a private link and keeps it up to date (flights, stays and
 * activities, with new times as they change). Google Calendar fetches from Google's servers, which can't reach this
 * Mac, so it gets a file to import instead (a copy that doesn't update).
 */
export default function CalendarPanel({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const [link, setLink] = useState<{ url: string; webcal: string; reachable: boolean }>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  useEffect(() => {
    api.calendarLink(tripId).then(setLink).catch((e) => setError(e.message));
  }, [tripId]);

  return (
    <section className="card calendar-panel" aria-labelledby="calendar-title">
      <div className="panel-head">
        <h3 id="calendar-title">Add to your calendar</h3>
        <button type="button" className="chip-x" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <p className="muted small">Your flights, stays and activities, at the right local times. A subscribed calendar updates by itself when anything changes here.</p>
      {error && <p className="error">{error}</p>}
      {link && (
        <>
          <div className="calendar-options">
            <a className="button" href={link.webcal}><CalendarPlus aria-hidden="true" /> Subscribe in Apple Calendar</a>
            <a className="button secondary" href={link.url} download><Download aria-hidden="true" /> Download for Google or Outlook</a>
            <button
              type="button"
              className="secondary"
              onClick={() => navigator.clipboard.writeText(link.url).then(() => setNote("Link copied. Keep it private: anyone with it can see this trip's plans."))}
            >
              <Copy aria-hidden="true" /> Copy link
            </button>
          </div>
          <ul className="calendar-help small muted">
            <li><b>iPhone, iPad or Mac:</b> Subscribe, then Subscribe again in Calendar. It checks for changes every hour or so.</li>
            <li><b>Google Calendar:</b> download the file, then in Google Calendar on a computer go to Settings → Import. That's a copy: download again after big changes.</li>
            {!link.reachable && <li>This link points to this Mac only. Open Estela through your phone's address (Tailscale) to subscribe on your phone.</li>}
          </ul>
          {note && <p className="notice small" role="status">{note}</p>}
          <button
            type="button"
            className="link"
            onClick={async () => {
              if (!confirm("Make a new link? Calendars subscribed with the old one stop updating.")) return;
              setLink(await api.calendarLink(tripId, true));
              setNote("New link made. The old one no longer works.");
            }}
          >
            Make a new link
          </button>
        </>
      )}
    </section>
  );
}
