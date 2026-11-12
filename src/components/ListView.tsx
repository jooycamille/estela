import { useCallback, useEffect, useState , useRef } from "react";
import { activitiesMerged, listTheme, STYLE_LABELS, THEME_LABELS } from "../../shared/lists.ts";
import type { AreaGroup, ListEntry, ListSuggestion, PriceLevel, Trip, TripList } from "../../shared/types.ts";
import { api, type EntryInput, type ListSuggestions } from "../api.ts";
import { formatDay } from "../format.ts";
import Fold, { FoldAll } from "./Fold.tsx";
import LodgingField from "./LodgingField.tsx";
import { PricePicker, PriceTag } from "./Price.tsx";
import Ico from "./Ico.tsx";
import { listIcon } from "../icons.ts";
import { Map as MapIcon, Sparkles } from "lucide-react";
import { t, tn } from "../i18n.ts";

export const tripDays = (trip: Trip) => {
  const out: string[] = [];
  for (let d = new Date(`${trip.startDate}T00:00:00Z`); d <= new Date(`${trip.endDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};

/** One of your lists: what's on it, ideas to add, and nearby places grouped into days. */
export default function ListView({
  trip,
  list,
  onChanged,
  onEdit,
  onDeleted,
  onAddToItinerary,
}: {
  trip: Trip;
  list: TripList;
  onChanged: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onAddToItinerary: (entry: ListEntry) => void;
}) {
  const theme = listTheme(list.name, list.emoji);
  const labels = THEME_LABELS[theme];
  const merged = activitiesMerged(theme); // "Things to do" is already the second column
  const days = tripDays(trip);
  const [ideas, setIdeas] = useState<ListSuggestions>();
  const [areas, setAreas] = useState<AreaGroup[]>([]);
  const [error, setError] = useState<string>();

  const refreshExtras = useCallback(() => {
    api.listSuggestions(list.id).then(setIdeas).catch(() => setIdeas(undefined));
    api.areas(trip.id).then(setAreas).catch(() => setAreas([]));
  }, [list.id, trip.id]);
  // Ideas and areas change with what's on the list.
  const signature = list.entries.map((e) => `${e.id}${e.day}${e.lat}`).join("|") + (list.dismissed ?? []).length + list.name + list.place?.name;
  useEffect(refreshExtras, [refreshExtras, signature]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const places = list.entries.filter((e) => e.kind === "place");
  const things = list.entries.filter((e) => e.kind === "thing" || (merged && e.kind === "activity"));
  const activities = merged ? [] : list.entries.filter((e) => e.kind === "activity");
  const columns: ["place" | "thing" | "activity", ListEntry[], string][] = [
    ["place", places, labels.place],
    ["thing", things, labels.thing],
    ...(activities.length ? [["activity", activities, t("Things to do")] as ["activity", ListEntry[], string]] : []),
  ];
  // Areas that include something from this list (other lists' places nearby are shown too).
  // Your own lists keep everything, but say what's covered already, and leave it out of the day planning.
  const coveredBy = new Map(ideas?.bookedPicks?.map((p) => [p.id, p.bookedAs]));
  const myAreas = areas
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !coveredBy.has(e.id)) }))
    .filter((g) => g.entries.some((e) => e.listId === list.id));
  const unlocated = places.filter((e) => e.lat === undefined);

  return (
    <div className="list-view">
      <div className="card list-head">
        <div>
          <h2><Ico icon={listIcon(list)} /> {list.name}</h2>
          <p className="muted small">
            {list.place ? <>{list.place.name} · </> : t("Anywhere on this trip · ")}
            {list.entries.length ? t("{length} saved", { length: list.entries.length }) : t("Nothing on it yet")}
          </p>
          <FoldAll ids={[...columns.map(([kind]) => kind), ...(myAreas.length ? ["areas"] : []), "ideas"].map((key) => `${list.id}:${key}`)} />
        </div>
        <div className="list-head-actions edit-only">
          <button className="link" onClick={onEdit}>{t("Edit")}</button>
          <button
            className="link danger"
            onClick={() => {
              if (confirm(t("Delete “{name}” and everything on it?", { name: list.name }))) act(() => api.deleteList(list.id)).then(onDeleted);
            }}
          >
            {t("Delete")}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="list-columns">
        {columns.map(([kind, entries, heading]) => (
          <section key={kind} className="card list-col">
            <Fold id={`${list.id}:${kind}`} title={<>{heading} <span className="muted small">{entries.length || ""}</span></>}>
            {entries.length === 0 && <p className="muted small">{t("None yet. Add your own below, or pick from Estela's ideas.")}</p>}
            <ul className="entries">
              {entries.map((e) => (
                <EntryRow
                  key={e.id}
                  coveredBy={coveredBy.get(e.id)}
                  entry={e}
                  days={days}
                  onDay={(day) => act(() => api.updateEntry(list.id, e.id, { day }))}
                  onDelete={() => act(() => api.deleteEntry(list.id, e.id))}
                  onAddToItinerary={() => onAddToItinerary(e)}
                  onPrice={kind === "place" && (theme === "food" || theme === "drinks") ? (price) => act(() => api.updateEntry(list.id, e.id, { price })) : undefined}
                />
              ))}
            </ul>
            </Fold>
          </section>
        ))}
      </div>

      <AddEntry
        list={list}
        tripId={trip.id}
        options={[
          { key: "place", kind: "place", label: labels.placeOne },
          { key: "thing", kind: "thing", label: labels.thingOne, placeholder: labels.thingOne === t("Food to try") ? t("e.g. Tacos al pastor") : t("e.g. Lucha libre night") },
          ...(merged ? [] : [{ key: "activity", kind: "activity" as const, label: t("Thing to do"), placeholder: t("e.g. Salsa class") }]),
        ]}
        onAdd={(body) => act(() => api.addEntry(list.id, body))}
      />

      {(myAreas.length > 0 || unlocated.length > 0) && (
        <section className="card areas">
          <Fold id={`${list.id}:areas`} title={<><MapIcon aria-hidden="true" /> {t("Plan by area")}</>} summary={myAreas.length}>
          <p className="muted small">
            {t("Places close together, including ones from your other lists, so one day covers them. Pick a day and they'll show up in your itinerary in walking order.")}
          </p>
          {myAreas.map((g) => (
            <AreaCard key={g.entries.map((e) => e.id).join()} group={g} listId={list.id} days={days} onPlan={(day) =>
              act(() => api.planDay(trip.id, day, g.entries.map((e) => ({ listId: e.listId, entryId: e.id }))))
            } />
          ))}
          {unlocated.length > 0 && (
            <p className="muted tiny">
              {t("Not found on the map yet, so not grouped: {v1}. Edit the name, or plan them with the day menu.", { v1: unlocated.map((e) => e.title).join(", ") })}
            </p>
          )}
          </Fold>
        </section>
      )}

      <section className="card list-ideas">
        <Fold id={`${list.id}:ideas`} title={<><Sparkles aria-hidden="true" /> {t("Estela's ideas for {name}", { name: list.name })}</>} summary={ideas ? ideas.suggestions.length + ideas.styleIdeas.length : undefined}>
        {!ideas && <p className="muted small">{t("Thinking…")}</p>}
        {(ideas?.bookedIdeas?.length ?? 0) > 0 && (
          <p className="muted small booked-ideas">{t("✓ Left out because they're booked, planned or part of a tour: {v1}", { v1: ideas!.bookedIdeas!.join(" · ") })}</p>
        )}
        {ideas && ideas.suggestions.length === 0 && (
          <p className="muted small">{t("No more ideas right now. Try the searches below.")}</p>
        )}
        <ul className="idea-grid">
          {ideas?.suggestions.map((s) => (
            <IdeaCard
              key={s.title}
              idea={s}
              labels={labels}
              onAdd={() => act(() => api.addEntry(list.id, { title: s.title, kind: s.kind, notes: s.detail, links: s.links, price: s.price }))}
              onDismiss={() => act(() => api.dismissSuggestion(list.id, s.title))}
            />
          ))}
        </ul>
        {ideas && ideas.styleIdeas.length > 0 && (
          <div className="style-ideas">
            <h4>{t("Things to do for your travel style")}</h4>
            <p className="muted small">
              {t("Matched to your trip's styles:")}{" "}
              {ideas.styles.map((st) => <span key={st} className="style-chip">{STYLE_LABELS[st]}</span>)}
              <span className="tiny">{" "}{t("(change them in Edit trip)")}</span>
            </p>
            <ul className="idea-grid">
              {ideas.styleIdeas.map((s) => (
                <IdeaCard
                  key={s.title}
                  idea={s}
                  labels={labels}
                  onAdd={() => act(() => api.addEntry(list.id, { title: s.title, kind: "activity", notes: s.detail, links: s.links }))}
                  onDismiss={() => act(() => api.dismissSuggestion(list.id, s.title))}
                />
              ))}
            </ul>
          </div>
        )}
        {ideas && ideas.finders.length > 0 && (
          <div className="finders">
            <span className="muted small">{t("Find more:")}</span>
            {ideas.finders.map((l) => (
              <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
            ))}
          </div>
        )}
        {ideas && !ideas.ai && (
          <p className="muted tiny">
            {t("Ideas from Estela's built-in guide: local dishes, drinks and well-known sights. With Claude connected, Estela also names specific restaurants and spots.")}
          </p>
        )}
        </Fold>
      </section>
    </div>
  );
}

export function EntryRow({
  entry,
  days,
  onDay,
  onDelete,
  onAddToItinerary,
  onPrice,
  coveredBy,
}: {
  coveredBy?: string; // the booking or tour that already includes this
  entry: ListEntry;
  days: string[];
  onDay: (day: string | null) => void;
  onDelete: () => void;
  onAddToItinerary: () => void;
  onPrice?: (level: PriceLevel | null) => void; // restaurants: rate $ to $$$
}) {
  return (
    <li className="entry">
      <div className="entry-body">
        <div className="entry-title">
          <b>{entry.title}</b>
          {onPrice && <PriceTag level={entry.price} />}
          {entry.area && <span className="muted tiny"> · {entry.area}</span>}
        </div>
        {coveredBy && <div className="small covered-by">{t("✓ Covered by {coveredBy}", { coveredBy })}</div>}
        {entry.notes && <div className="small muted entry-notes">{entry.notes}</div>}
        <div className="entry-actions edit-only">
          <select
            className={`day-select ${entry.day ? "set" : ""}`}
            value={entry.day ?? ""}
            onChange={(e) => onDay(e.target.value || null)}
            aria-label={t("Day for {title}", { title: entry.title })}
          >
            <option value="">{t("Plan a day…")}</option>
            {days.map((d) => <option key={d} value={d}>{formatDay(d)}</option>)}
          </select>
          <button type="button" className="link" onClick={onAddToItinerary}>{t("+ Itinerary")}</button>
          {onPrice && <PricePicker value={entry.price} onChange={onPrice} />}
          {entry.links?.map((l) => (
            <a key={l.url} className="small" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
          ))}
          {entry.lat !== undefined && !entry.links?.some((l) => l.label === "Map") && (
            <a className="small" href={`https://www.google.com/maps/search/?api=1&query=${entry.lat},${entry.lon}`} target="_blank" rel="noopener noreferrer">
              {t("Map ↗")}
            </a>
          )}
          {entry.link && (
            <a className="small" href={entry.link} target="_blank" rel="noopener noreferrer">{t("Link ↗")}</a>
          )}
          <button type="button" className="link danger" onClick={onDelete} aria-label={t("Remove {title}", { title: entry.title })}>{t("Remove")}</button>
        </div>
      </div>
    </li>
  );
}

