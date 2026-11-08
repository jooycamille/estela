import { useState } from "react";
import type { DraftItem, EmailParseResult } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatDay, formatTime } from "../format.ts";
import ForwardingInbox from "./ForwardingInbox.tsx";
import ItemForm, { KIND_LABEL } from "./ItemForm.tsx";
import { formatMoney } from "./PriceField.tsx";
import { itemIcon } from "../icons.ts";
import { fileToBase64 } from "../files.ts";
import Ico from "./Ico.tsx";
import { FileText } from "lucide-react";

function draftSummary(d: DraftItem) {
  const price = d.price ? ` · ${formatMoney(d.price)}` : "";
  return describe(d) + price;
}

function describe(d: DraftItem) {
  if (d.kind === "flight") {
    const arrival = d.arrivalTime ? ` → ${d.arrivalTime.slice(0, 10) === d.departureTime.slice(0, 10) ? "" : `${formatDay(d.arrivalTime)} `}${formatTime(d.arrivalTime)}` : "";
    return `${d.flightNumber} ${d.from || "?"} → ${d.to || "?"} · ${formatDay(d.departureTime)} ${formatTime(d.departureTime)}${arrival}`;
  }
  if (d.kind === "stay") return `${d.name}${d.address ? `, ${d.address}` : ""} · ${formatDay(d.checkIn)} → ${formatDay(d.checkOut)}`;
  return `${d.title} · ${formatDay(d.start)} ${formatTime(d.start)}${d.end ? `–${formatTime(d.end)}` : ""}${d.dateEstimated ? " (estimated date)" : ""}`;
}

export default function EmailImport({
  tripId,
  onDone,
  onCancel,
  onItemsChanged,
}: {
  tripId: string;
  onDone: () => void;
  onCancel: () => void;
  onItemsChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [pdfs, setPdfs] = useState<{ filename: string; contentType: string; data: string }[]>([]);
  const [result, setResult] = useState<EmailParseResult>();
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [editing, setEditing] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const parse = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.parseEmail(email, tripId, pdfs);
      setResult(r);
      setDrafts(r.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      await api.addItems(tripId, drafts);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>Import from email</h3>
      {!result ? (
        <>
          <ForwardingInbox tripId={tripId} onItemsChanged={onItemsChanged} />
          <h4>Or paste an email</h4>
          <p className="muted small">
            Paste a booking confirmation (airline, hotel, Airbnb, tour, restaurant), or upload a saved <code>.eml</code> file
            or a PDF itinerary / e-ticket. You'll review everything before it's added.
          </p>
          <textarea rows={10} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Paste the email here…" />
          <div className="actions">
            <label className="file-btn">
              Upload email or PDF
              <input
                type="file"
                multiple
                accept=".pdf,.eml,.txt,.html,application/pdf,message/rfc822,text/plain,text/html"
                onChange={async (e) => {
                  for (const file of Array.from(e.target.files ?? [])) {
                    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
                      const data = await fileToBase64(file);
                      setPdfs((p) => [...p.filter((x) => x.filename !== file.name), { filename: file.name, contentType: "application/pdf", data }]);
                    } else {
                      setEmail(await file.text());
                    }
                  }
                  e.target.value = "";
                }}
              />
            </label>
            {pdfs.map((p) => (
              <span key={p.filename} className="file-chip">
                <FileText aria-hidden="true" /> {p.filename}
                <button className="link" title="Remove" onClick={() => setPdfs((x) => x.filter((y) => y !== p))}>✕</button>
              </span>
            ))}
            <span className="spacer" />
            <button className="ghost" onClick={onCancel}>Cancel</button>
            <button onClick={parse} disabled={busy || (email.trim().length < 10 && pdfs.length === 0)}>{busy ? "Reading email…" : "Extract bookings"}</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Found {drafts.length} item{drafts.length === 1 ? "" : "s"} ({result.parser === "claude" ? "parsed by Claude" : "basic parser"}).
          </p>
          {result.warnings.map((w) => <p key={w} className="warning small">{w}</p>)}
          <ul className="drafts">
            {drafts.map((d, i) => (
              <li key={i}>
                {editing === i ? (
                  <ItemForm
                    kind={d.kind}
                    initial={d}
                    tripId={tripId}
                    submitLabel="Done"
                    onCancel={() => setEditing(undefined)}
                    onSubmit={(updated) => {
                      setDrafts((ds) => ds.map((x, j) => (j === i ? { ...updated, source: "email" } : x)));
                      setEditing(undefined);
                    }}
                  />
                ) : (
                  <div className="draft-row">
                    <span className={`kind ${d.kind}`}><Ico icon={itemIcon(d)} /> {KIND_LABEL[d.kind]}</span>
                    <span className="grow">{draftSummary(d)}</span>
                    <button className="link" onClick={() => setEditing(i)}>Edit</button>
                    <button className="link danger" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="ghost" onClick={() => setResult(undefined)}>Back</button>
            <span className="spacer" />
            <button onClick={saveAll} disabled={busy || drafts.length === 0 || editing !== undefined}>
              Add {drafts.length} to itinerary
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
