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
import { Clock, CloudRain, Link2, Luggage, Paperclip } from "lucide-react";
import { differenceText, msToWall, wallToMs, zoneCity } from "../zones.ts";
import { isOutdoor, useTripDays } from "../tripDays.tsx";
import { t } from "../i18n.ts";

/** "Free cancellation until Tue, 8 Dec, 7:39 PM", "Non-refundable"… as a tag on the card. */
function CancelTag({ terms }: { terms?: Cancellation }) {
  if (!terms) return null;
  if (terms.kind === "partial") return <span className="cancel-tag partial">{t("Partial refund")}</span>;
  if (terms.kind === "nonrefundable") return <span className="cancel-tag closed">{t("Non-refundable")}</span>;
  if (!terms.until) return <span className="cancel-tag free">{t("Free cancellation")}</span>;
  // The device's clock, near enough for a label: the reminders work from the activity's real time zone.
  if (terms.until < new Date().toLocaleString("sv").slice(0, 16).replace(" ", "T")) return <span className="cancel-tag closed">{t("Free cancellation ended")}</span>;
  return (
    <span className="cancel-tag free" title={t("Local time where the activity is")}>
      {t("Free cancellation until {formatDay}{v2}", { formatDay: formatDay(terms.until.slice(0, 10)), v2: terms.timed ? `, ${formatTime(terms.until)}` : "" })}
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
          <b className="small">{t("Places included")}</b>
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
                <button type="button" className="chip-x edit-only" aria-label={t("Remove {title}", { title: p.title })} onClick={() => save(places.filter((x) => x !== p))}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="link small edit-only" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
        {adding ? t("Done adding places") : t("+ Add a place this includes")}
      </button>
      {adding && (
        <div className="included-add edit-only">
          <LodgingField
            label={t("Place")}
            value={name}
            placeholder={t("A place this visits, e.g. a museum or ruins")}
            search={(q) => api.searchPlaces(q, undefined, item.tripId, item.start.slice(0, 10))}
            onChange={setName}
            onPick={(r) => add({ title: r.name ?? name, address: r.address, lat: r.lat, lon: r.lon })}
          />
          <button type="button" className="secondary" disabled={!name.trim()} onClick={() => add({ title: name })}>{t("Add")}</button>
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
    { key: "included", label: t("Included"), mark: "✓", values: item.guide?.included ?? [] },
    { key: "notIncluded", label: t("Not included"), mark: "✕", values: item.guide?.notIncluded ?? [] },
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
                  <button type="button" className="chip-x edit-only" aria-label={t("Remove {v}", { v })} onClick={() => save(g.key, g.values.filter((x) => x !== v))}>×</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="link small edit-only" aria-expanded={adding === g.key} onClick={() => { setAdding(adding === g.key ? undefined : g.key); setText(""); }}>
            {adding === g.key ? t("Done") : `+ ${g.label}`}
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
            aria-label={adding === "included" ? t("What's included") : t("What's not included")}
            value={text}
            placeholder={adding === "included" ? t("e.g. Lunch, hotel pickup, entry fees") : t("e.g. Tips, drinks, national park fee")}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={!text.trim()}>{t("Add")}</button>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** What you can take: from the booking, or a link to look it up when it isn't known. */
function BaggageLine({ f }: { f: FlightItem }) {
  const b = f.baggage;
  const airline = f.airline ?? f.flightNumber.match(/^[A-Z0-9]{2}/)?.[0] ?? "";
  return (
    <div className="row small baggage">
      <Luggage aria-hidden="true" />
      {b ? (
        <>
          {b.cabin && <span>{t("Cabin")}{" "}<b>{b.cabin}</b></span>}
          {b.checked && <span>{t("Checked")}{" "}<b>{b.checked}</b></span>}
        </>
      ) : (
        <span className="muted">
          {t("Baggage allowance not known.")}{" "}
          <a href={`https://www.google.com/search?q=${encodeURIComponent(`${airline} baggage allowance`)}`} target="_blank" rel="noopener noreferrer">{f.airline ? t("Check {airline}'s rules ↗", { airline: f.airline }) : t("Check the airline's rules ↗")}</a>
          <span className="edit-only">{t(", then add it with Edit")}</span>
        </span>
      )}
    </div>
  );
}

const span = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;

/**
 * The real flight time (the two times are in different zones), the clock change on landing, and the time at home
 * when you land, when home is somewhere else.
 */
function FlightTimes({ dep, arr, from, to }: { dep: string; arr?: string; from?: string; to?: string }) {
  const home = useTripDays()?.home ?? undefined;
  if (!arr || !from || !to) return null;
  const leaves = wallToMs(dep, from), lands = wallToMs(arr, to);
  const minutes = Math.round((lands - leaves) / 60_000);
  if (minutes <= 0 || minutes > 30 * 60) return null; // times that don't add up (a typo, or a missing date change)
  const clocks = differenceText(to, from, zoneCity(from), lands);
  const atHome = home && home !== to ? msToWall(lands, home) : undefined;
  return (
    <div className="row small muted flight-times">
      <span><Clock aria-hidden="true" />{" "}{t("{span} in the air", { span: span(minutes) })}</span>
      {clocks && <span>{t("{zoneCity} is {clocks}", { zoneCity: zoneCity(to), clocks })}</span>}
      {atHome && <span>{t("Lands at {formatTimeOn} home time", { formatTimeOn: formatTimeOn(atHome, arr) })}</span>}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  get scheduled() { return t("Scheduled"); }, get on_time() { return t("On time"); }, get delayed() { return t("Delayed"); }, get boarding() { return t("Boarding"); }, get departed() { return t("Departed"); },
  get landed() { return t("Landed"); }, get cancelled() { return t("Cancelled"); }, get diverted() { return t("Diverted"); }, get unknown() { return t("Unknown"); },
};

function FlightBody({ f: flight, mockFlights, onChange }: { f: FlightItem; mockFlights: boolean; onChange: () => void }) {
  // Demo status left over from before real flight data was connected isn't shown; real status replaces it near departure.
  const f = flight.live?.provider === "mock" && !mockFlights ? { ...flight, live: undefined, changes: [] } : flight;
  const dep = f.live?.departureTime ?? f.departureTime;
  const arr = f.live?.arrivalTime ?? f.arrivalTime;
  const depMoved = f.live?.departureTime && f.live.departureTime !== f.departureTime;
  const pending = f.changes.filter((c) => !c.acknowledged);
  const days = useTripDays();
  const zones = { from: days?.airports[f.from.toUpperCase()], to: days?.airports[f.to.toUpperCase()] };

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
          {t("Departs")}{" "}{depMoved && <s className="muted">{formatTime(f.departureTime)}</s>} <b>{formatTimeOn(dep, f.departureTime)}</b>
          {f.live?.departureTerminal && ` · T${f.live.departureTerminal}`}
          {f.live?.departureGate && t(" · Gate {departureGate}", { departureGate: f.live.departureGate })}
        </span>
        {arr && <span>{t("Arrives")}{" "}<b>{formatTimeOn(arr, f.departureTime)}</b>{zones.to && zones.from && zones.to !== zones.from ? t(" local") : ""}</span>}
        {f.seat && <span>{t("Seat {seat}", { seat: f.seat })}</span>}
      </div>
      <FlightTimes dep={dep} arr={arr} from={zones.from} to={zones.to} />
      <BaggageLine f={f} />
      {pending.length > 0 && (
        <div className="change-alert">
          <strong>{t("Estela noticed a change to {flightNumber}", { flightNumber: f.flightNumber })}</strong>
          <ul>
            {pending.map((c, i) => (
              <li key={i}>{c.field}: {c.from ? <s>{c.from.replace("T", " ")}</s> : "—"} → <b>{c.to?.replace("T", " ")}</b></li>
            ))}
          </ul>
          <button className="small-btn" onClick={() => api.acknowledge(f.id).then(onChange)}>{t("Got it")}</button>
        </div>
      )}
      <div className="row small muted">
        {f.live ? t("Checked {v1} via {provider}", { v1: new Date(f.live.checkedAt).toLocaleString(), provider: f.live.provider }) : t("Live status not available yet — checked automatically closer to departure")}
        {mockFlights && (
          <button className="link" onClick={() => api.simulateChange(f.id).then(onChange)}>{t("Simulate a change")}</button>
        )}
      </div>
    </>
  );
}

export default function ItemCard({ item, day, mockFlights, onChange, linkedFlight }: { item: ItineraryItem; day?: string; mockFlights: boolean; onChange: () => void; linkedFlight?: FlightItem }) {
  const [editing, setEditing] = useState(false);
  const days = useTripDays();
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
          ? isLastDay ? t("Until {v1}", { v1: formatTime(item.end) }) : t("All day")
          : formatTime(item.kind === "flight" ? item.live?.departureTime ?? item.departureTime : item.kind === "stay" ? item.checkIn : item.start)}
      </div>
      <div className="item-body">
        {item.kind === "flight" && <FlightBody f={item} mockFlights={mockFlights} onChange={onChange} />}
        {item.kind === "stay" && (
          <>
            <div className="row"><strong><span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(item)} /></span>{item.name}</strong></div>
            <div className="row small">
              <span>{t("Check-in {formatTime}", { formatTime: formatTime(item.checkIn) })}</span>
              <span>{t("Check-out {day} {time}", { day: formatDay(item.checkOut), time: formatTime(item.checkOut) })}</span>
              {item.address && <span className="muted">{item.address}</span>}
            </div>
          </>
        )}
        {item.kind === "activity" && (
          <>
            <div className="row">
              <strong><span className="item-icon" aria-hidden="true"><Ico icon={itemIcon(item)} /></span>{item.title}</strong>
              {dayIndex >= 0 && <span className="tag day-of">{t("Day {v1} of {length}", { v1: dayIndex + 1, length: runsOn.length })}</span>}
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
                  {landsAt && landsAt !== item.start ? t("{flightNumber} has changed, booked for {v2}", { flightNumber: linkedFlight.flightNumber, v2: formatTime(item.start) }) : t("Follows {flightNumber}", { flightNumber: linkedFlight.flightNumber })}
                </span>
              )}
              {linkedFlight && item.transferLeg === "dropoff" && (
                <span className="muted">{t("For {flightNumber}, departs {formatTime}", { flightNumber: linkedFlight.flightNumber, formatTime: formatTime(linkedFlight.live?.provider === "mock" ? linkedFlight.departureTime : linkedFlight.live?.departureTime ?? linkedFlight.departureTime) })}</span>
              )}
              {item.location && <span className="muted">{item.location}</span>}
              {item.location && (
                <a
                  className="small map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.lat !== undefined ? `${item.lat},${item.lon}` : item.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("Map ↗")}
                </a>
              )}
            </div>
            {(() => {
              // Rain likely on the day of something outdoors.
              const w = day ? days?.days[day]?.weather : undefined;
              return w && w.rain >= 60 && isOutdoor(item) && !isLaterDay ? (
                <p className="rain-note small"><CloudRain aria-hidden="true" />{" "}{item.price ? t("{rain}% chance of rain this day. Worth packing a rain jacket or checking the operator's rain policy.", { rain: w.rain }) : t("{rain}% chance of rain this day. Worth packing a rain jacket.", { rain: w.rain })}</p>
              ) : null;
            })()}
            {item.dateEstimated && (
              <p className="warning small estimate">
                {t("⚠︎ Estimated date — the email didn't say when this is. Check your booking, then Edit and save to confirm.")}
              </p>
            )}
          </>
        )}
        <div className="row small muted">
          {item.price && <span className="price">{formatMoney(item.price)}</span>}
          {item.confirmationCode && <span>{t("Ref {confirmationCode}", { confirmationCode: item.confirmationCode })}</span>}
          {item.source === "email" && <span>{t("from email")}</span>}
        </div>
        {item.notes && <div className="row small notes">{item.notes}</div>}
        <Files item={item} onChange={onChange} />
        {item.kind === "activity" && item.category !== "transfer" && <CoveredLists item={item} onChange={onChange} />}
        {item.kind === "activity" && item.category !== "transfer" && <IncludedPlaces item={item} onChange={onChange} />}
        {item.kind === "activity" && item.guide && <ActivityGuidePanel guide={item.guide} item={item} onChange={onChange} />}
      </div>
      <div className="item-actions edit-only">
        <button className="link" onClick={() => setEditing(true)}>{t("Edit")}</button>
        <button
          className="link danger"
          onClick={() => confirm(dayIndex >= 0 ? t("Delete this from all {length} days?", { length: runsOn.length }) : t("Delete this item?")) && api.deleteItem(item.id).then(onChange)}
        >
          {t("Delete")}
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
            title={t("Remove file")}
            onClick={() => confirm(t("Remove {filename}?", { filename: a.filename })) && api.removeAttachment(item.id, a.id).then(onChange)}
          >
            ✕
          </button>
        </span>
      ))}
      <label className="file-btn small edit-only">
        {busy ? t("Uploading…") : t("+ Attach file")}
        <input
          type="file"
          accept=".pdf,image/*,.pkpass"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) return setError(t("Files must be 15 MB or smaller"));
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
