import { useCallback, useEffect, useState } from "react";
import type { DraftItem, ItineraryItem, ListEntry, Trip, TripList, TripRole } from "../../shared/types.ts";
import { api, saveTripOffline, type DayPlans } from "../api.ts";
import { formatDateRange, formatDay } from "../format.ts";
import DayStrip, { dayId, type DayInfo } from "./DayStrip.tsx";
import EmailImport from "./EmailImport.tsx";
import ItemCard from "./ItemCard.tsx";
import ItemForm, { KIND_LABEL, type Kind } from "./ItemForm.tsx";
import ListForm from "./ListForm.tsx";
import GuideView from "./GuideView.tsx";
import ListView from "./ListView.tsx";
import PrepareView from "./PrepareView.tsx";
import SpendSummary from "./SpendSummary.tsx";
import TravellersPanel from "./TravellersPanel.tsx";
import { itemIcon, KIND_ICON } from "../icons.ts";
import { describePart, partOn, partRange, partySummary } from "../parts.ts";
import Suggestions from "./Suggestions.tsx";
import TripForm from "./TripForm.tsx";

const CATEGORY_TABS = { all: "All", flight: `${KIND_ICON.flight} Flights`, stay: `${KIND_ICON.stay} Accommodation`, activity: `${KIND_ICON.activity} Activities` } as const;

const startOf = (i: ItineraryItem) =>
  i.kind === "flight" ? i.live?.departureTime ?? i.departureTime : i.kind === "stay" ? i.checkIn : i.start;

type Panel =
  | { type: "add"; kind: Kind; initial?: Partial<DraftItem>; date?: string }
  | { type: "email" }
  | { type: "edit-trip" }
  | { type: "new-list" }
  | { type: "edit-list"; list: TripList }
  | { type: "travellers" }
  | null;
type Category = "all" | Kind; // filters the itinerary

