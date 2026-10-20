import { useEffect, useState } from "react";
import { TRAVEL_PARTIES, TRAVEL_STYLES, TRIP_PURPOSES, type Trip, type TripPlace, type TravelStyle } from "../../shared/types.ts";
import type { TripInput } from "../api.ts";
import PartsEditor from "./PartsEditor.tsx";
import PlaceSelect from "./PlaceSelect.tsx";

const PURPOSE_LABELS = { business: "Business", leisure: "Leisure", bleisure: "Business + leisure" };

export default function TripForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Trip;
  onSubmit: (t: TripInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TripInput>(
    initial ?? { name: "", destination: "", places: [], startDate: "", endDate: "", purpose: "leisure", party: "solo", styles: [], notes: "" },
  );
  // Older trips have a typed destination: turn it into places ("Mexico, Panama and Colombia" → 3 countries).
  useEffect(() => {
    if (!initial || initial.places?.length || !initial.destination) return;
    fetch(`/api/places/match?text=${encodeURIComponent(initial.destination)}`)
      .then((r) => (r.ok ? (r.json() as Promise<TripPlace[]>) : []))
      .then((places) => places.length && setForm((f) => (f.places?.length ? f : { ...f, places })));
  }, [initial]);
  const [error, setError] = useState<string>();
  const set = <K extends keyof TripInput>(k: K, v: TripInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStyle = (s: TravelStyle) =>
    set("styles", form.styles.includes(s) ? form.styles.filter((x) => x !== s) : [...form.styles, s]);

  return (
    <form
      className="card form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (form.endDate < form.startDate) return setError("End date must be after the start date");
        if (!form.places?.length && !form.destination) return setError("Choose at least one destination");
        try {
          await onSubmit(form);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2>{initial ? "Edit trip" : "New trip"}</h2>
      <div className="grid2">
        <label className="span2">Trip name<input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Tokyo client visit" /></label>
        <div className="span2">
          <PlaceSelect value={form.places ?? []} onChange={(places) => set("places", places)} />
        </div>
        <label>Start<input required type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
        <label>End<input required type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} /></label>
      </div>

      <fieldset>
        <legend>Type of trip</legend>
        <div className="chips">
          {TRIP_PURPOSES.map((p) => (
            <button type="button" key={p} className={`chip ${form.purpose === p ? "on" : ""}`} onClick={() => set("purpose", p)}>
              {PURPOSE_LABELS[p]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Who's travelling{form.parts?.length ? " (outside the parts below)" : ""}</legend>
        <div className="chips">
          {TRAVEL_PARTIES.map((p) => (
            <button type="button" key={p} className={`chip ${form.party === p ? "on" : ""}`} onClick={() => set("party", p)}>
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Travel style (pick any)</legend>
        <div className="chips">
          {TRAVEL_STYLES.map((s) => (
            <button type="button" key={s} className={`chip ${form.styles.includes(s) ? "on" : ""}`} onClick={() => toggleStyle(s)}>
              {s}
            </button>
          ))}
        </div>
      </fieldset>

      <PartsEditor
        parts={form.parts ?? []}
        onChange={(parts) => set("parts", parts)}
        tripStart={form.startDate}
        tripEnd={form.endDate}
        defaultParty={form.party}
      />

      <label>Notes for suggestions (optional)
        <textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Vegetarian, love jazz bars, first time in Japan…" />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit">{initial ? "Save" : "Create trip"}</button>
      </div>
    </form>
  );
}
