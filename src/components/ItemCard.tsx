import { useState } from "react";
import type { FlightItem, ItineraryItem } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatTime, formatTimeOn } from "../format.ts";
import ItemForm from "./ItemForm.tsx";
import { formatMoney } from "./PriceField.tsx";
import ActivityGuidePanel from "./ActivityGuidePanel.tsx";
import { itemIcon } from "../icons.ts";
import { attachmentUrl, fileToBase64, formatSize } from "../files.ts";

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
        <strong><span className="item-icon" aria-hidden="true">{itemIcon(f)}</span>{f.flightNumber}</strong>
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

export default function ItemCard({ item, mockFlights, onChange }: { item: ItineraryItem; mockFlights: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);

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
      <div className="item-time">
        {formatTime(item.kind === "flight" ? item.live?.departureTime ?? item.departureTime : item.kind === "stay" ? item.checkIn : item.start)}
      </div>
      <div className="item-body">
        {item.kind === "flight" && <FlightBody f={item} mockFlights={mockFlights} onChange={onChange} />}
        {item.kind === "stay" && (
          <>
            <div className="row"><strong><span className="item-icon" aria-hidden="true">{itemIcon(item)}</span>{item.name}</strong></div>
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
              <strong><span className="item-icon" aria-hidden="true">{itemIcon(item)}</span>{item.title}</strong>
              {item.category && <span className="tag">{item.category}</span>}
            </div>
            <div className="row small">
              <span>
                {formatTime(item.start)}
                {item.end && ` – ${formatTimeOn(item.end, item.start)}`}
              </span>
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
        {item.kind === "activity" && item.guide && <ActivityGuidePanel guide={item.guide} />}
      </div>
      <div className="item-actions edit-only">
        <button className="link" onClick={() => setEditing(true)}>Edit</button>
        <button
          className="link danger"
          onClick={() => confirm("Delete this item?") && api.deleteItem(item.id).then(onChange)}
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
        <a key={l.url} className="file-link" href={l.url} target="_blank" rel="noreferrer noopener">🔗 {l.label}</a>
      ))}
      {item.attachments?.map((a) => (
        <span key={a.id} className="file-link">
          <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer">📎 {a.filename}</a>
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