export default function TripDetail({ tripId, mockFlights, initialView }: { tripId: string; mockFlights: boolean; initialView?: "prepare" }) {
  const [data, setData] = useState<{ trip: Trip; items: ItineraryItem[]; role: TripRole }>();
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<Panel>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const [category, setCategory] = useState<Category>("all");
  const [lists, setLists] = useState<TripList[]>([]);
  const [plans, setPlans] = useState<DayPlans>({});
  const [view, setView] = useState<"itinerary" | "prepare" | "ideas">(initialView ?? "itinerary");
  const [ideaCount, setIdeaCount] = useState(0);
  // In the Suggestions tab: Joy's tips, or one of the city guides / your lists (by id).
  const [ideaSection, setIdeaSection] = useState<string>("tips");
  const [emptyDay, setEmptyDay] = useState<string>(); // a day with nothing on it, picked in the date strip
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

  // Keep a copy of this trip on the device for offline use (in the background, at most every 15 minutes).
  useEffect(() => {
    if (data && lists.length) saveTripOffline(tripId, data.items, lists);
  }, [tripId, data, lists]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { trip, items } = data;
  const canEditTrip = data.role !== "viewer";

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
  // In "All", every day of the trip gets its date, even with nothing on it, so gaps show as you scroll.
  if (category === "all")
    for (let d = new Date(`${trip.startDate}T12:00:00Z`); d <= new Date(`${trip.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
    }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  // Where you're sleeping on a night (checked in before, checking out after or on that day).
  const stayOn = (day: string) =>
    items.find((i): i is Extract<ItineraryItem, { kind: "stay" }> => i.kind === "stay" && i.checkIn.slice(0, 10) <= day && i.checkOut.slice(0, 10) > day);
  // Days where only accommodation is booked still need things to do.
  const addFor = (day: string, kind: Kind) => {
    setPanel({ type: "add", kind, date: day });
    setEmptyDay(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Every day of the trip for the date strip (plus any bookings outside the dates), with what's on each.
  const stripDays: DayInfo[] = (() => {
    const all = new Set(days.map(([d]) => d));
    for (let d = new Date(`${trip.startDate}T12:00:00Z`); d <= new Date(`${trip.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) all.add(d.toISOString().slice(0, 10));
    return [...all].sort().map((day) => {
      const dayItems = byDay.get(day) ?? [];
      // The same icon as each card: activities by their name ("Museum…" 🏛️, "Dinner…" 🍽️), homes 🏠.
      const icons: string[] = [...new Set(dayItems.map((i) => itemIcon(i)))];
      if (category === "all" && plans[day]) icons.push("📍");
      // A night at a booked stay isn't a gap (🛏️), but nothing may be planned: tapping it offers to add something.
      const planned = dayItems.length > 0 || (category === "all" && !!plans[day]);
      const stay = !planned && (category === "all" || category === "stay") ? stayOn(day) : undefined;
      if (stay) icons.push("🛏️");
      return { day, icons, hasContent: byDay.has(day), planned, staying: !!stay };
    });
  })();
  const openList = ideaSection !== "tips" ? lists.find((l) => l.id === ideaSection) : undefined;
  const openIdeas = (section: string) => {
    setView("ideas");
    setIdeaSection(section);
  };
  // "+ Itinerary" on a guide or list entry: switch to the itinerary with the activity form filled in.
  const addToItinerary = (e: ListEntry) => {
    setView("itinerary");
    setPanel({ type: "add", kind: "activity", initial: { kind: "activity", title: e.title, location: e.address ?? e.area, notes: e.notes, start: e.day ? `${e.day}T10:00` : "" } as Partial<DraftItem> });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const hasFlights = items.some((i) => i.kind === "flight");
  const count = (k: Kind) => items.filter((i) => i.kind === k).length;

  return (
    <div className={`detail ${canEditTrip ? "" : "view-only"}`}>
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
            <SpendSummary items={items} category={category} />
          </div>
          <div className="head-actions">
            <button className={`ghost ${panel?.type === "travellers" ? "on" : ""}`} onClick={() => setPanel(panel?.type === "travellers" ? null : { type: "travellers" })}>
              👥 Travellers{trip.members?.length ? ` · ${trip.members.length + 1}` : ""}
            </button>
            {canEditTrip && <button className="ghost" onClick={() => setPanel({ type: "edit-trip" })}>Edit</button>}
            {data.role === "owner" && <button
              className="ghost danger"
              onClick={async () => {
                if (!confirm(`Delete "${trip.name}" and everything in it?`)) return;
                await api.deleteTrip(trip.id);
                location.hash = "#/";
              }}
            >
              Delete
            </button>}
          </div>
        </div>

        <div className="views" role="tablist" aria-label="Trip view">
          <button role="tab" aria-selected={view === "itinerary"} className={`view-tab ${view === "itinerary" ? "on" : ""}`} onClick={() => setView("itinerary")}>
            🗓️ Itinerary
          </button>
          <button role="tab" aria-selected={view === "prepare"} className={`view-tab ${view === "prepare" ? "on" : ""}`} onClick={() => setView("prepare")}>
            ✅ Prepare{openTodos ? <span className="count">{openTodos} to do</span> : null}
          </button>
          <button role="tab" aria-selected={view === "ideas"} className={`view-tab ${view === "ideas" ? "on" : ""}`} onClick={() => setView("ideas")}>
            ✨ Suggestions{ideaCount ? <span className="count">{ideaCount}</span> : null}
          </button>
        </div>

        {view === "ideas" && (
          <>
            {/* Joy's tips, a guide for each city you stay in, and your own lists. */}
            <div className="idea-nav categories" role="tablist" aria-label="Suggestions">
              <button role="tab" aria-selected={ideaSection === "tips"} className={`category ${ideaSection === "tips" ? "on" : ""}`} onClick={() => setIdeaSection("tips")}>
                💡 Tips {ideaCount > 0 && <span className="count">{ideaCount}</span>}
              </button>
              {lists.map((l) => (
                <button
                  key={l.id}
                  role="tab"
                  aria-selected={ideaSection === l.id}
                  className={`category ${l.auto ? "guide" : "own"} ${ideaSection === l.id ? "on" : ""}`}
                  title={l.auto ? `Joy's guide to ${l.name}` : undefined}
                  onClick={() => setIdeaSection(l.id)}
                >
                  {l.emoji} {l.name} {l.entries.length > 0 && <span className="count">{l.entries.length}</span>}
                </button>
              ))}
              <button
                type="button"
                className="category new-list edit-only"
                aria-pressed={panel?.type === "new-list"}
                onClick={() => setPanel({ type: "new-list" })}
              >
                + New list
              </button>
            </div>
            {panel?.type === "new-list" && (
              <ListForm
                tripId={trip.id}
                onCancel={() => setPanel(null)}
                onSubmit={async (v) => {
                  const list = await api.createList(trip.id, v);
                  setPanel(null);
                  load();
                  setIdeaSection(list.id);
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
            {openList?.auto && <GuideView key={openList.id} trip={trip} list={openList} onChanged={load} onAddToItinerary={addToItinerary} />}
            {openList && !openList.auto && (
              <ListView
                key={openList.id}
                trip={trip}
                list={openList}
                onChanged={load}
                onEdit={() => setPanel({ type: "edit-list", list: openList })}
                onDeleted={() => setIdeaSection("tips")}
                onAddToItinerary={addToItinerary}
              />
            )}
            {ideaSection !== "tips" && !openList && <p className="muted">That list was deleted.</p>}
          </>
        )}
        {/* Loaded on every tab (hidden unless chosen) so the tab can show how many tips there are. */}
        <div hidden={view !== "ideas" || ideaSection !== "tips"}>
          <Suggestions tripId={trip.id} version={version} onCount={setIdeaCount} />
        </div>
        {view === "ideas" ? null : view === "prepare" ? (
          <PrepareView key={version} tripId={trip.id} onCounts={setOpenTodos} />
        ) : (
        <>
        {panel?.type === "travellers" && (
          <TravellersPanel tripId={trip.id} tripName={trip.name} role={data.role} onClose={() => { setPanel(null); load(); }} onLeft={() => (location.hash = "#/")} />
        )}
        {!canEditTrip && (
          <p className="view-only-note">👀 You can view this trip. Ask its owner if you'd like to make changes.</p>
        )}
        <section className="add-panel edit-only" aria-label="Add to your trip">
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
              key={`${panel.kind}:${(panel.initial as { title?: string } | undefined)?.title ?? ""}:${panel.date ?? ""}`} /* a fresh form when switching Flight / Accommodation / Activity */
              kind={panel.kind}
              initial={panel.initial}
              tripId={trip.id}
              defaultDate={panel.date ?? trip.startDate}
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
        {panel?.type === "email" && (
          <EmailImport tripId={trip.id} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); load(); }} onItemsChanged={load} />
        )}


        {items.length > 0 && (
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
            </div>
            {hasFlights && (
              <button
                className="check-flights edit-only"
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
        {category !== "all" && count(category) === 0 && (
          <div className="card empty">
            <p>No {CATEGORY_TABS[category].replace(/^\S+ /, "").toLowerCase()} yet.</p>
          </div>
        )}

        {/* Always the trip's dates, even before anything's booked. */}
        {stripDays.length > 0 && (
          <DayStrip
            days={stripDays}
            onEmptyDay={(day) => {
              setEmptyDay(day);
              requestAnimationFrame(() => document.getElementById("empty-day")?.scrollIntoView({ block: "nearest" }));
            }}
          />
        )}
        {emptyDay && (
          <div className="card empty-day" id="empty-day">
            <div className="empty-day-head">
              <b>📅 {formatDay(emptyDay)}</b>
              <button type="button" className="chip-x" aria-label="Close" onClick={() => setEmptyDay(undefined)}>×</button>
            </div>
            {stayOn(emptyDay) && <p className="small staying">🛏️ Staying at <b>{stayOn(emptyDay)!.name}</b></p>}
            <p className="muted small">{stayOn(emptyDay) ? "No activities planned yet" : "Nothing planned yet"}{canEditTrip ? ". Add something for this day:" : "."}</p>
            {canEditTrip && (
              <div className="actions left">
                {(stayOn(emptyDay) ? (["activity", "flight"] as Kind[]) : (["activity", "stay", "flight"] as Kind[])).map((k) => (
                  <button key={k} type="button" className={`secondary add-for-day ${k}`} onClick={() => addFor(emptyDay, k)}>
                    {KIND_ICON[k]} {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {items.length === 0 && !panel && (
          <div className="card empty">
            <p>Nothing booked yet. Tap a date above, or add a flight, stay or activity, or forward a booking email and Joy will sort it out.</p>
          </div>
        )}

        {days.map(([day, dayItems], i) => {
          // A header where a new part of the trip begins.
          const part = partOn(trip, day);
          const startsPart = part && (i === 0 || partOn(trip, days[i - 1][0])?.id !== part.id);
          return (
          <section key={day} id={dayId(day)} className="day">
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
            {category === "all" && dayItems.length === 0 && !plans[day] && (
              // Nothing on this day yet: say so (and where you're sleeping), with quick ways to add something.
              <div className="no-activities nothing-yet">
                {stayOn(day) ? (
                  <span className="small">🛏️ Staying at <b>{stayOn(day)!.name}</b> · <span className="muted">no activities planned yet</span></span>
                ) : (
                  <span className="muted small">Nothing planned yet</span>
                )}
                <span className="nothing-yet-actions edit-only">
                  <button type="button" className="link" onClick={() => addFor(day, "activity")}>+ Activity</button>
                  {!stayOn(day) && <button type="button" className="link" onClick={() => addFor(day, "stay")}>+ Accommodation</button>}
                  {!stayOn(day) && <button type="button" className="link" onClick={() => addFor(day, "flight")}>+ Flight</button>}
                </span>
              </div>
            )}
            {category === "all" && dayItems.length > 0 && dayItems.every((i) => i.kind === "stay") && !plans[day] && (
              <p className="no-activities">
                <span className="muted small">No activities planned yet</span>
                <button type="button" className="link edit-only" onClick={() => addFor(day, "activity")}>+ Add activity</button>
              </p>
            )}
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
                      <button type="button" className="link plain" onClick={() => openIdeas(e.listId)} title={`Open ${e.listName}`}>
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

    </div>
  );
}
