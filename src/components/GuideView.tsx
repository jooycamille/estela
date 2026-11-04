import { useCallback, useEffect, useState } from "react";
import { STYLE_LABELS } from "../../shared/lists.ts";
import type { AreaGroup, EssentialKind, Essentials, ListEntry, ListSuggestion, PriceLevel, Trip, TripList } from "../../shared/types.ts";
import { api, type ListSuggestions } from "../api.ts";
import { AddEntry, AreaCard, EntryRow, IdeaCard, tripDays, type AddOption } from "./ListView.tsx";
import { PRICE_LABEL } from "./Price.tsx";

// A destination guide Joy makes for each city you stay in: what to eat, do and see (matched to your travel styles),
// your saved picks, and the pharmacies, clinics, police and ATMs near where you're staying.

type SectionKey = "restaurants" | "food" | "activities" | "sights";
const SECTIONS: { key: SectionKey; icon: string; title: string; one: string; add: Pick<ListEntry, "kind" | "section"> }[] = [
  { key: "restaurants", icon: "🍽️", title: "Restaurants", one: "Restaurant", add: { kind: "place", section: "eat" } },
  { key: "food", icon: "🌮", title: "Food to try", one: "Food to try", add: { kind: "thing" } },
  { key: "activities", icon: "🎯", title: "Things to do for your style", one: "Thing to do", add: { kind: "activity" } },
  { key: "sights", icon: "📍", title: "Must-visit places", one: "Place to visit", add: { kind: "place", section: "see" } },
];
const sectionOf = (e: ListEntry): SectionKey =>
  e.kind === "thing" ? "food" : e.kind === "activity" ? "activities" : e.section === "eat" ? "restaurants" : "sights";

const ESSENTIALS: { kind: EssentialKind; icon: string; title: string }[] = [
  { kind: "pharmacy", icon: "💊", title: "Pharmacies" },
  { kind: "hospital", icon: "🏥", title: "Hospitals" },
  { kind: "clinic", icon: "🩺", title: "Clinics" },
  { kind: "police", icon: "👮", title: "Police" },
  { kind: "atm", icon: "🏧", title: "ATMs & banks" },
];