export type AddOption = { key: string; kind: ListEntry["kind"]; section?: ListEntry["section"]; label: string; placeholder?: string };

export function AddEntry({
  list,
  tripId,
  options,
  onAdd,
}: {
  list: TripList;
  tripId: string;
  options: AddOption[];
  onAdd: (body: EntryInput) => Promise<void>;
}) {
  const [optionKey, setOptionKey] = useState(options[0].key);
  const option = options.find((o) => o.key === optionKey) ?? options[0];
  const kind = option.kind;
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Pick<ListEntry, "address" | "area" | "lat" | "lon">>({});
  const [busy, setBusy] = useState(false);
  const near = list.place?.lat !== undefined && list.place.lon !== undefined ? { lat: list.place.lat, lon: list.place.lon } : undefined;

  // Food and things to do: look up a description as you type. It's yours to change, and once you've edited the notes
  // (or cleared them) they're left alone.
  const describes = kind !== "place";
  const [notesEdited, setNotesEdited] = useState(false);
  const [lookup, setLookup] = useState<{ state: "idle" | "looking" | "none" } | { state: "found"; source: "guide" | "wikipedia"; url?: string }>({ state: "idle" });
  const autoNotes = useRef("");
  useEffect(() => {
    const name = title.trim();
    // The old description was for the old name. Only ever clear what was filled in automatically.
    const stale = autoNotes.current;
    autoNotes.current = "";
    if (stale) setNotes((current) => (current === stale ? "" : current));
    if (!describes || notesEdited || name.length < 3) {
      setLookup({ state: "idle" });
      return;
    }
    setLookup({ state: "looking" });
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .describeEntry(list.id, name, kind)
        .catch(() => ({}) as Awaited<ReturnType<typeof api.describeEntry>>)
        .then((d) => {
          if (cancelled) return;
          autoNotes.current = d.text ?? "";
          if (d.text) setNotes(d.text);
          setLookup(d.text && d.source ? { state: "found", source: d.source, url: d.url } : { state: "none" });
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title, describes, notesEdited, list.id, kind]);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      // Unless you've written your own, the server adds the description as it saves (so it always matches the name).
      const auto = describes && !notesEdited;
      await onAdd({ title: title.trim(), kind, section: option.section, notes: auto ? undefined : notes.trim() || undefined, ...(describes && notesEdited && !notes.trim() ? { autoDescribe: false } : {}), ...(kind === "place" ? picked : {}), });
      setTitle("");
      setNotes("");
      setNotesEdited(false);
      setPicked({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card add-entry edit-only"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="kind-switch" role="radiogroup" aria-label={t("What are you adding?")}>
        {options.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={o.key === option.key} className={o.key === option.key ? "on" : ""} onClick={() => setOptionKey(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="grid2">
        {kind === "place" ? (
          <LodgingField
            label={t("Name")}
            value={title}
            required
            placeholder={t("Its name — Find shows where it is")}
            search={(q) => api.searchPlaces(q, near, near ? undefined : tripId)}
            onChange={(v) => {
              setTitle(v);
              setPicked({});
            }}
            onPick={(r) => {
              setTitle(r.name ?? title);
              setPicked({ address: r.address, area: r.area, lat: r.lat, lon: r.lon });
            }}
          />
        ) : (
          <label>
            {t("Name")}
            <input required value={title} placeholder={option.placeholder} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        <label>
          {t("Notes")}
          {describes ? (
            <textarea
              rows={3}
              value={notes}
              placeholder={t("A description appears here as you type the name. Add your own notes too.")}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesEdited(true);
                setLookup({ state: "idle" });
              }}
            />
          ) : (
            <input value={notes} placeholder={t("Why, who recommended it, what to order…")} onChange={(e) => setNotes(e.target.value)} />
          )}
          {describes && lookup.state === "looking" && <span className="muted tiny">{t("Looking that up…")}</span>}
          {describes && lookup.state === "none" && <span className="muted tiny">{t("No description found. You can write your own.")}</span>}
          {describes && lookup.state === "found" && (
            <span className="muted tiny">
              {lookup.source === "guide" ? t("From Estela's guide") : <>{t("From")}{" "}<a href={lookup.url} target="_blank" rel="noopener noreferrer">{t("Wikipedia")}</a></>}{t(", so check it fits. You can edit it.")}
            </span>
          )}
        </label>
      </div>
      {kind === "place" && picked.address && <p className="muted tiny">{picked.address}</p>}
      <div className="actions">
        <button type="submit" disabled={busy || !title.trim()}>{busy ? t("Adding…") : t("Save")}</button>
      </div>
    </form>
  );
}

export function AreaCard({ group, listId, days, onPlan }: { group: AreaGroup; listId: string; days: string[]; onPlan: (day: string) => void }) {
  return (
    <div className="area">
      <div className="area-head">
        <b>{group.area}</b>
        {group.city && <span className="muted small"> · {group.city}</span>}
        <span className="muted small">{" "}{tn(group.entries.length, "· {n} place", "· {n} places")}</span>
        {group.routeUrl && (
          <a className="small" href={group.routeUrl} target="_blank" rel="noopener noreferrer">{t("Route ↗")}</a>
        )}
      </div>
      <ol className="area-stops">
        {group.entries.map((e) => (
          <li key={e.id} className={e.listId === listId ? "" : "other-list"} title={e.listId === listId ? undefined : t("From {listName}", { listName: e.listName })}>
            {e.title}
          </li>
        ))}
      </ol>
      <div className="area-days edit-only">
        <span className="muted small">{group.suggestedDays.length ? t("Good days:") : t("Your days look full. Pick one:")}</span>
        {group.suggestedDays.map((d) => (
          <button key={d} type="button" className="day-chip" onClick={() => onPlan(d)}>{formatDay(d)}</button>
        ))}
        <select className="day-select" value="" onChange={(e) => e.target.value && onPlan(e.target.value)} aria-label={t("Another day for {area}", { area: group.area })}>
          <option value="">{t("Other day…")}</option>
          {days.map((d) => <option key={d} value={d}>{formatDay(d)}</option>)}
        </select>
      </div>
    </div>
  );
}

export function IdeaCard({
  idea,
  labels,
  onAdd,
  onDismiss,
}: {
  idea: ListSuggestion;
  labels: (typeof THEME_LABELS)[keyof typeof THEME_LABELS];
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="idea">
      <div className="idea-top">
        <span className="idea-kind muted tiny">
          {idea.style ? STYLE_LABELS[idea.style] : idea.kind === "place" ? labels.placeOne : idea.kind === "activity" ? t("Thing to do") : labels.thingOne}
        </span>
        {idea.tag && <span className="idea-tag">{idea.tag}</span>}
      </div>
      <b>{idea.title} <PriceTag level={idea.price} /></b>
      {idea.city && <span className="muted tiny"> · {idea.city}</span>}
      {idea.detail && <p className="small">{idea.detail}</p>}
      <div className="idea-actions">
        <button
          type="button"
          className="secondary small-btn edit-only"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onAdd();
          }}
        >
          {busy ? t("Adding…") : t("+ Add")}
        </button>
        {idea.links?.map((l) => (
          <a key={l.url} className="small" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
        ))}
        <button type="button" className="link muted-link edit-only" onClick={onDismiss} aria-label={t("Not interested in {title}", { title: idea.title })}>{t("Not for me")}</button>
      </div>
    </li>
  );
}
