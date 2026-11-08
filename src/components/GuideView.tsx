import { formatDay, formatTimeOn } from "../format.ts";
import { freeLine, SuggestionLists } from "./DaySuggestions.tsx";
import ExploreArea from "./ExploreArea.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { STYLE_LABELS } from "../../shared/lists.ts";
import type { DateCard, EssentialKind, Essentials, ExplorePlace, SafetyTips, ListEntry, ListSuggestion, PriceLevel, Trip, TripList } from "../../shared/types.ts";
import { api, type ListSuggestions } from "../api.ts";
import { AddEntry, AreaCard, EntryRow, IdeaCard, tripDays, type AddOption } from "./ListView.tsx";
import { useStickBelowHeader } from "./DayStrip.tsx";
import Fold, { expand, FoldAll } from "./Fold.tsx";
import { PRICE_LABEL } from "./Price.tsx";
import Ico from "./Ico.tsx";
import type { LucideIcon } from "../icons.ts";
import { Banknote, LifeBuoy, CalendarDays, Hospital, Hotel, Landmark, MapPin, Pill, ScrollText, ShieldCheck, Smartphone, Soup, Star, Stethoscope, Ticket, TriangleAlert, Utensils } from "lucide-react";

// A destination guide Estela makes for each city you stay in: what to eat, do and see (matched to your travel styles),
// your saved picks, and the pharmacies, clinics, police and ATMs near where you're staying.

type SectionKey = "restaurants" | "food" | "activities" | "sights";
const SECTIONS: { key: SectionKey; icon: LucideIcon; title: string; one: string; add: Pick<ListEntry, "kind" | "section"> }[] = [
  { key: "restaurants", icon: Utensils, title: "Restaurants", one: "Restaurant", add: { kind: "place", section: "eat" } },
  { key: "food", icon: Soup, title: "Food to try", one: "Food to try", add: { kind: "thing" } },
  { key: "activities", icon: Ticket, title: "Things to do for your style", one: "Thing to do", add: { kind: "activity" } },
  { key: "sights", icon: Landmark, title: "Must-visit places", one: "Place to visit", add: { kind: "place", section: "see" } },
];
const sectionOf = (e: ListEntry): SectionKey =>
  e.kind === "thing" ? "food" : e.kind === "activity" ? "activities" : e.section === "eat" ? "restaurants" : "sights";

const ESSENTIALS: { kind: EssentialKind; icon: LucideIcon; title: string }[] = [
  { kind: "pharmacy", icon: Pill, title: "Pharmacies" },
  { kind: "hospital", icon: Hospital, title: "Hospitals" },
  { kind: "clinic", icon: Stethoscope, title: "Clinics" },
  { kind: "police", icon: ShieldCheck, title: "Police" },
  { kind: "atm", icon: Banknote, title: "ATMs & banks" },
];

const ROW_PLACES = 3; // places shown for each tour before "+N more"

