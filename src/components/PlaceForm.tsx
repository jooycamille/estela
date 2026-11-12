import { useEffect, useState } from "react";
import type { Trip, TripList } from "../../shared/types.ts";
import { api, type LodgingResult } from "../api.ts";
import { formatDay } from "../format.ts";
import LodgingField from "./LodgingField.tsx";
import { t } from "../i18n.ts";

// A place you want to see on this trip (no booking or set time). It's saved in the guide for its city, and shows on the
// itinerary once it has a day.

export type AddedPlace = { title: string; day?: string; listId: string; listName: string };

function tripDays(trip: Trip) {
  const days: string[] = [];
  for (let d = new Date(`${trip.startDate}T12:00:00Z`); d <= new Date(`${trip.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function PlaceForm({
  trip,
  lists,
  date,
  onCancel,
  onAdded,
}: {
  trip: Trip;
  lists: TripList[];
  date?: string;
  onCancel: () => void;
  onAdded: (place: AddedPlace) => void;
}) {
  // City guides first, then any lists you've made.
  const choices = [...lists.filter((l) => l.auto), ...lists.filter((l) => !l.auto)];
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<Partial<Pick<LodgingResult, "area" | "lat" | "lon">>>({});
  const [day, setDay] = useState(date ?? "");
  const [notes, setNotes] = useState("");
  const [chosenList, setChosenList] = useState<string>(); // once you pick one, it's left as you set it
  const [guideDays, setGuideDays] = useState<{ listId: string; from?: string; to?: string }[]>([]);
  useEffect(() => {
    api.guideDays(trip.id).then(setGuideDays).catch(() => setGuideDays([]));
  }, [trip.id]);
  // Where it's most likely to belong: the nearest city if it's on the map, else where you are that day.
  const suggestedList = () => {
    const guides = choices.filter((l) => l.auto);
    if (picked.lat !== undefined && picked.lon !== undefined) {
      const away = (l: TripList) => (l.place?.lat === undefined || l.place.lon === undefined ? Infinity : (l.place.lat - picked.lat!) ** 2 + (l.place.lon - picked.lon!) ** 2);
      const nearest = [...guides].sort((a, b) => away(a) - away(b))[0];
      if (nearest && away(nearest) !== Infinity) return nearest.id;
    }
    const onDay = day ? guideDays.find((g) => (!g.from || g.from <= day) && (!g.to || day <= g.to))?.listId : undefined;
    return onDay ?? choices[0]?.id ?? "";
  };
  const listId = chosenList ?? suggestedList();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const list = lists.find((l) => l.id === listId);
      if (!list) throw new Error(t("Add a destination to this trip first, so there's a city guide to save this in."));
      await api.addEntry(list.id, {
        title: title.trim(),
        kind: "place",
        ...(list.auto ? { section: "see" as const } : {}), // where it belongs in a destination guide
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        ...picked,
        day: day || undefined,
      });
      onAdded({ title: title.trim(), day: day || undefined, listId: list.id, listName: list.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't save this place"));
      setBusy(false);
    }
  };

  return (
    <form
      className="card place-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3>{t("Add place")}</h3>
      <div className="grid2">
        <LodgingField
          label={t("Place")}
          value={title}
          required
          placeholder={t("A museum, park, market, viewpoint…")}
          search={(q) => api.searchPlaces(q, undefined, trip.id, day || undefined)}
          onChange={(v) => {
            setTitle(v);
            setPicked({});
          }}
          onPick={(r) => {
            setTitle(r.name ?? title);
            setAddress(r.address ?? "");
            setPicked({ area: r.area, lat: r.lat, lon: r.lon });
          }}
        />
        <label>
          {t("Address")}
          <input value={address} placeholder={t("Filled in by Find, or type your own")} onChange={(e) => { setAddress(e.target.value); setPicked({}); }} />
        </label>
        <label>
          {t("Day")}
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">{t("Not sure yet")}</option>
            {date && !tripDays(trip).includes(date) && <option value={date}>{formatDay(date)}</option>}
            {tripDays(trip).map((d) => (
              <option key={d} value={d}>{formatDay(d)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Save in")}
          <select value={listId} disabled={!choices.length} onChange={(e) => setChosenList(e.target.value)}>
            {choices.length === 0 && <option value="">{t("No city guide yet")}</option>}
            {choices.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        <label className="span2">
          {t("Notes")}
          <input value={notes} placeholder={t("Why, who recommended it, opening hours…")} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {!choices.length && <p className="muted small">{t("Add a destination to this trip first, so there's a city guide to save this in.")}</p>}
      {error && <p className="error small">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || !title.trim() || !choices.length}>{busy ? t("Adding…") : t("Add")}</button>
      </div>
    </form>
  );
}
