import { t } from "../i18n.ts";
import { partyLabel, styleLabel } from "../labels.ts";
import { useEffect, useState } from "react";
import { TRAVEL_PARTIES, TRAVEL_STYLES, TRIP_PURPOSES, type Trip, type TripPlace, type TravelStyle } from "../../shared/types.ts";
import type { TripInput } from "../api.ts";
import PartsEditor from "./PartsEditor.tsx";
import PlaceSelect from "./PlaceSelect.tsx";

const purposeChip = (p: (typeof TRIP_PURPOSES)[number]) => ({ business: t("Business"), leisure: t("Leisure"), bleisure: t("Business + leisure") })[p];

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
        if (form.endDate < form.startDate) return setError(t("End date must be after the start date"));
        if (!form.places?.length && !form.destination) return setError(t("Choose at least one destination"));
        try {
          await onSubmit(form);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2>{initial ? t("Edit trip") : t("New trip")}</h2>
      <div className="grid2">
        <label className="span2">{t("Trip name")}<input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("Tokyo client visit")} /></label>
        <div className="span2">
          <PlaceSelect value={form.places ?? []} onChange={(places) => set("places", places)} />
        </div>
        <label>
          {t("Start")}
          <input
            required
            type="date"
            value={form.startDate}
            onChange={(e) => {
              const start = e.target.value;
              set("startDate", start);
              // A start after the end moves the end along, keeping the trip's length.
              if (start && form.endDate && form.startDate && form.endDate < start) {
                const days = Math.max(0, (Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000);
                set("endDate", new Date(Date.parse(start) + days * 86_400_000).toISOString().slice(0, 10));
              }
            }}
          />
        </label>
        <label>
          {t("End")}
          <input required type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend>{t("Type of trip")}</legend>
        <div className="chips">
          {TRIP_PURPOSES.map((p) => (
            <button type="button" key={p} className={`chip ${form.purpose === p ? "on" : ""}`} onClick={() => set("purpose", p)}>
              {purposeChip(p)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>{form.parts?.length ? t("Who's travelling (outside the parts below)") : t("Who's travelling")}</legend>
        <div className="chips">
          {TRAVEL_PARTIES.map((p) => (
            <button type="button" key={p} className={`chip ${form.party === p ? "on" : ""}`} onClick={() => set("party", p)}>
              {partyLabel(p)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>{t("Travel style (pick any)")}</legend>
        <div className="chips">
          {TRAVEL_STYLES.map((s) => (
            <button type="button" key={s} className={`chip ${form.styles.includes(s) ? "on" : ""}`} onClick={() => toggleStyle(s)}>
              {styleLabel(s)}
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

      <label>{t("Notes for suggestions (optional)")}
        <textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder={t("Vegetarian, love jazz bars, first time in Japan…")} />
      </label>

      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit">{initial ? t("Save") : t("Create trip")}</button>
      </div>
    </form>
  );
}
