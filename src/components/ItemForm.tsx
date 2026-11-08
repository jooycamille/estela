import { useState } from "react";
import { api, type LodgingResult } from "../api.ts";
import { GUIDE_LIST_KEYS, GUIDE_TEXT_KEYS, type ActivityGuide, type DraftItem, type ItineraryItem, type Link } from "../../shared/types.ts";
import FlightForm from "./FlightForm.tsx";
import LodgingField from "./LodgingField.tsx";
import PriceField, { priceValue, toMoney } from "./PriceField.tsx";

export type Kind = ItineraryItem["kind"];

type Field = { key: string; label: string; type?: "datetime-local" | "text"; required?: boolean; placeholder?: string };

// Flights use FlightForm (lookup by flight number + date).
const FIELDS: Record<Exclude<Kind, "flight">, Field[]> = {
  stay: [
    { key: "name", label: "Property", required: true, placeholder: "Park Hyatt Tokyo" },
    { key: "address", label: "Address" },
    { key: "checkIn", label: "Check-in", type: "datetime-local", required: true },
    { key: "checkOut", label: "Check-out", type: "datetime-local", required: true },
    { key: "confirmationCode", label: "Confirmation #" },
  ],
  activity: [
    { key: "title", label: "What", required: true, placeholder: "Client meeting / Sushi class" },
    { key: "location", label: "Where" },
    { key: "start", label: "Starts", type: "datetime-local", required: true },
    { key: "end", label: "Ends", type: "datetime-local" },
    { key: "category", label: "Category", placeholder: "meeting, tour, dinner…" },
    { key: "confirmationCode", label: "Booking ref" },
  ],
};

// Start and end fields that go together (an end can't be before its start).
const END_OF: Record<string, string> = { end: "start", checkOut: "checkIn" };
const START_OF: Record<string, string> = { start: "end", checkIn: "checkOut" };
const toMs = (t: string) => Date.parse(`${t.slice(0, 16)}:00Z`);
const minutesBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / 60_000);
/** "2026-12-11T09:00" + 60 → "2026-12-11T10:00" (wall-clock times, no time zones involved). */
const addMinutes = (t: string, minutes: number) => new Date(toMs(t) + minutes * 60_000).toISOString().slice(0, 16);

export const KIND_LABEL: Record<Kind, string> = { flight: "Flight", stay: "Accommodation", activity: "Activity" };

export default function ItemForm(props: Parameters<typeof GenericItemForm>[0]) {
  if (props.kind === "flight") {
    return (
      <FlightForm
        initial={props.initial as Extract<DraftItem, { kind: "flight" }> | undefined}
        defaultDate={props.defaultDate}
        submitLabel={props.submitLabel ?? "Save"}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
      />
    );
  }
  return <GenericItemForm {...props} />;
}

