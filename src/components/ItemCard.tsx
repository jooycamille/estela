import { useState } from "react";
import { cancellationOf, type Cancellation } from "../../shared/cancellation.ts";
import type { ActivityItem, DraftItem, FlightItem, IncludedPlace, ItineraryItem } from "../../shared/types.ts";
import { api } from "../api.ts";
import { activityDays } from "../../shared/days.ts";
import { formatDay, formatTime, formatTimeOn } from "../format.ts";
import ItemForm from "./ItemForm.tsx";
import LodgingField from "./LodgingField.tsx";
import { formatMoney } from "./PriceField.tsx";
import ActivityGuidePanel from "./ActivityGuidePanel.tsx";
import { itemIcon } from "../icons.ts";
import { attachmentUrl, fileToBase64, formatSize } from "../files.ts";
import Ico from "./Ico.tsx";
import { Link2, Paperclip } from "lucide-react";

/** "Free cancellation until Tue, 8 Dec, 7:39 PM", "Non-refundable"… as a tag on the card. */
function CancelTag({ terms }: { terms?: Cancellation }) {
  if (!terms) return null;
  if (terms.kind === "partial") return <span className="cancel-tag partial">Partial refund</span>;
  if (terms.kind === "nonrefundable") return <span className="cancel-tag closed">Non-refundable</span>;
  if (!terms.until) return <span className="cancel-tag free">Free cancellation</span>;
  // The device's clock, near enough for a label: the reminders work from the activity's real time zone.
  if (terms.until < new Date().toLocaleString("sv").slice(0, 16).replace(" ", "T")) return <span className="cancel-tag closed">Free cancellation ended</span>;
  return (
    <span className="cancel-tag free" title="Local time where the activity is">
      Free cancellation until {formatDay(terms.until.slice(0, 10))}{terms.timed ? `, ${formatTime(terms.until)}` : ""}
    </span>
  );
}

