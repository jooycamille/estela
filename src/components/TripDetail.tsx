import { useCallback, useEffect, useState } from "react";
import type { DraftItem, ItineraryItem, ListEntry, Trip, TripList } from "../../shared/types.ts";
import { api, type DayPlans } from "../api.ts";
import { formatDateRange, formatDay } from "../format.ts";
import EmailImport from "./EmailImport.tsx";
import ItemCard from "./ItemCard.tsx";
import ItemForm, { KIND_LABEL, type Kind } from "./ItemForm.tsx";
import ListForm from "./ListForm.tsx";
import GuideView from "./GuideView.tsx";
import ListView from "./ListView.tsx";
import PrepareView from "./PrepareView.tsx";
import SpendSummary from "./SpendSummary.tsx";
import { KIND_ICON } from "../icons.ts";
import { describePart, partOn, partRange, partySummary } from "../parts.ts";
import Suggestions from "./Suggestions.tsx";
import TripForm from "./TripForm.tsx";

const CATEGORY_TABS = { all: "All", flight: `${KIND_ICON.flight} Flights`, stay: `${KIND_ICON.stay} Accommodation`, activity: `${KIND_ICON.activity} Activities` } as const;

const startOf = (i: ItineraryItem) =>
  i.kind === "flight" ? i.live?.departureTime ?? i.departureTime : i.kind === "stay" ? i.checkIn : i.start;

type Panel =
  | { type: "add"; kind: Kind; initial?: Partial<DraftItem> }
  | { type: "email" }
  | { type: "edit-trip" }
  | { type: "new-list" }
  | { type: "edit-list"; list: TripList }
  | null;
type Category = "all" | Kind | `list:${string}`;

