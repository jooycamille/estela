import { useEffect, useMemo, useState } from "react";
import type { DraftItem, FlightLookupResult, FlightScheduleLeg } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatDay, formatTime, formatTimeOn } from "../format.ts";
import AirportSelect from "./AirportSelect.tsx";
import PriceField, { priceValue, toMoney } from "./PriceField.tsx";

type FlightDraft = Extract<DraftItem, { kind: "flight" }>;

const FLIGHT_NO = /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/;
const normalise = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Lookup options: each leg, plus the whole journey when a flight number has several legs. */
function toOptions(legs: FlightScheduleLeg[]): FlightScheduleLeg[] {
  if (legs.length < 2) return legs;
  const first = legs[0], last = legs[legs.length - 1];
  return [
    ...legs,
    {
      ...first,
      to: last.to,
      toName: last.toName,
      arrivalTime: last.arrivalTime,
      arrivalTerminal: last.arrivalTerminal,
      aircraft: undefined,
    },
  ];
}

const optionLabel = (o: FlightScheduleLeg, all: FlightScheduleLeg[]) =>
  all.length > 1 && o === all[all.length - 1] ? "Whole journey" : `${o.from} → ${o.to}`;

type Detail = { airline: string; from: string; to: string; departureTime: string; arrivalTime: string };
const detailFrom = (o: FlightScheduleLeg): Detail => ({
  airline: o.airline ?? "",
  from: o.from,
  to: o.to,
  departureTime: o.departureTime,
  arrivalTime: o.arrivalTime ?? "",
});

const DETAIL_FIELDS: { key: keyof Detail; label: string; type?: string; required?: boolean }[] = [
  { key: "airline", label: "Airline" },
  { key: "from", label: "From", required: true },
  { key: "to", label: "To", required: true },
  { key: "departureTime", label: "Departs (local time)", type: "datetime-local", required: true },
  { key: "arrivalTime", label: "Arrives (local time)", type: "datetime-local" },
];