/** The places a tour takes you to, so you know you don't need to see them separately. */
function IncludedPlaces({ item, onChange }: { item: ActivityItem; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const places = item.includes ?? [];
  const save = async (includes: IncludedPlace[]) => {
    setError(undefined);
    try {
      await api.updateItem(item.id, { ...item, includes } as unknown as DraftItem);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = (place: IncludedPlace) => {
    const title = place.title.trim();
    if (!title) return;
    setName("");
    if (!places.some((p) => p.title.toLowerCase() === title.toLowerCase())) save([...places, { ...place, title }]);
  };
  return (
    <div className="included-places">
      {places.length > 0 && (
        <>
          <b className="small">Places included</b>
          <ul>
            {places.map((p) => (
              <li key={p.title} className="small">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat !== undefined ? `${p.lat},${p.lon}` : p.address ?? p.title)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.title}
                </a>
                <button type="button" className="chip-x edit-only" aria-label={`Remove ${p.title}`} onClick={() => save(places.filter((x) => x !== p))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="link small edit-only" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
        {adding ? "Done adding places" : "+ Add a place this includes"}
      </button>
      {adding && (
        <div className="included-add edit-only">
          <LodgingField
            label="Place"
            value={name}
            placeholder="A place this visits, e.g. a museum or ruins"
            search={(q) => api.searchPlaces(q, undefined, item.tripId, item.start.slice(0, 10))}
            onChange={setName}
            onPick={(r) => add({ title: r.name ?? name, address: r.address, lat: r.lat, lon: r.lon })}
          />
          <button type="button" className="secondary" disabled={!name.trim()} onClick={() => add({ title: name })}>Add</button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** What the price covers and what it doesn't, in view on the card. */
function CoveredLists({ item, onChange }: { item: ActivityItem; onChange: () => void }) {
  const [adding, setAdding] = useState<"included" | "notIncluded">();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const save = async (key: "included" | "notIncluded", next: string[]) => {
    setError(undefined);
    try {
      await api.updateItem(item.id, { ...item, guide: { ...item.guide, [key]: next } } as unknown as DraftItem);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = () => {
    const value = text.trim();
    if (!adding || !value) return;
    setText("");
    const now = item.guide?.[adding] ?? [];
    if (!now.some((x) => x.toLowerCase() === value.toLowerCase())) save(adding, [...now, value]);
  };
  const groups = [
    { key: "included", label: "Included", mark: "✓", values: item.guide?.included ?? [] },
    { key: "notIncluded", label: "Not included", mark: "✕", values: item.guide?.notIncluded ?? [] },
  ] as const;
  return (
    <div className="covered-lists">
      {groups.map((g) => (
        <div key={g.key} className={`covered-list ${g.key}`}>
          {g.values.length > 0 && <b className="small">{g.label}</b>}
          {g.values.length > 0 && (
            <ul>
              {g.values.map((v) => (
                <li key={v} className="small">
                  <span aria-hidden="true" className="mark">{g.mark}</span> {v}
                  <button type="button" className="chip-x edit-only" aria-label={`Remove ${v}`} onClick={() => save(g.key, g.values.filter((x) => x !== v))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link small edit-only" aria-expanded={adding === g.key} onClick={() => { setAdding(adding === g.key ? undefined : g.key); setText(""); }}>
            {adding === g.key ? "Done" : `+ ${g.label}`}
          </button>
        </div>
      ))}
      {adding && (
        <form
          className="covered-add edit-only"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            aria-label={adding === "included" ? "What's included" : "What's not included"}
            value={text}
            placeholder={adding === "included" ? "e.g. Lunch, hotel pickup, entry fees" : "e.g. Tips, drinks, national park fee"}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={!text.trim()}>Add</button>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled", on_time: "On time", delayed: "Delayed", boarding: "Boarding", departed: "Departed",
  landed: "Landed", cancelled: "Cancelled", diverted: "Diverted", unknown: "Unknown",
};

function FlightBody({ f: flight, mockFlights, onChange }: { f: FlightItem; mockFlights: boolean; onChange: () => void }) {
  // Demo status left over from before real flight data was connected isn't shown; real status replaces it near departure.
  const f = flight.live?.provider === "mock" && !mockFlights ? { ...flight, live: undefined, changes: [] } : flight;
  const dep = f.live?.departureTime ?? f.departureTime;
  const arr = f.live?.arrivalTime ?? f.arrivalTime;
  const depMoved = f.live?.departureTime && f.live.departureTime !== f.departureTime;
  const pending = f.changes.filter((c) => !c.acknowledged);

  return (
    <>
      <div className="row">
        <strong><span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(f)} /></span>{f.flightNumber}</strong>
        <span>{f.from} → {f.to}</span>
        {f.airline && <span className="muted small">{f.airline}</span>}
        {f.live && <span className={`status-badge ${f.live.status}`}>{STATUS_LABEL[f.live.status]}</span>}
      </div>
      <div className="row small">
        <span>
          Departs {depMoved && <s className="muted">{formatTime(f.departureTime)}</s>} <b>{formatTimeOn(dep, f.departureTime)}</b>
          {f.live?.departureTerminal && ` · T${f.live.departureTerminal}`}
          {f.live?.departureGate && ` · Gate ${f.live.departureGate}`}
        </span>
        {arr && <span>Arrives <b>{formatTimeOn(arr, f.departureTime)}</b></span>}
        {f.seat && <span>Seat {f.seat}</span>}
      </div>
      {pending.length > 0 && (
        <div className="change-alert">
          <strong>Joy noticed a change to {f.flightNumber}</strong>
          <ul>
            {pending.map((c, i) => (
              <li key={i}>{c.field}: {c.from ? <s>{c.from.replace("T", " ")}</s> : "—"} → <b>{c.to?.replace("T", " ")}</b></li>
            ))}
          </ul>
          <button className="small-btn" onClick={() => api.acknowledge(f.id).then(onChange)}>Got it</button>
        </div>
      )}
      <div className="row small muted">
        {f.live ? `Checked ${new Date(f.live.checkedAt).toLocaleString()} via ${f.live.provider}` : "Live status not available yet — checked automatically closer to departure"}
        {mockFlights && (
          <button className="link" onClick={() => api.simulateChange(f.id).then(onChange)}>Simulate a change</button>
        )}
      </div>
    </>
  );
}

export default function ItemCard({ item, day, mockFlights, onChange, linkedFlight }: { item: ItineraryItem; day?: string; mockFlights: boolean; onChange: () => void; linkedFlight?: FlightItem }) {
  const [editing, setEditing] = useState(false);
  // An activity over several days has a card on each: which day of it this is.
  const runsOn = item.kind === "activity" ? activityDays(item) : [];
  const dayIndex = runsOn.length > 1 && day ? runsOn.indexOf(day) : -1;
  const isLaterDay = dayIndex > 0;
  const isLastDay = isLaterDay && dayIndex === runsOn.length - 1;
  // The driver tracks the flight, so a pick-up is when it really lands (demo flight data aside).
  const landsAt = linkedFlight && item.kind === "activity" && item.transferLeg === "pickup"
    ? (linkedFlight.live?.provider === "mock" ? undefined : linkedFlight.live?.arrivalTime) ?? linkedFlight.arrivalTime
    : undefined;

  if (editing) {
    return (
      <div className={`item ${item.kind}`}>
        <ItemForm
          kind={item.kind}
          initial={item}
          tripId={item.tripId}
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await api.updateItem(item.id, d);
            setEditing(false);
            onChange();
          }}
        />
      </div>
    );
  }

  return (
    <div className={`item ${item.kind}`}>
      <div className={`item-time ${isLaterDay ? "later-day" : ""}`}>
        {item.kind === "activity" && isLaterDay
          ? isLastDay ? `Until ${formatTime(item.end)}` : "All day"
          : formatTime(item.kind === "flight" ? item.live?.departureTime ?? item.departureTime : item.kind === "stay" ? item.checkIn : item.start)}
      </div>
      <div className="item-body">
        {item.kind === "flight" && <FlightBody f={item} mockFlights={mockFlights} onChange={onChange} />}
        {item.kind === "stay" && (
          <>
            <div className="row"><strong><span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(item)} /></span>{item.name}</strong></div>
            <div className="row small">
              <span>Check-in {formatTime(item.checkIn)}</span>
              <span>Check-out {item.checkOut.slice(0, 10)} {formatTime(item.checkOut)}</span>
              {item.address && <span className="muted">{item.address}</span>}
            </div>
          </>
        )}
        {item.kind === "activity" && (
          <>
            <div className="row">
              <strong><span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(item)} /></span>{item.title}</strong>
              {dayIndex >= 0 && <span className="tag day-of">Day {dayIndex + 1} of {runsOn.length}</span>}
              {item.category && <span className="tag">{item.category}</span>}
              <CancelTag terms={cancellationOf(item)} />
            </div>
            <div className="row small">
              <span>
                {dayIndex >= 0 && `${formatDay(item.start)} `}
                {formatTime(landsAt ?? item.start)}
                {item.end && ` – ${formatTimeOn(item.end, item.start)}`}
              </span>
              {linkedFlight && item.transferLeg === "pickup" && (
                <span className={landsAt && landsAt !== item.start ? "warning" : "muted"}>
                  {landsAt && landsAt !== item.start ? `${linkedFlight.flightNumber} has changed, booked for ${formatTime(item.start)}` : `Follows ${linkedFlight.flightNumber}`}
                </span>
              )}
              {linkedFlight && item.transferLeg === "dropoff" && (
                <span className="muted">For {linkedFlight.flightNumber}, departs {formatTime(linkedFlight.live?.provider === "mock" ? linkedFlight.departureTime : linkedFlight.live?.departureTime ?? linkedFlight.departureTime)}</span>
              )}
              {item.location && <span className="muted">{item.location}</span>}
              {item.location && (
                <a
                  className="small map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.lat !== undefined ? `${item.lat},${item.lon}` : item.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Map ↗
                </a>
              )}
            </div>
            {item.dateEstimated && (
              <p className="warning small estimate">
                ⚠︎ Estimated date — the email didn't say when this is. Check your booking, then Edit and save to confirm.
              </p>
            )}
          </>
        )}
        <div className="row small muted">
          {item.price && <span className="price">{formatMoney(item.price)}</span>}
          {item.confirmationCode && <span>Ref {item.confirmationCode}</span>}
          {item.source === "email" && <span>from email</span>}
        </div>
        {item.notes && <div className="row small notes">{item.notes}</div>}
        <Files item={item} onChange={onChange} />
        {item.kind === "activity" && item.category !== "transfer" && <CoveredLists item={item} onChange={onChange} />}
        {item.kind === "activity" && item.category !== "transfer" && <IncludedPlaces item={item} onChange={onChange} />}
        {item.kind === "activity" && item.guide && <ActivityGuidePanel guide={item.guide} item={item} onChange={onChange} />}
      </div>
      <div className="item-actions edit-only">
        <button className="link" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="link danger"
          onClick={() => confirm(dayIndex >= 0 ? `Delete this from all ${runsOn.length} days?` : "Delete this item?") && api.deleteItem(item.id).then(onChange)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Booking links and stored files (tickets, vouchers), with upload. */
function Files({ item, onChange }: { item: ItineraryItem; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="row small files">
      {item.links?.map((l) => (
        <a key={l.url} className="file-link" href={l.url} target="_blank" rel="noreferrer noopener"><Link2 aria-hidden="true" /> {l.label}</a>
      ))}
      {item.attachments?.map((a) => (
        <span key={a.id} className="file-link">
          <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer"><Paperclip aria-hidden="true" /> {a.filename}</a>
          <span className="muted"> {formatSize(a.size)}</span>
          <button
            className="link danger edit-only"
            title="Remove file"
            onClick={() => confirm(`Remove ${a.filename}?`) && api.removeAttachment(item.id, a.id).then(onChange)}
          >
            ✕
          </button>
        </span>
      ))}
      <label className="file-btn small edit-only">
        {busy ? "Uploading…" : "+ Attach file"}
        <input
          type="file"
          accept=".pdf,image/*,.pkpass"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) return setError("Files must be 15 MB or smaller");
            setBusy(true);
            setError(undefined);
            try {
              await api.uploadAttachment(item.id, { filename: file.name, contentType: file.type || "application/octet-stream", data: await fileToBase64(file) });
              onChange();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