export default function TripDetail({ tripId, mockFlights }: { tripId: string; mockFlights: boolean }) {
  const [data, setData] = useState<{ trip: Trip; items: ItineraryItem[] }>();
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const [category, setCategory] = useState<Category>("all");
  const [lists, setLists] = useState<TripList[]>([]);
  const [plans, setPlans] = useState<DayPlans>({});
  const [view, setView] = useState<"itinerary" | "prepare">("itinerary");
  const [openTodos, setOpenTodos] = useState(0);

  const load = useCallback(() => {
    api.trip(tripId).then((d) => { setData(d); setVersion((v) => v + 1); }).catch((e) => setError(e.message));
    api.lists(tripId).then(setLists).catch(() => undefined);
    api.dayPlans(tripId).then(setPlans).catch(() => undefined);
  }, [tripId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000); // pick up changes found by the server's flight poller
    return () => clearInterval(t);
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { trip, items } = data;

  if (panel?.type === "edit-trip") {
    return (
      <TripForm
        initial={trip}
        onCancel={() => setPanel(null)}
        onSubmit={async (t) => {
          await api.updateTrip(trip.id, t);
          setPanel(null);
          load();
        }}
      />
    );
  }

  // Group by day; stays also show on check-out day.
  const byDay = new Map<string, ItineraryItem[]>();
  const shown = category === "all" ? items : items.filter((i) => i.kind === category);
  for (const item of [...shown].sort((a, b) => startOf(a).localeCompare(startOf(b)))) {
    const d = startOf(item).slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), item]);
  }
  // Days with places planned from your lists show up too (in the All view).
  if (category === "all") for (const d of Object.keys(plans)) if (!byDay.has(d)) byDay.set(d, []);
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const openList = category.startsWith("list:") ? lists.find((l) => `list:${l.id}` === category) : undefined;
  const addToItinerary = (e: ListEntry) => {
    setPanel({ type: "add", kind: "activity", initial: { kind: "activity", title: e.title, location: e.address ?? e.area, notes: e.notes, start: e.day ? `${e.day}T10:00` : "" } as Partial<DraftItem> });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const hasFlights = items.some((i) => i.kind === "flight");
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;

  return (
    <div className="detail">
      <div className="detail-main">
        <a href="#/" className="back">← All trips</a>
        <div className="page-head">
          <div>
            <h1>{trip.name}</h1>
            <p className="muted">
              {trip.destination} · {formatDateRange(trip.startDate, trip.endDate)} ·{" "}
              <span className={`tag ${trip.purpose}`}>{trip.purpose}</span> · {partySummary(trip)}
              {trip.styles.length > 0 && ` · ${trip.styles.join(", ")}`}
            </p>
            <SpendSummary items={items} category={category.startsWith("list:") ? "all" : (category as "all" | Kind)} />
          </div>
          <div className="head-actions">
            <button className="ghost" onClick={() => setPanel({ type: "edit-trip" })}>Edit</button>
            <button
              className="ghost danger"
              onClick={async () => {
                if (!confirm(`Delete "${trip.name}" and everything in it?`)) return;
                await api.deleteTrip(trip.id);
                location.hash = "#/";
              }}
            >
              Delete
            </button>
          </div>
        </div>

        <div className="views" role="tablist" aria-label="Trip view">
          <button role="tab" aria-selected={view === "itinerary"} className={`view-tab ${view === "itinerary" ? "on" : ""}`} onClick={() => setView("itinerary")}>
            🗓️ Itinerary
          </button>
          <button role="tab" aria-selected={view === "prepare"} className={`view-tab ${view === "prepare" ? "on" : ""}`} onClick={() => setView("prepare")}>
            ✅ Prepare{openTodos ? <span className="count">{openTodos} to do</span> : null}
          </button>
        </div>

        {view === "prepare" ? (
          <PrepareView key={version} tripId={trip.id} onCounts={setOpenTodos} />
        ) : (
        <>
        <section className="add-panel" aria-label="Add to your trip">
          <h4>Add to your trip</h4>
          <div className="add-tiles">
            {(["flight", "stay", "activity"] as Kind[]).map((k) => {
              const on = panel?.type === "add" && panel.kind === k;
              return (
                <button key={k} className={`add-tile ${k} ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setPanel({ type: "add", kind: k })}>
                  <span className="add-icon" aria-hidden="true">{KIND_ICON[k]}</span>
                  <span>{KIND_LABEL[k]}</span>
                </button>
              );
            })}
            <button
              className={`add-tile email ${panel?.type === "email" ? "on" : ""}`}
              aria-pressed={panel?.type === "email"}
              onClick={() => setPanel({ type: "email" })}
            >
              <span className="add-icon" aria-hidden="true">✉️</span>
              <span>Import from email</span>
            </button>

          </div>
        </section>

        {panel?.type === "add" && (
          <div className="card">
            <h3>Add {KIND_LABEL[panel.kind].toLowerCase()}</h3>
            <ItemForm
              kind={panel.kind}
              initial={panel.initial}
              tripId={trip.id}
              defaultDate={trip.startDate}
              submitLabel="Add"
              onCancel={() => setPanel(null)}
              onSubmit={async (d) => {
                await api.addItems(trip.id, [d]);
                setPanel(null);
                load();
              }}
            />
          </div>
        )}
        {panel?.type === "new-list" && (
          <ListForm
            tripId={trip.id}
            onCancel={() => setPanel(null)}
            onSubmit={async (v) => {
              const list = await api.createList(trip.id, v);
              setPanel(null);
              load();
              setCategory(`list:${list.id}`);
            }}
          />
        )}
        {panel?.type === "edit-list" && (
          <ListForm
            tripId={trip.id}
            initial={panel.list}
            onCancel={() => setPanel(null)}
            onSubmit={async (v) => {
              await api.updateList(panel.list.id, v);
              setPanel(null);
              load();
            }}
          />
        )}
        {panel?.type === "email" && (
          <EmailImport tripId={trip.id} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); load(); }} onItemsChanged={load} />
        )}

        {items.length === 0 && lists.length === 0 && !panel && (
          <div className="card empty">
            <p>Nothing here yet. Add a flight, stay or activity — or forward a booking email and Joy will sort it out.</p>
          </div>
        )}

        {(items.length > 0 || lists.length > 0) && (
          <div className="list-bar">
            <span className="list-bar-label">Show</span>
            <div className="categories" role="tablist" aria-label="Show bookings">
              {(["all", "flight", "stay", "activity"] as const).map((c) => (
                <button
                  key={c}
                  role="tab"
                  aria-selected={category === c}
                  className={`category ${category === c ? "on" : ""}`}
                  onClick={() => setCategory(c)}
                >
                  {CATEGORY_TABS[c]} <span className="count">{c === "all" ? items.length : count(c)}</span>
                </button>
              ))}
              {lists.map((l) => (
                <button
                  key={l.id}
                  role="tab"
                  aria-selected={category === `list:${l.id}`}
                  className={`category ${l.auto ? "guide" : "own"} ${category === `list:${l.id}` ? "on" : ""}`}
                  title={l.auto ? `Joy's guide to ${l.name}` : undefined}
                  onClick={() => setCategory(`list:${l.id}`)}
                >
                  {l.emoji} {l.name} {l.entries.length > 0 && <span className="count">{l.entries.length}</span>}
                </button>
              ))}
              <button
                type="button"
                className="category new-list"
                aria-pressed={panel?.type === "new-list"}
                onClick={() => {
                  setPanel({ type: "new-list" });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                + New list
              </button>
            </div>
            {hasFlights && (
              <button
                className="check-flights"
                title="Check live status for your flights"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  await api.refreshFlights(trip.id).finally(() => setRefreshing(false));
                  load();
                }}
              >
                {refreshing ? "Checking…" : "↻ Check flights"}
              </button>
            )}
          </div>
        )}
        {openList?.auto && (
          <GuideView key={openList.id} trip={trip} list={openList} onChanged={load} onAddToItinerary={addToItinerary} />
        )}
        {openList && !openList.auto && (
          <ListView
            key={openList.id}
            trip={trip}
            list={openList}
            onChanged={load}
            onEdit={() => setPanel({ type: "edit-list", list: openList })}
            onDeleted={() => setCategory("all")}
            onAddToItinerary={addToItinerary}
          />
        )}
        {category.startsWith("list:") && !openList && lists.length > 0 && <p className="muted">That list was deleted.</p>}

        {category !== "all" && !category.startsWith("list:") && count(category as Kind) === 0 && (
          <div className="card empty">
            <p>No {CATEGORY_TABS[category as Kind].replace(/^\S+ /, "").toLowerCase()} yet.</p>
          </div>
        )}

        {!openList && days.map(([day, dayItems], i) => {
          // A header where a new part of the trip begins.
          const part = partOn(trip, day);
          const startsPart = part && (i === 0 || partOn(trip, days[i - 1][0])?.id !== part.id);
          return (
          <section key={day} className="day">
            {startsPart && (
              <div className="part-banner">
                <b>{part.name}</b>
                <span className="small">{partRange(part)}</span>
                <span className="small">{describePart(part)}</span>
              </div>
            )}
            <h2 className="day-head">
              {formatDay(day)}
              {(day < trip.startDate || day > trip.endDate) && <span className="warning small"> outside trip dates</span>}
            </h2>
            {dayItems.map((item) => (
              <ItemCard key={item.id} item={item} mockFlights={mockFlights} onChange={load} />
            ))}
            {category === "all" && plans[day] && (
              <div className="day-plan">
                <div className="day-plan-head">
                  <b>📍 Planned from your lists</b>
                  {plans[day].routeUrl && (
                    <a className="small" href={plans[day].routeUrl} target="_blank" rel="noopener noreferrer">Route in Maps ↗</a>
                  )}
                </div>
                <ol>
                  {plans[day].entries.map((e) => (
                    <li key={e.id} className={e.done ? "done" : ""}>
                      <button type="button" className="link plain" onClick={() => setCategory(`list:${e.listId}`)} title={`Open ${e.listName}`}>
                        <span aria-hidden="true">{e.listEmoji}</span> {e.title}
                      </button>
                      {e.area && <span className="muted tiny"> · {e.area}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
          );
        })}
        </>
        )}
      </div>

      <aside className="detail-side">
        <Suggestions tripId={trip.id} version={version} />
      </aside>
    </div>
  );
}
