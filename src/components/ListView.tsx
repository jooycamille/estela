import { useCallback, useEffect, useState } from "react";
import { listTheme, THEME_LABELS } from "../../shared/lists.ts";
import type { AreaGroup, ListEntry, ListSuggestion, Trip, TripList } from "../../shared/types.ts";
import { api, type ListSuggestions } from "../api.ts";
import { formatDay } from "../format.ts";
import LodgingField from "./LodgingField.tsx";
import { flag } from "./PlaceSelect.tsx";

const tripDays = (trip: Trip) => {
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
  const days = tripDays(trip);
  const [ideas, setIdeas] = useState<ListSuggestions>();
  const [areas, setAreas] = useState<AreaGroup[]>([]);
  const [error, setError] = useState<string>();

  const refreshExtras = useCallback(() => {
    api.listSuggestions(list.id).then(setIdeas).catch(() => setIdeas(undefined));
    api.areas(trip.id).then(setAreas).catch(() => setAreas([]));
  }, [list.id, trip.id]);
  // Ideas and areas change with what's on the list.
  const signature = list.entries.map((e) => `${e.id}${e.done}${e.day}${e.lat}`).join("|") + (list.dismissed ?? []).length + list.name + list.place?.name;
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
  const things = list.entries.filter((e) => e.kind === "thing");
  const done = list.entries.filter((e) => e.done).length;
  // Areas that include something from this list (other lists' places nearby are shown too).
  const myAreas = areas.filter((g) => g.entries.some((e) => e.listId === list.id));
  const unlocated = places.filter((e) => e.lat === undefined && !e.done);

  return (
    <div className="list-view">
      <div className="card list-head">
        <div>
          <h2><span aria-hidden="true">{list.emoji}</span> {list.name}</h2>
          <p className="muted small">
            {list.place ? <>{flag(list.place.countryCode)} {list.place.name} · </> : "Anywhere on this trip · "}
            {list.entries.length ? `${done} of ${list.entries.length} ${labels.done}` : "Nothing on it yet"}
          </p>
        </div>
        <div className="list-head-actions">
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
        {([["place", places, labels.place], ["thing", things, labels.thing]] as const).map(([kind, entries, heading]) => (
          <section key={kind} className="card list-col">
            <h3>{heading} <span className="muted small">{entries.length || ""}</span></h3>
            {entries.length === 0 && <p className="muted small">None yet. Add your own below, or pick from Joy's ideas.</p>}
            <ul className="entries">
              {entries.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  days={days}
                  doneLabel={labels.done}
                  onToggle={(on) => act(() => api.updateEntry(list.id, e.id, { done: on }))}
                  onDay={(day) => act(() => api.updateEntry(list.id, e.id, { day }))}
                  onDelete={() => act(() => api.deleteEntry(list.id, e.id))}
                  onAddToItinerary={() => onAddToItinerary(e)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <AddEntry list={list} tripId={trip.id} labels={labels} onAdd={(body) => act(() => api.addEntry(list.id, body))} />

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
        {ideas && ideas.suggestions.length === 0 && (
          <p className="muted small">No more ideas right now. Try the searches below.</p>
        )}
        <ul className="idea-grid">
          {ideas?.suggestions.map((s) => (
            <IdeaCard
              key={s.title}
              idea={s}
              labels={labels}
              onAdd={() => act(() => api.addEntry(list.id, { title: s.title, kind: s.kind, notes: s.detail }))}
              onDismiss={() => act(() => api.dismissSuggestion(list.id, s.title))}
            />
          ))}
        </ul>
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

function EntryRow({
  entry,
  days,
  doneLabel,
  onToggle,
  onDay,
  onDelete,
  onAddToItinerary,
}: {
  entry: ListEntry;
  days: string[];
  doneLabel: string;
  onToggle: (on: boolean) => void;
  onDay: (day: string | null) => void;
  onDelete: () => void;
  onAddToItinerary: () => void;
}) {
  return (
    <li className={`entry ${entry.done ? "done" : ""}`}>
      <input type="checkbox" checked={entry.done} onChange={(e) => onToggle(e.target.checked)} aria-label={`Mark ${entry.title} as ${doneLabel}`} />
      <div className="entry-body">
        <div className="entry-title">
          <b>{entry.title}</b>
          {entry.area && <span className="muted tiny"> · {entry.area}</span>}
        </div>
        {entry.notes && <div className="small muted entry-notes">{entry.notes}</div>}
        <div className="entry-actions">
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
          {(entry.link || entry.lat !== undefined) && (
            <a
              className="small"
              href={entry.link ?? `https://www.google.com/maps/search/?api=1&query=${entry.lat},${entry.lon}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.link ? "Link ↗" : "Map ↗"}
            </a>
          )}
          <button type="button" className="link danger" onClick={onDelete} aria-label={`Remove ${entry.title}`}>Remove</button>
        </div>
      </div>
    </li>
  );
}

function AddEntry({
  list,
  tripId,
  labels,
  onAdd,
}: {
  list: TripList;
  tripId: string;
  labels: (typeof THEME_LABELS)[keyof typeof THEME_LABELS];
  onAdd: (body: Partial<ListEntry>) => Promise<void>;
}) {
  const [kind, setKind] = useState<"place" | "thing">("place");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Pick<ListEntry, "address" | "area" | "lat" | "lon">>({});
  const [busy, setBusy] = useState(false);
  const near = list.place?.lat !== undefined && list.place.lon !== undefined ? { lat: list.place.lat, lon: list.place.lon } : undefined;

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onAdd({ title: title.trim(), kind, notes: notes.trim() || undefined, ...(kind === "place" ? picked : {}) });
      setTitle("");
      setNotes("");
      setPicked({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card add-entry"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="kind-switch" role="radiogroup" aria-label="What are you adding?">
        {(["place", "thing"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {k === "place" ? `📍 ${labels.placeOne}` : `✨ ${labels.thingOne}`}
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
            <input required value={title} placeholder={labels.thingOne === "Food to try" ? "e.g. Tacos al pastor" : "e.g. Lucha libre night"} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        <label>
          Notes
          <input value={notes} placeholder="Why, who recommended it, what to order…" onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {kind === "place" && picked.address && <p className="muted tiny">📍 {picked.address}</p>}
      <div className="actions">
        <button type="submit" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Add to list"}</button>
      </div>
    </form>
  );
}

function AreaCard({ group, listId, days, onPlan }: { group: AreaGroup; listId: string; days: string[]; onPlan: (day: string) => void }) {
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
      <div className="area-days">
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

function IdeaCard({
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
        <span className="idea-kind muted tiny">{idea.kind === "place" ? `📍 ${labels.placeOne}` : `✨ ${labels.thingOne}`}</span>
        {idea.tag && <span className="idea-tag">{idea.tag}</span>}
      </div>
      <b>{idea.title}</b>
      {idea.city && <span className="muted tiny"> · {idea.city}</span>}
      {idea.detail && <p className="small">{idea.detail}</p>}
      <div className="idea-actions">
        <button
          type="button"
          className="secondary small-btn"
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
        <button type="button" className="link muted-link" onClick={onDismiss} aria-label={`Not interested in ${idea.title}`}>Not for me</button>
      </div>
    </li>
  );
}