function GenericItemForm({
  kind,
  initial,
  tripId,
  defaultDate,
  submitLabel = "Save",
  onSubmit,
  onCancel,
}: {
  kind: Kind;
  initial?: Partial<DraftItem>;
  tripId?: string; // to search accommodation near where you'll be
  defaultDate?: string;
  submitLabel?: string;
  onSubmit: (item: DraftItem) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of FIELDS[kind as Exclude<Kind, "flight">]) {
      const init = (initial as Record<string, unknown> | undefined)?.[f.key];
      v[f.key] = typeof init === "string" ? init.slice(0, f.type === "datetime-local" ? 16 : undefined) : "";
      // New stays: check in at 3 pm, check out at 11 am the next day; other times start at 9 am.
      if (!v[f.key] && f.required && f.type === "datetime-local" && defaultDate)
        v[f.key] = f.key === "checkIn" ? `${defaultDate}T15:00` : f.key === "checkOut" ? `${addMinutes(`${defaultDate}T11:00`, 24 * 60)}` : `${defaultDate}T09:00`;
    }
    v.notes = (initial?.notes as string) ?? "";
    return v;
  });
  const [price, setPrice] = useState(() => priceValue(initial?.price));
  const initialLinks: Link[] = initial?.links ?? [];
  const [bookingLink, setBookingLink] = useState(initialLinks[0]?.url ?? "");
  const initialGuide = initial && "guide" in initial ? (initial.guide as ActivityGuide | undefined) : undefined;
  const [guide, setGuide] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...GUIDE_LIST_KEYS.map((k) => [k, (initialGuide?.[k] ?? []).join("\n")]),
      ...GUIDE_TEXT_KEYS.map((k) => [k, initialGuide?.[k] ?? ""]),
    ]),
  );
  const [showGuide, setShowGuide] = useState(false);
  // Stays: map position of the picked address, and named properties found there.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | undefined>(() =>
    initial && "lat" in initial && typeof initial.lat === "number" && typeof initial.lon === "number" ? { lat: initial.lat, lon: initial.lon } : undefined,
  );
  const [nearby, setNearby] = useState<LodgingResult[]>();
  const pickLodging = (r: LodgingResult, from: "name" | "address") => {
    setValues((v) => ({ ...v, address: r.address, ...(r.name ? { name: r.name } : {}) }));
    setCoords({ lat: r.lat, lon: r.lon });
    setNearby(undefined);
    // Searched by address: offer the properties at that spot, to fill in the name.
    if (from === "address" && !r.name) api.lodgingAt(r.lat, r.lon, r.address).then(setNearby, () => setNearby([]));
  };
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const buildGuide = (): ActivityGuide => {
    const out: Record<string, unknown> = {};
    for (const k of GUIDE_LIST_KEYS) {
      const list = guide[k].split("\n").map((l) => l.trim()).filter(Boolean);
      if (list.length) out[k] = list;
    }
    for (const k of GUIDE_TEXT_KEYS) if (guide[k].trim()) out[k] = guide[k].trim();
    return out as ActivityGuide;
  };

  return (
    <form
      className="item-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          const url = bookingLink.trim();
          const links = url
            ? [{ label: initialLinks[0]?.label ?? "Booking details", url }, ...initialLinks.slice(1)]
            : initialLinks.slice(1);
          await onSubmit({
            ...values,
            kind,
            source: initial?.source ?? "manual",
            emailId: initial?.emailId,
            price: toMoney(price) ?? null,
            links,
            ...(initial?.attachments ? { attachments: initial.attachments } : {}),
            // Saving an activity confirms its date (it may have been estimated from the email).
            ...(kind === "stay" || kind === "activity" ? { lat: coords?.lat, lon: coords?.lon } : {}),
            ...(kind === "activity" ? { guide: buildGuide(), dateEstimated: false } : {}),
          } as unknown as DraftItem);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid2">
        {FIELDS[kind as Exclude<Kind, "flight">].map((f) =>
          kind === "activity" && f.key === "location" ? (
            // Where: look up a place or address near where you'll be that day.
            <LodgingField
              key={f.key}
              label={f.label}
              value={values.location}
              placeholder="A place or address. Find shows where it is"
              search={(q) => api.searchPlaces(q, undefined, tripId, values.start?.slice(0, 10))}
              onChange={(val) => {
                setValues((v) => ({ ...v, location: val }));
                setCoords(undefined);
              }}
              onPick={(r) => {
                // "Museo Frida Kahlo, Londres 247, Del Carmen, Mexico City…" (the name, then where it is)
                const address = r.name && !r.address.startsWith(r.name) ? `${r.name}, ${r.address}` : r.address;
                setValues((v) => ({ ...v, location: address }));
                setCoords({ lat: r.lat, lon: r.lon });
              }}
            />
          ) : kind === "stay" && (f.key === "name" || f.key === "address") ? (
            <div key={f.key}>
              <LodgingField
                label={f.label}
                value={values[f.key]}
                required={f.required}
                placeholder={f.key === "name" ? "Hotel name — Find shows its address" : "Street & number — Find shows the place"}
                tripId={tripId}
                date={values.checkIn?.slice(0, 10)}
                onChange={(val) => {
                  setValues((v) => ({ ...v, [f.key]: val }));
                  if (f.key === "address") setCoords(undefined);
                }}
                onPick={(r) => pickLodging(r, f.key as "name" | "address")}
              />
              {f.key === "address" && nearby && (
                <p className="small nearby">
                  {nearby.length ? (
                    <>
                      <span className="muted">Is it one of these (on this street or next door)? </span>
                      {nearby.map((p) => (
                        <button key={p.name} type="button" className="chip" title={p.address} onClick={() => {
                          // Keep the typed address (with its house number) unless the property's own address has one.
                          setValues((v) => ({ ...v, name: p.name!, address: /\d/.test(p.address.split(",")[0]) ? p.address : v.address }));
                          setCoords({ lat: p.lat, lon: p.lon });
                          setNearby(undefined);
                        }}>{p.name}</button>
                      ))}
                    </>
                  ) : (
                    <span className="muted">No hotels or guest houses on the map here, so it may be a private home or apartment. Just type its name.</span>
                  )}
                </p>
              )}
            </div>
          ) : (
          <label key={f.key}>
            {f.label}
            <input
              type={f.type ?? "text"}
              required={f.required}
              placeholder={f.placeholder}
              value={values[f.key]}
              // An end can't be before its start, so its picker starts from the start.
              min={END_OF[f.key] ? values[END_OF[f.key]] || undefined : undefined}
              onFocus={() => {
                // Tapping an empty end: fill it from the start (an hour later), so the picker opens on the right day.
                const startKey = END_OF[f.key];
                if (startKey && !values[f.key] && values[startKey]) setValues((v) => ({ ...v, [f.key]: addMinutes(v[startKey], 60) }));
              }}
              onChange={(e) => {
                const value = e.target.value;
                setValues((v) => {
                  const next = { ...v, [f.key]: value };
                  // Moving the start keeps the length: the end moves with it (if it would end up before the start).
                  const endKey = START_OF[f.key];
                  if (endKey && v[endKey] && v[f.key] && value && v[endKey] <= value) {
                    const length = Math.max(60, minutesBetween(v[f.key], v[endKey]));
                    next[endKey] = addMinutes(value, length);
                  }
                  return next;
                });
              }}
            />
          </label>
          ),
        )}
      </div>
      <div className="grid2">
        <PriceField value={price} onChange={setPrice} />
        <label>
          Booking link
          <input type="url" placeholder="https://…" value={bookingLink} onChange={(e) => setBookingLink(e.target.value)} />
        </label>
      </div>
      <label>
        Notes
        <textarea
          rows={2}
          value={values.notes}
          placeholder={kind === "stay" ? "e.g. Check-in after 3:00 pm · Check-out before 1:00 pm" : ""}
          onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
        />
      </label>
      {kind === "activity" && (
        <fieldset className="guide-editor">
          <button type="button" className="link" onClick={() => setShowGuide((s) => !s)} aria-expanded={showGuide}>
            {showGuide ? "▾" : "▸"} Activity guide (itinerary, what to bring/wear, do's & don'ts…)
          </button>
          {showGuide && (
            <>
              <p className="muted tiny">One item per line.</p>
              <div className="grid2">
                {GUIDE_LIST_KEYS.map((k) => (
                  <label key={k}>
                    {GUIDE_LABELS[k]}
                    <textarea rows={3} value={guide[k]} onChange={(e) => setGuide((g) => ({ ...g, [k]: e.target.value }))} />
                  </label>
                ))}
                {GUIDE_TEXT_KEYS.map((k) =>
                  k === "meetingPoint" || k === "endPoint" ? (
                    <LodgingField
                      key={k}
                      label={GUIDE_LABELS[k]}
                      value={guide[k]}
                      placeholder="A place or address — Find shows where it is"
                      search={(q) => api.searchPlaces(q, undefined, tripId, values.start?.slice(0, 10))}
                      onChange={(v) => setGuide((g) => ({ ...g, [k]: v }))}
                      onPick={(r) => setGuide((g) => ({ ...g, [k]: placeText(r) }))}
                    />
                  ) : (
                    <label key={k}>
                      {GUIDE_LABELS[k]}
                      <input value={guide[k]} onChange={(e) => setGuide((g) => ({ ...g, [k]: e.target.value }))} />
                    </label>
                  ),
                )}
              </div>
            </>
          )}
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

/** A picked place as text: its name and full address, without repeating the name. */
const placeText = (r: LodgingResult) =>
  r.name && !r.address.toLowerCase().startsWith(r.name.toLowerCase()) ? `${r.name}, ${r.address}` : r.address;

const GUIDE_LABELS: Record<string, string> = {
  itinerary: "Itinerary",
  whatToBring: "What to bring",
  whatToWear: "What to wear",
  dos: "Do's",
  donts: "Don'ts / not allowed",
  beforeYouGo: "Before you go",
  goodToKnow: "Good to know",
  included: "Included",
  notIncluded: "Not included",
  meetingPoint: "Meeting point / pickup",
  endPoint: "Ends at",
  cancellation: "Cancellation policy",
  provider: "Provider & contact",
  pin: "PIN",
};