function LegCard({ leg }: { leg: FlightScheduleLeg }) {
  return (
    <div className="leg">
      <div className="leg-top">
        <strong>{leg.flightNumber}</strong>
        <span className="muted">{[leg.airline, leg.aircraft].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="leg-route">
        <div>
          <div className="leg-time">{formatTime(leg.departureTime)}</div>
          <div><b>{leg.from}</b> {leg.fromName}</div>
          <div className="muted small">{formatDay(leg.departureTime)}{leg.departureTerminal && ` · Terminal ${leg.departureTerminal}`}</div>
        </div>
        <div className="leg-arrow">→</div>
        <div>
          <div className="leg-time">{formatTimeOn(leg.arrivalTime, leg.departureTime) || "—"}</div>
          <div><b>{leg.to}</b> {leg.toName}</div>
          <div className="muted small">
            {leg.arrivalTime && formatDay(leg.arrivalTime)}{leg.arrivalTerminal && ` · Terminal ${leg.arrivalTerminal}`}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FlightForm({
  initial,
  defaultDate,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<FlightDraft>;
  defaultDate?: string;
  submitLabel: string;
  onSubmit: (item: DraftItem) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [flightNumber, setFlightNumber] = useState(initial?.flightNumber ?? "");
  const [date, setDate] = useState(initial?.departureTime?.slice(0, 10) ?? defaultDate ?? "");
  // Existing flights open straight into the details; new ones start with a lookup.
  const [checkedKey, setCheckedKey] = useState(initial?.flightNumber ? `${normalise(initial.flightNumber)}|${date}` : "");
  const [lookup, setLookup] = useState<{ key: string; result?: FlightLookupResult; error?: string }>();
  const [choice, setChoice] = useState(0);
  const [mode, setMode] = useState<"suggest" | "confirmed" | "edit">(initial?.flightNumber ? "edit" : "suggest");
  const [suggested, setSuggested] = useState<Detail>();
  const [detail, setDetail] = useState<Detail>({
    airline: initial?.airline ?? "",
    from: initial?.from ?? "",
    to: initial?.to ?? "",
    departureTime: initial?.departureTime?.slice(0, 16) ?? "",
    arrivalTime: initial?.arrivalTime?.slice(0, 16) ?? "",
  });
  const [extra, setExtra] = useState({ seat: initial?.seat ?? "", confirmationCode: initial?.confirmationCode ?? "", notes: initial?.notes ?? "" });
  const [price, setPrice] = useState(() => priceValue(initial?.price));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const key = `${normalise(flightNumber)}|${date}`;
  const ready = FLIGHT_NO.test(normalise(flightNumber)) && /^\d{4}-\d{2}-\d{2}$/.test(date);

  // Look up the schedule shortly after the user stops typing.
  useEffect(() => {
    if (!ready || key === checkedKey) return;
    const t = setTimeout(() => {
      setLookup({ key });
      setMode("suggest");
      setChoice(0);
      api
        .lookupFlight(normalise(flightNumber), date)
        .then((result) => setLookup((l) => (l?.key === key ? { key, result } : l)))
        .catch((e) => setLookup((l) => (l?.key === key ? { key, error: e.message } : l)));
      setCheckedKey(key);
    }, 500);
    return () => clearTimeout(t);
  }, [key, ready, checkedKey, flightNumber, date]);

  const options = useMemo(() => toOptions(lookup?.result?.legs ?? []), [lookup]);
  const current = options[choice];
  const searching = lookup && lookup.key === key && !lookup.result && !lookup.error;

  const confirm = () => {
    const d = detailFrom(current);
    setSuggested(d);
    setDetail(d);
    setMode("confirmed");
  };
  const overwrite = () => {
    if (current) {
      const d = detailFrom(current);
      setSuggested(d);
      setDetail(d);
    } else if (!detail.departureTime && date) {
      setDetail((x) => ({ ...x, departureTime: `${date}T09:00` }));
    }
    setMode("edit");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({
        kind: "flight",
        source: initial?.source ?? "manual",
        flightNumber: normalise(flightNumber),
        ...detail,
        arrivalTime: detail.arrivalTime || undefined,
        airline: detail.airline || undefined,
        ...extra,
        emailId: initial?.emailId,
        price: toMoney(price) ?? null,
        ...(initial?.links ? { links: initial.links } : {}),
        ...(initial?.attachments ? { attachments: initial.attachments } : {}),
      } as FlightDraft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const showSuggestion = mode === "suggest" && ready && lookup?.key === key;

  return (
    <form className="item-form" onSubmit={submit}>
      <div className="grid2">
        <label>
          Flight number
          <input required autoFocus={!initial} value={flightNumber} placeholder="QF1" onChange={(e) => setFlightNumber(e.target.value)} />
        </label>
        <label>
          Date of departure
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {mode === "suggest" && !showSuggestion && (
        <p className="muted small">Enter the flight number and date and we'll fill in the rest.</p>
      )}

      {showSuggestion && (
        <div className="lookup">
          {searching && <p className="muted small">Looking up {normalise(flightNumber)}…</p>}
          {lookup?.error && (
            <>
              <p className="warning small">{lookup.error}</p>
              <button type="button" className="secondary" onClick={overwrite}>Enter details manually</button>
            </>
          )}
          {lookup?.result && options.length === 0 && (
            <>
              <p className="small">
                We couldn't find <b>{normalise(flightNumber)}</b> on {formatDay(date)}. Check the number and date, or enter the details yourself.
              </p>
              {lookup.result.provider === "mock" && (
                <p className="muted tiny">
                  Demo flight data only knows a few sample flights (e.g. QF1, SQ232, BA15). <a href="#/settings">Connect real flight data</a> to look up any flight.
                </p>
              )}
              <button type="button" className="secondary" onClick={overwrite}>Enter details manually</button>
            </>
          )}
          {current && (
            <>
              <p className="small"><b>Is this your flight?</b></p>
              {options.length > 1 && (
                <div className="chips leg-choice">
                  {options.map((o, i) => (
                    <button type="button" key={i} className={`chip ${i === choice ? "on" : ""}`} onClick={() => setChoice(i)}>
                      {optionLabel(o, options)}
                    </button>
                  ))}
                </div>
              )}
              <LegCard leg={current} />
              {lookup.result?.provider === "mock" && (
                <p className="muted tiny">Demo schedule data — <a href="#/settings">connect real flight data</a> for real schedules.</p>
              )}
              {current.basis === "weekly" && (
                <p className="muted tiny">From the airline's regular weekly schedule — check the times against your booking.</p>
              )}
              <div className="actions start">
                <button type="button" onClick={confirm}>✓ Yes, that's my flight</button>
                <button type="button" className="ghost" onClick={overwrite}>Not quite — let me edit</button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "confirmed" && current && (
        <div className="lookup confirmed">
          <p className="small ok-text">✓ Details from the airline schedule</p>
          <LegCard leg={current} />
          <button type="button" className="link" onClick={() => setMode("edit")}>Edit details</button>
        </div>
      )}

      {mode === "edit" && (
        <>
          {suggested ? (
            <p className="muted small">
              Change anything that's different on your booking.{" "}
              <button type="button" className="link" onClick={() => { setDetail(suggested); setMode("confirmed"); }}>
                Use schedule details
              </button>
            </p>
          ) : (
            ready && (
              <p className="muted small">
                <button type="button" className="link" onClick={() => setCheckedKey("")}>Check against the airline schedule</button>
              </p>
            )
          )}
          <div className="grid2">
            {DETAIL_FIELDS.map((f) => {
              const overridden = suggested && suggested[f.key] !== detail[f.key];
              const undo = overridden && (
                <span className="hint">
                  Schedule: {suggested[f.key] || "—"}{" "}
                  <button type="button" className="link" onClick={() => setDetail((d) => ({ ...d, [f.key]: suggested[f.key] }))}>
                    undo
                  </button>
                </span>
              );
              if (f.key === "from" || f.key === "to") {
                return (
                  <div key={f.key} className="field">
                    <AirportSelect
                      label={f.key === "from" ? "From" : "To"}
                      value={detail[f.key]}
                      required={f.required}
                      overridden={!!overridden}
                      onChange={(code) => setDetail((d) => ({ ...d, [f.key]: code }))}
                    />
                    {undo}
                  </div>
                );
              }
              return (
                <label key={f.key} className={overridden ? "overridden" : ""}>
                  {f.label}
                  <input
                    type={f.type ?? "text"}
                    required={f.required}
                    value={detail[f.key]}
                    onChange={(e) => setDetail((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                  {overridden && (
                    <span className="hint">
                      Schedule: {f.type ? suggested[f.key].replace("T", " ") || "—" : suggested[f.key] || "—"}{" "}
                      <button type="button" className="link" onClick={() => setDetail((d) => ({ ...d, [f.key]: suggested[f.key] }))}>
                        undo
                      </button>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </>
      )}

      {mode !== "suggest" && (
        <div className="grid2">
          <label>Seat<input value={extra.seat} onChange={(e) => setExtra((x) => ({ ...x, seat: e.target.value }))} /></label>
          <label>Booking ref<input value={extra.confirmationCode} onChange={(e) => setExtra((x) => ({ ...x, confirmationCode: e.target.value }))} /></label>
          <PriceField value={price} onChange={setPrice} />
          <label>Notes<input value={extra.notes} onChange={(e) => setExtra((x) => ({ ...x, notes: e.target.value }))} /></label>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        {mode !== "suggest" && <button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>}
      </div>
    </form>
  );
}