export default function GuideView({
  trip,
  list,
  onChanged,
  onAddToItinerary,
  onShowDay,
}: {
  trip: Trip;
  list: TripList;
  onChanged: () => void;
  onAddToItinerary: (entry: ListEntry) => void;
  onShowDay: (day: string) => void;
}) {
  const days = tripDays(trip);
  const [ideas, setIdeas] = useState<ListSuggestions>();
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [adding, setAdding] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set()); // tours showing all their places
  const [priceFilter, setPriceFilter] = useState<PriceLevel | "any">("any");
  const [explore, setExplore] = useState<ExplorePlace[]>([]);
  useEffect(() => {
    api.explorePlaces(trip.id).then(setExplore).catch(() => setExplore([]));
  }, [trip.id]);

  const signature = list.entries.map((e) => `${e.id}${e.day}${e.lat}`).join("|") + (list.dismissed ?? []).length;
  const refresh = useCallback(() => {
    api.listSuggestions(list.id).then(setIdeas).catch(() => setIdeas(undefined));
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
  const booked = new Set([...(ideas?.bookedPicks?.map((p) => p.id) ?? []), ...(ideas?.hiddenPicks ?? [])]);
  const picks = SECTIONS.map((s) => ({ ...s, entries: list.entries.filter((e) => sectionOf(e) === s.key && !booked.has(e.id)) })).filter((s) => s.entries.length);
  const dateCards = ideas?.byDate ?? [];
  const areasLeft = ideas?.areasLeft ?? [];
  const toAdd = dateCards.reduce((n, c) => n + c.nearby.length + c.things.length + c.ideas.length, 0);
  const options: AddOption[] = SECTIONS.map((s) => ({
    key: s.key,
    ...s.add,
    label: s.one,
    placeholder: s.key === "food" ? "e.g. Tacos al pastor" : s.key === "activities" ? "e.g. Salsa class" : undefined,
  }));

  return (
    <div className="list-view guide">
      <div className="card list-head guide-head">
        <div>
          <h2>{list.name}</h2>
          <p className="muted small">
            Estela's guide, made for this stop on your trip
            {trip.styles.length > 0 && <> · for your style: {trip.styles.map((st) => <span key={st} className="style-chip">{STYLE_LABELS[st]}</span>)}</>}
          </p>
        </div>
      </div>

      <SectionBar
        listId={list.id}
        sections={[
          { key: "essentials", label: "Essentials" },
          ...(dateCards.length || areasLeft.length ? [{ key: "dates", label: "Plan by date" }] : []),
          { key: "picks", label: "Your picks" },
          ...(ideas?.guide ? SECTIONS.map((s) => ({ key: s.key, label: s.title.replace(" for your style", "") })) : []),
        ]}
      />

      {error && <p className="error">{error}</p>}

      {/* Safety first: emergency number, pharmacies, hospitals, police and ATMs near where you're staying. */}
      <EssentialsCard list={list} />

      {(dateCards.length > 0 || areasLeft.length > 0) && (
        <section id={`${list.id}-dates`} className="card areas by-date guide-part">
          <Fold id={`${list.id}:dates`} title={<><CalendarDays aria-hidden="true" /> Plan by date</>} summary={toAdd ? `${toAdd} to add` : dateCards.length || undefined}>
          {dateCards.length > 0 && <p className="muted small">What's on each date, places on your list close by, and things to do when there's time. Tour stops are already covered.</p>}
          {dateCards.map((c) => {
            const key = `${c.day}|${c.tour ?? ""}`;
            return (
              <DateRow
                key={key}
                card={c}
                listName={list.name}
                open={openRows.has(key)}
                onToggle={() =>
                  setOpenRows((rows) => {
                    const next = new Set(rows);
                    if (!next.delete(key)) next.add(key);
                    return next;
                  })
                }
                onShowDay={() => onShowDay(c.day)}
                onPlan={(day, entries) => act(() => api.planDay(trip.id, day, entries.map((e) => ({ listId: e.listId, entryId: e.id }))))}
                explore={explore.filter((p) => p.day === c.day)}
                tripId={trip.id}
                lists={[list]}
                onExploreAdded={onChanged}
                onAddIdea={(idea) => act(() => api.addEntry(list.id, { title: idea.title, kind: "activity", notes: idea.detail, links: idea.links, day: c.day }))}
              />
            );
          })}
          {areasLeft.length > 0 && (
            <div className="areas-left">
              <h4>{dateCards.length ? "Your other picks, by area" : "Your picks, by area"}</h4>
              <p className="muted small">Close together, so one day covers them. Pick a day and they'll show up in your itinerary in walking order.</p>
              {areasLeft.map((g) => (
                <AreaCard key={g.entries.map((e) => e.id).join()} group={g} listId={list.id} days={days} onPlan={(day) =>
                  act(() => api.planDay(trip.id, day, g.entries.map((e) => ({ listId: e.listId, entryId: e.id }))))
                } />
              ))}
            </div>
          )}
          </Fold>
        </section>
      )}

      <section id={`${list.id}-picks`} className="card guide-part">
        <Fold id={`${list.id}:picks`} title={<><Star aria-hidden="true" /> Your picks</>} summary={picks.reduce((n, s) => n + s.entries.length, 0)}>
        {picks.length === 0 && <p className="muted small">Tap <b>+ Add</b> on anything below to save it here.</p>}
        <button type="button" className="link add-own edit-only" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {adding ? "Close" : "+ Add your own"}
        </button>
        {adding && <AddEntry list={list} tripId={trip.id} options={options} onAdd={(body) => act(() => api.addEntry(list.id, body))} />}
        <div className="list-columns">
          {picks.map((s) => (
            <div key={s.key} className="list-col">
              <Fold id={`${list.id}:picks:${s.key}`} heading="h4" title={<><Ico icon={s.icon} /> {s.title.replace(" for your style", "")} <span className="muted small">{s.entries.length}</span></>}>
              <ul className="entries">
                {s.entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    days={days}
                    onDay={(day) => act(() => api.updateEntry(list.id, e.id, { day }))}
                    onDelete={() => act(() => api.deleteEntry(list.id, e.id))}
                    onAddToItinerary={() => onAddToItinerary(e)}
                    onPrice={s.key === "restaurants" ? (price) => act(() => api.updateEntry(list.id, e.id, { price })) : undefined}
                  />
                ))}
              </ul>
              </Fold>
            </div>
          ))}
        </div>
        {(ideas?.bookedPicks?.length ?? 0) > 0 && (
          <p className="muted small booked-picks">
            Already booked, so moved off this list:{" "}
            {ideas!.bookedPicks!.map((p) => p.title).join(" · ")}
          </p>
        )}
        </Fold>
      </section>

      {!ideas && <p className="muted">Estela is putting your guide together…</p>}
      {(ideas?.bookedIdeas?.length ?? 0) > 0 && (
        <p className="muted small booked-ideas">✓ Left out because they're booked or planned: {ideas!.bookedIdeas!.join(" · ")}</p>
      )}
      {ideas?.guide &&
        SECTIONS.map((s) => {
          // Restaurants can be narrowed by price ($ to $$$).
          const all = ideas.guide![s.key].filter((i) => s.key !== "restaurants" || priceFilter === "any" || i.price === priceFilter);
          const shown = expanded[s.key] ? all : all.slice(0, 6);
          return (
            <section key={s.key} id={`${list.id}-${s.key}`} className="card list-ideas guide-section">
              <Fold id={`${list.id}:${s.key}`} title={<><Ico icon={s.icon} /> {s.title}</>} summary={all.length}>
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
              </Fold>
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

function DateRow({
  card,
  listName,
  open,
  onToggle,
  onShowDay,
  onPlan,
  onAddIdea,
  explore,
  tripId,
  lists,
  onExploreAdded,
}: {
  explore: ExplorePlace[];
  tripId: string;
  lists: TripList[];
  onExploreAdded: () => void;
  card: DateCard;
  listName: string;
  open: boolean;
  onToggle: () => void;
  onShowDay: () => void;
  onPlan: (day: string | null, entries: { listId: string; id: string }[]) => void;
  onAddIdea: (idea: ListSuggestion) => void;
}) {
  const stops = card.places.length;
  const toDo = card.things.length + card.ideas.length;
  return (
    <div className="area by-date-card">
      <div className="area-head">
        <button type="button" className="link plain by-date-day" title="Show this day in your itinerary" onClick={onShowDay}><b>{formatDay(card.day)}</b></button>
        {card.tour && <span className="muted small"> · {card.tour}{card.tourStart && ` · ${card.tourStart}${card.tourEnd ? `–${formatTimeOn(card.tourEnd, card.day)}` : ""}`} · {stops} place{stops === 1 ? "" : "s"}</span>}
        {!card.tour && !card.planned.length && <span className="muted small"> · Nothing booked</span>}
      </div>
      {stops > 0 && (
        <ol className="by-date-places">
          {(open ? card.places : card.places.slice(0, ROW_PLACES)).map((p) => (
            <li key={p.title} className="small">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat !== undefined ? `${p.lat},${p.lon}` : p.address ?? `${p.title}, ${listName}`)}`} target="_blank" rel="noopener noreferrer" title="Open in Maps">
                <MapPin aria-hidden="true" /> {p.title}
              </a>
            </li>
          ))}
        </ol>
      )}
      {stops > ROW_PLACES && (
        <button type="button" className="link tiny by-date-more" aria-expanded={open} onClick={onToggle}>
          {open ? "Show less" : `+${stops - ROW_PLACES} more`}
        </button>
      )}
      {card.planned.length > 0 && (
        <ul className="by-date-picks">
          {card.planned.map((e) => (
            <li key={e.id} className="small">
              <span><b>{e.title}</b> <span className="muted tiny">· added to this day</span></span>
              <button type="button" className="link muted-link edit-only" onClick={() => onPlan(null, [e])}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {card.free?.room === 0 && <p className="muted tiny by-date-full">Not much free time this day, so nothing more is suggested.</p>}
      {(card.nearby.length > 0 || toDo > 0) && (
        <div className="by-date-nearby">
          {freeLine(card.free) && <div className="muted tiny by-date-free">{freeLine(card.free)}</div>}
          <SuggestionLists card={card} onPlan={onPlan} onAddIdea={onAddIdea} />
        </div>
      )}
      {explore.map((p) => <ExploreArea key={p.name} tripId={tripId} place={p} lists={lists} onAdded={onExploreAdded} />)}
    </div>
  );
}

/** Stays in view as you scroll, like the dates in the itinerary, to move between the guide's sections. */
function SectionBar({ listId, sections }: { listId: string; sections: { key: string; label: string }[] }) {
  useStickBelowHeader();
  const bar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(sections[0]?.key);
  const signature = sections.map((s) => s.key).join();

  // Highlight the section nearest the top of the screen, or the last one once there's no further to scroll.
  useEffect(() => {
    const onScroll = () => {
      const offset = (bar.current?.getBoundingClientRect().bottom ?? 120) + 12;
      const keys = signature.split(",");
      const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = keys[0];
      for (const key of keys) {
        const el = document.getElementById(`${listId}-${key}`);
        if (el && el.getBoundingClientRect().top <= offset) current = key;
      }
      setActive(atEnd ? keys[keys.length - 1] : current);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, [listId, signature]);

  // Keep the highlighted one visible in the bar (it scrolls sideways on phones). Instant, so the page's own smooth
  // scroll isn't cancelled.
  useEffect(() => {
    const chip = bar.current?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    const row = chip?.parentElement;
    if (chip && row) row.scrollTo({ left: chip.offsetLeft - row.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2 });
  }, [active]);

  const jump = (key: string) => {
    expand(`${listId}:${key}`);
    // Once it has opened, land just below the header and this bar.
    setTimeout(() => {
      const el = document.getElementById(`${listId}-${key}`);
      const header = document.querySelector(".topbar")?.getBoundingClientRect().height ?? 60;
      const height = bar.current?.getBoundingClientRect().height ?? 50;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header - height - 8, behavior: "smooth" });
    });
  };

  return (
    <div className="guide-bar" ref={bar}>
      <nav className="guide-nav" aria-label="Guide sections">
        {/* Buttons, not #links: the app's routing lives in the URL hash, so changing it would leave the trip. */}
        {sections.map((s) => (
          <button key={s.key} type="button" data-section={s.key} className={active === s.key ? "on" : ""} aria-current={active === s.key ? "true" : undefined} onClick={() => jump(s.key)}>
            {s.label}
          </button>
        ))}
      </nav>
      <FoldAll ids={sections.map((s) => `${listId}:${s.key}`)} />
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
      <Fold id={`${list.id}:essentials`} title={<><LifeBuoy aria-hidden="true" /> Essentials</>} summary={data?.emergency ? `Emergency: ${data.emergency.number}` : undefined}>
      {data?.emergency && (
        <p className="emergency">
          Emergency number in {list.name}: <a href={`tel:${data.emergency.number}`}><b>{data.emergency.number}</b></a>
          {data.emergency.note && <span className="muted small"> · {data.emergency.note}</span>}
        </p>
      )}
      {!data && !error && <p className="muted small">Finding pharmacies, hospitals, police and ATMs near your stays… The first time takes a few seconds.</p>}
      {error && <p className="muted small">Couldn't reach the map service right now. Try again later.</p>}
      {data && data.stays.length === 0 && <p className="muted small">Add where you're staying in {list.name}, and Estela will find what's nearby.</p>}
      {data?.stays.map((st) => (
        <div key={st.stayId} className="stay-essentials">
          <h4>
            <Hotel aria-hidden="true" /> {st.stayName}
            {st.located === "approximate" && <span className="muted tiny"> · near this address (the map doesn't have the exact building)</span>}
          </h4>
          {st.located === "not-found" ? (
            <p className="muted small">Couldn't find this address on the map. Edit the stay and use Find to pick it.</p>
          ) : (
            <div className="essentials-grid">
              {ESSENTIALS.map((k) => (
                <div key={k.kind} className="essential">
                  <h5><Ico icon={k.icon} /> {k.title}</h5>
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
      {(data?.apps?.length ?? 0) > 0 && (
        <div className="safety-tips safety-part">
          <Fold id={`${list.id}:apps`} heading="h4" title={<><Smartphone aria-hidden="true" /> Useful apps</>} summary={data!.apps!.length}>
            <ul className="small">
              {data!.apps!.map((app) => (
                <li key={app.name}>
                  <a href={app.url} target="_blank" rel="noopener noreferrer"><b>{app.name}</b> ↗</a> <span className="muted tiny">· {app.kind}</span>
                  <span className="muted app-why"> {app.why}</span>
                </li>
              ))}
            </ul>
            <p className="muted tiny">Each links to a page confirming it. Check it still works in your area when you download it.</p>
          </Fold>
        </div>
      )}
      {data?.tips && <SafetyTipsPart listId={list.id} place={list.name} tips={data.tips} />}
      </Fold>
    </section>
  );
}

function SafetyTipsPart({ listId, place, tips }: { listId: string; place: string; tips: SafetyTips }) {
  const parts = [
    { key: "scams", title: "Scams to look out for", icon: TriangleAlert, items: tips.scams },
    { key: "here", title: `In ${place}`, icon: MapPin, items: tips.here ?? [] },
    { key: "safety", title: "Staying safe", icon: ShieldCheck, items: tips.safety },
    { key: "rules", title: "Local rules", icon: ScrollText, items: tips.rules },
  ].filter((p) => p.items.length);
  return (
    <div className="safety-tips">
      {tips.regions && <p className="warning small">{tips.regions}</p>}
      {parts.map((p) => (
        <div key={p.key} className="safety-part">
          <Fold id={`${listId}:tips:${p.key}`} heading="h4" title={<><Ico icon={p.icon} /> {p.title}</>} summary={p.items.length}>
            <ul className="small">
              {p.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </Fold>
        </div>
      ))}
      <p className="muted tiny">
        {parts.length
          ? <>From <a href={tips.sourceUrl} target="_blank" rel="noopener noreferrer">{tips.sourceName} ↗</a>{tips.checked && `, checked ${formatDay(tips.checked)} ${tips.checked.slice(0, 4)}`}. Written for UK travellers, and it changes, so read the latest before you go, along with your own government's advice.</>
          : <>Estela doesn't have scam and safety tips for here yet. See <a href={tips.sourceUrl} target="_blank" rel="noopener noreferrer">{tips.sourceName} ↗</a> or your own government's advice.</>}
      </p>
    </div>
  );
}