export default function GuideView({
  trip,
  list,
  onChanged,
  onAddToItinerary,
}: {
  trip: Trip;
  list: TripList;
  onChanged: () => void;
  onAddToItinerary: (entry: ListEntry) => void;
}) {
  const days = tripDays(trip);
  const [ideas, setIdeas] = useState<ListSuggestions>();
  const [areas, setAreas] = useState<AreaGroup[]>([]);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [adding, setAdding] = useState(false);
  const [priceFilter, setPriceFilter] = useState<PriceLevel | "any">("any");

  const signature = list.entries.map((e) => `${e.id}${e.done}${e.day}${e.lat}`).join("|") + (list.dismissed ?? []).length;
  const refresh = useCallback(() => {
    api.listSuggestions(list.id).then(setIdeas).catch(() => setIdeas(undefined));
    api.areas(trip.id).then(setAreas).catch(() => setAreas([]));
  }, [list.id, trip.id]);
  useEffect(refresh, [refresh, signature]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = (s: ListSuggestion, section: (typeof SECTIONS)[number]) =>
    act(() => api.addEntry(list.id, { title: s.title, ...section.add, notes: s.detail, links: s.links, price: s.price }));

  // Picks you've since booked are on the itinerary, so they're out of the way here (still saved).
  const booked = new Set(ideas?.bookedPicks?.map((p) => p.id));
  const picks = SECTIONS.map((s) => ({ ...s, entries: list.entries.filter((e) => sectionOf(e) === s.key && !booked.has(e.id)) })).filter((s) => s.entries.length);
  const myAreas = areas
    .map((g) => ({ ...g, entries: g.entries.filter((e) => !booked.has(e.id)) }))
    .filter((g) => g.entries.some((e) => e.listId === list.id));
  const options: AddOption[] = SECTIONS.map((s) => ({
    key: s.key,
    ...s.add,
    label: `${s.icon} ${s.one}`,
    placeholder: s.key === "food" ? "e.g. Tacos al pastor" : s.key === "activities" ? "e.g. Salsa class" : undefined,
    priced: s.key === "restaurants",
  }));

  return (
    <div className="list-view guide">
      <div className="card list-head guide-head">
        <div>
          <h2><span aria-hidden="true">{list.emoji}</span> {list.name}</h2>
          <p className="muted small">
            Joy's guide, made for this stop on your trip
            {trip.styles.length > 0 && <> · for your style: {trip.styles.map((st) => <span key={st} className="style-chip">{STYLE_LABELS[st]}</span>)}</>}
          </p>
          <nav className="guide-nav" aria-label="Guide sections">
            {/* Buttons, not #links: the app's routing lives in the URL hash, so changing it would leave the trip. */}
            {[{ key: "essentials", label: "🆘 Essentials nearby" }, ...SECTIONS.map((s) => ({ key: s.key, label: `${s.icon} ${s.title.replace(" for your style", "")}` }))].map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => document.getElementById(`${list.id}-${n.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {n.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Safety first: emergency number, pharmacies, hospitals, police and ATMs near where you're staying. */}
      <EssentialsCard list={list} />

      {myAreas.length > 0 && (
        <section className="card areas">
          <h3>🗺️ Plan by area</h3>
          <p className="muted small">Your picks that are close together, so one day covers them. Pick a day and they'll show up in your itinerary in walking order.</p>
          {myAreas.map((g) => (
            <AreaCard key={g.entries.map((e) => e.id).join()} group={g} listId={list.id} days={days} onPlan={(day) =>
              act(() => api.planDay(trip.id, day, g.entries.map((e) => ({ listId: e.listId, entryId: e.id }))))
            } />
          ))}
        </section>
      )}

      <section className="card">
        <h3>⭐ Your picks</h3>
        {picks.length === 0 && <p className="muted small">Tap <b>+ Add</b> on anything below to save it here, then tick it off as you go.</p>}
        <button type="button" className="link add-own edit-only" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {adding ? "Close" : "+ Add your own"}
        </button>
        <div className="list-columns">
          {picks.map((s) => (
            <div key={s.key} className="list-col">
              <h4>{s.icon} {s.title.replace(" for your style", "")} <span className="muted small">{s.entries.length}</span></h4>
              <ul className="entries">
                {s.entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    days={days}
                    doneLabel="done"
                    onToggle={(on) => act(() => api.updateEntry(list.id, e.id, { done: on }))}
                    onDay={(day) => act(() => api.updateEntry(list.id, e.id, { day }))}
                    onDelete={() => act(() => api.deleteEntry(list.id, e.id))}
                    onAddToItinerary={() => onAddToItinerary(e)}
                    onPrice={s.key === "restaurants" ? (price) => act(() => api.updateEntry(list.id, e.id, { price })) : undefined}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
        {(ideas?.bookedPicks?.length ?? 0) > 0 && (
          <p className="muted small booked-picks">
            🎟️ Booked or part of a tour, so moved off this list:{" "}
            {ideas!.bookedPicks!.map((p) => (p.inTour ? `${p.title} (in ${p.bookedAs})` : p.title)).join(" · ")}
          </p>
        )}
      </section>

      {adding && <AddEntry list={list} tripId={trip.id} options={options} onAdd={(body) => act(() => api.addEntry(list.id, body))} />}

      {!ideas && <p className="muted">Joy is putting your guide together…</p>}
      {(ideas?.bookedIdeas?.length ?? 0) > 0 && (
        <p className="muted small booked-ideas">✓ Left out because they're booked, planned or part of a tour: {ideas!.bookedIdeas!.join(" · ")}</p>
      )}
      {ideas?.guide &&
        SECTIONS.map((s) => {
          // Restaurants can be narrowed by price ($ to $$$).
          const all = ideas.guide![s.key].filter((i) => s.key !== "restaurants" || priceFilter === "any" || i.price === priceFilter);
          const shown = expanded[s.key] ? all : all.slice(0, 6);
          return (
            <section key={s.key} id={`${list.id}-${s.key}`} className="card list-ideas guide-section">
              <h3>{s.icon} {s.title}</h3>
              {s.key === "restaurants" && (
                <>
                  <div className="price-filter" role="radiogroup" aria-label="Price">
                    {(["any", 1, 2, 3] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={priceFilter === p}
                        className={priceFilter === p ? "on" : ""}
                        title={p === "any" ? "All prices" : PRICE_LABEL[p]}
                        onClick={() => setPriceFilter(p)}
                      >
                        {p === "any" ? "Any price" : "$".repeat(p)}
                      </button>
                    ))}
                  </div>
                  <p className="muted tiny">Long-running local favourites. $ cheap eats · $$ mid-range · $$$ splurge (for this city). Opening hours change, so check before you go.</p>
                </>
              )}
              {all.length === 0 ? (
                <p className="muted small">Nothing more to suggest here. Try the searches at the bottom.</p>
              ) : (
                <ul className="idea-grid">
                  {shown.map((idea) => (
                    <IdeaCard
                      key={idea.title}
                      idea={s.key === "activities" ? idea : { ...idea, style: undefined }}
                      labels={{ place: s.title, thing: s.title, placeOne: s.one, thingOne: s.one, done: "done" }}
                      onAdd={() => add(idea, s)}
                      onDismiss={() => act(() => api.dismissSuggestion(list.id, idea.title))}
                    />
                  ))}
                </ul>
              )}
              {all.length > 6 && (
                <button type="button" className="link more" onClick={() => setExpanded((x) => ({ ...x, [s.key]: !x[s.key] }))}>
                  {expanded[s.key] ? "Show fewer" : `Show ${all.length - 6} more`}
                </button>
              )}
            </section>
          );
        })}
      {ideas && ideas.finders.length > 0 && (
        <div className="finders">
          <span className="muted small">Find more:</span>
          {ideas.finders.map((l) => (
            <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
          ))}
        </div>
      )}

    </div>
  );
}

function EssentialsCard({ list }: { list: TripList }) {
  const [data, setData] = useState<Essentials>();
  const [error, setError] = useState(false);
  useEffect(() => {
    setData(undefined);
    api.essentials(list.id).then(setData).catch(() => setError(true));
  }, [list.id]);

  const directions = (from: string | undefined, to: { lat: number; lon: number }) =>
    `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from}` : ""}&destination=${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;

  return (
    <section id={`${list.id}-essentials`} className="card essentials">
      <h3>🆘 Essentials near where you're staying</h3>
      {data?.emergency && (
        <p className="emergency">
          Emergency number in {list.name}: <a href={`tel:${data.emergency.number}`}><b>{data.emergency.number}</b></a>
          {data.emergency.note && <span className="muted small"> · {data.emergency.note}</span>}
        </p>
      )}
      {!data && !error && <p className="muted small">Finding pharmacies, hospitals, police and ATMs near your stays… The first time takes a few seconds.</p>}
      {error && <p className="muted small">Couldn't reach the map service right now. Try again later.</p>}
      {data && data.stays.length === 0 && <p className="muted small">Add where you're staying in {list.name}, and Joy will find what's nearby.</p>}
      {data?.stays.map((st) => (
        <div key={st.stayId} className="stay-essentials">
          <h4>
            🏨 {st.stayName}
            {st.located === "approximate" && <span className="muted tiny"> · near this address (the map doesn't have the exact building)</span>}
          </h4>
          {st.located === "not-found" ? (
            <p className="muted small">Couldn't find this address on the map. Edit the stay and use Find to pick it.</p>
          ) : (
            <div className="essentials-grid">
              {ESSENTIALS.map((k) => (
                <div key={k.kind} className="essential">
                  <h5>{k.icon} {k.title}</h5>
                  {st.places[k.kind].length === 0 ? (
                    <p className="muted tiny">None found nearby on the map</p>
                  ) : (
                    <ul>
                      {st.places[k.kind].map((p) => (
                        <li key={`${p.name}-${p.lat}`}>
                          <a href={directions(st.directionsFrom, p)} target="_blank" rel="noopener noreferrer">{p.name}</a>
                          <span className="muted tiny"> · {p.km} km</span>
                          {p.open247 && <span className="open247">24/7</span>}
                          {p.phone && <> · <a className="tiny" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a></>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="muted tiny">
        Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Distances are
        straight-line; tap a name for directions. In an emergency, call the number above first.
      </p>
    </section>
  );
}
