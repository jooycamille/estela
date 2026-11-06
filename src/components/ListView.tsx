import { useCallback, useEffect, useState , useRef } from "react";
import { activitiesMerged, listTheme, STYLE_LABELS, THEME_LABELS } from "../../shared/lists.ts";
import type { AreaGroup, ListEntry, ListSuggestion, PriceLevel, Trip, TripList } from "../../shared/types.ts";
import { api, type EntryInput, type ListSuggestions } from "../api.ts";
import { formatDay } from "../format.ts";
import LodgingField from "./LodgingField.tsx";
import { PricePicker, PriceTag } from "./Price.tsx";
import { flag } from "./PlaceSelect.tsx";

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
    ...(activities.length ? [["activity", activities, "Things to do"] as ["activity", ListEntry[], string]] : []),
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
          <h2><span aria-hidden="true">{list.emoji}</span> {list.name}</h2>
          <p className="muted small">
            {list.place ? <>{flag(list.place.countryCode)} {list.place.name} · </> : "Anywhere on this trip · "}
            {list.entries.length ? `${list.entries.length} saved` : "Nothing on it yet"}
          </p>
        </div>
        <div className="list-head-actions edit-only">
          <button className="link" onClick={onEdit}>Edit</button>
          <button
            className="link danger"
            onClick={() => {
              if (confirm(`Delete “${list.name}” and everything on it?`)) act(() => api.deleteList(list.id)).then(onDeleted);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="list-columns">
        {columns.map(([kind, entries, heading]) => (
          <section key={kind} className="card list-col">
            <h3>{heading} <span className="muted small">{entries.length || ""}</span></h3>
            {entries.length === 0 && <p className="muted small">None yet. Add your own below, or pick from Joy's ideas.</p>}
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
          </section>
        ))}
      </div>

      <AddEntry
        list={list}
        tripId={trip.id}
        options={[
          { key: "place", kind: "place", label: `📍 ${labels.placeOne}`, priced: theme === "food" || theme === "drinks" },
          { key: "thing", kind: "thing", label: `✨ ${labels.thingOne}`, placeholder: labels.thingOne === "Food to try" ? "e.g. Tacos al pastor" : "e.g. Lucha libre night" },
          ...(merged ? [] : [{ key: "activity", kind: "activity" as const, label: "🎯 Thing to do", placeholder: "e.g. Salsa class" }]),
        ]}
        onAdd={(body) => act(() => api.addEntry(list.id, body))}
      />

      {(myAreas.length > 0 || unlocated.length > 0) && (
        <section className="card areas">
          <h3>🗺️ Plan by area</h3>
          <p className="muted small">
            Places close together, including ones from your other lists, so one day covers them. Pick a day and they'll show
            up in your itinerary in walking order.
          </p>
          {myAreas.map((g) => (
            <AreaCard key={g.entries.map((e) => e.id).join()} group={g} listId={list.id} days={days} onPlan={(day) =>
              act(() => api.planDay(trip.id, day, g.entries.map((e) => ({ listId: e.listId, entryId: e.id }))))
            } />
          ))}
          {unlocated.length > 0 && (
            <p className="muted tiny">
              Not found on the map yet, so not grouped: {unlocated.map((e) => e.title).join(", ")}. Edit the name, or plan them with
              the 📅 menu.
            </p>
          )}
        </section>
      )}

      <section className="card list-ideas">
        <h3>✨ Joy's ideas for {list.name}</h3>
        {!ideas && <p className="muted small">Thinking…</p>}
        {(ideas?.bookedIdeas?.length ?? 0) > 0 && (
          <p className="muted small booked-ideas">✓ Left out because they're booked, planned or part of a tour: {ideas!.bookedIdeas!.join(" · ")}</p>
        )}
        {ideas && ideas.suggestions.length === 0 && (
          <p className="muted small">No more ideas right now. Try the searches below.</p>
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
            <h4>🎯 Things to do for your travel style</h4>
            <p className="muted small">
              Matched to your trip's styles:{" "}
              {ideas.styles.map((st) => <span key={st} className="style-chip">{STYLE_LABELS[st]}</span>)}
              <span className="tiny"> (change them in Edit trip)</span>
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
            <span className="muted small">Find more:</span>
            {ideas.finders.map((l) => (
              <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
            ))}
          </div>
        )}
        {ideas && !ideas.ai && (
          <p className="muted tiny">
            Ideas from Joy's built-in guide: local dishes, drinks and well-known sights. With Claude connected, Joy also names
            specific restaurants and spots.
          </p>
        )}
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
        {coveredBy && <div className="small covered-by">✓ Covered by {coveredBy}</div>}
        {entry.notes && <div className="small muted entry-notes">{entry.notes}</div>}
        <div className="entry-actions edit-only">
          <select
            className={`day-select ${entry.day ? "set" : ""}`}
            value={entry.day ?? ""}
            onChange={(e) => onDay(e.target.value || null)}
            aria-label={`Day for ${entry.title}`}
          >
            <option value="">📅 Plan a day…</option>
            {days.map((d) => <option key={d} value={d}>📅 {formatDay(d)}</option>)}
          </select>
          <button type="button" className="link" onClick={onAddToItinerary}>+ Itinerary</button>
          {onPrice && <PricePicker value={entry.price} onChange={onPrice} />}
          {entry.links?.map((l) => (
            <a key={l.url} className="small" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
          ))}
          {entry.lat !== undefined && !entry.links?.some((l) => l.label === "Map") && (
            <a className="small" href={`https://www.google.com/maps/search/?api=1&query=${entry.lat},${entry.lon}`} target="_blank" rel="noopener noreferrer">
              Map ↗
            </a>
          )}
          {entry.link && (
            <a className="small" href={entry.link} target="_blank" rel="noopener noreferrer">Link ↗</a>
          )}
          <button type="button" className="link danger" onClick={onDelete} aria-label={`Remove ${entry.title}`}>Remove</button>
        </div>
      </div>
    </li>
  );
}

export type AddOption = { key: string; kind: ListEntry["kind"]; section?: ListEntry["section"]; label: string; placeholder?: string; priced?: boolean };

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
  const [price, setPrice] = useState<PriceLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const near = list.place?.lat !== undefined && list.place.lon !== undefined ? { lat: list.place.lat, lon: list.place.lon } : undefined;

  // Food and things to do: look up a description as you type. It's yours to change, and once you've edited the notes
  // (or cleared them) they're left alone.
  const describes = kind !== "place";
  const [notesEdited, setNotesEdited] = useState(false);
  const [lookup, setLookup] = useState<{ state: "idle" | "looking" | "none" } | { state: "found"; source: "guide" | "wikipedia"; url?: string }>({ state: "idle" });
  // The lookup for the name as it is now: a save waits for this, so it can't pick up the last name's description.
  type Found = Awaited<ReturnType<typeof api.describeEntry>>;
  const autoNotes = useRef("");
  const pending = useRef<Promise<Found | undefined>>(Promise.resolve(undefined));
  useEffect(() => {
    const name = title.trim();
    // The old description was for the old name. Only ever clear what was filled in automatically.
    const stale = autoNotes.current;
    autoNotes.current = "";
    if (stale) setNotes((current) => (current === stale ? "" : current));
    if (!describes || notesEdited || name.length < 3) {
      pending.current = Promise.resolve(undefined);
      setLookup({ state: "idle" });
      return;
    }
    setLookup({ state: "looking" });
    let cancelled = false;
    let finish: (found: Found | undefined) => void = () => undefined;
    pending.current = new Promise((resolve) => (finish = resolve));
    const timer = setTimeout(() => {
      api
        .describeEntry(list.id, name)
        .catch(() => ({}) as Found)
        .then((d) => {
          finish(d);
          if (cancelled) return;
          autoNotes.current = d.text ?? "";
          if (d.text) setNotes(d.text);
          setLookup(d.text && d.source ? { state: "found", source: d.source, url: d.url } : { state: "none" });
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      finish(undefined);
    };
  }, [title, describes, notesEdited, list.id]);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const found = describes && !notesEdited ? await pending.current : undefined;
      const text = describes && !notesEdited ? found?.text ?? "" : notes;
      const source = found?.source === "wikipedia" ? found.url : undefined;
      await onAdd({ title: title.trim(), kind, section: option.section, notes: text.trim() || undefined, ...(source ? { links: [{ label: "Wikipedia", url: source }] } : {}), ...(kind === "place" ? picked : {}), ...(option.priced && price ? { price } : {}) });
      setPrice(null);
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
      <div className="kind-switch" role="radiogroup" aria-label="What are you adding?">
        {options.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={o.key === option.key} className={o.key === option.key ? "on" : ""} onClick={() => setOptionKey(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="grid2">
        {kind === "place" ? (
          <LodgingField
            label="Name"
            value={title}
            required
            placeholder="Its name — Find shows where it is"
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
            Name
            <input required value={title} placeholder={option.placeholder} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        <label>
          Notes
          {describes ? (
            <textarea
              rows={3}
              value={notes}
              placeholder="A description appears here as you type the name. Add your own notes too."
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesEdited(true);
                setLookup({ state: "idle" });
              }}
            />
          ) : (
            <input value={notes} placeholder="Why, who recommended it, what to order…" onChange={(e) => setNotes(e.target.value)} />
          )}
          {describes && lookup.state === "looking" && <span className="muted tiny">Looking that up…</span>}
          {describes && lookup.state === "none" && <span className="muted tiny">No description found. You can write your own.</span>}
          {describes && lookup.state === "found" && (
            <span className="muted tiny">
              {lookup.source === "guide" ? "From Joy's guide" : <>From <a href={lookup.url} target="_blank" rel="noopener noreferrer">Wikipedia</a></>}, so check it fits. You can edit it.
            </span>
          )}
        </label>
      </div>
      {kind === "place" && picked.address && <p className="muted tiny">📍 {picked.address}</p>}
      {option.priced && (
        <p className="small price-row">
          <span className="muted">Price:</span> <PricePicker value={price ?? undefined} onChange={setPrice} />
          <span className="muted tiny">$ cheap eats · $$ mid-range · $$$ splurge</span>
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Save"}</button>
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
        <span className="muted small"> · {group.entries.length} place{group.entries.length === 1 ? "" : "s"}</span>
        {group.routeUrl && (
          <a className="small" href={group.routeUrl} target="_blank" rel="noopener noreferrer">Route ↗</a>
        )}
      </div>
      <ol className="area-stops">
        {group.entries.map((e) => (
          <li key={e.id} className={e.listId === listId ? "" : "other-list"} title={e.listId === listId ? undefined : `From ${e.listName}`}>
            <span aria-hidden="true">{e.listEmoji}</span> {e.title}
          </li>
        ))}
      </ol>
      <div className="area-days edit-only">
        <span className="muted small">Good days:</span>
        {group.suggestedDays.map((d) => (
          <button key={d} type="button" className="day-chip" onClick={() => onPlan(d)}>{formatDay(d)}</button>
        ))}
        <select className="day-select" value="" onChange={(e) => e.target.value && onPlan(e.target.value)} aria-label={`Another day for ${group.area}`}>
          <option value="">Other day…</option>
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
          {idea.style ? STYLE_LABELS[idea.style] : idea.kind === "place" ? `📍 ${labels.placeOne}` : idea.kind === "activity" ? "🎯 Thing to do" : `✨ ${labels.thingOne}`}
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
          {busy ? "Adding…" : "+ Add"}
        </button>
        {idea.links?.map((l) => (
          <a key={l.url} className="small" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
        ))}
        <button type="button" className="link muted-link edit-only" onClick={onDismiss} aria-label={`Not interested in ${idea.title}`}>Not for me</button>
      </div>
    </li>
  );
}
