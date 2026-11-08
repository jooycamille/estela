import { useCallback, useEffect, useMemo, useState } from "react";
import type { PrepItem } from "../../shared/types.ts";
import { api, type PrepData } from "../api.ts";
import { formatDay } from "../format.ts";
import { findSamePrepItem } from "../../shared/prepAdd.ts";
import Fold, { expand, FoldAll } from "./Fold.tsx";
import { Bell, CloudRain, CloudSun, CloudSunRain, Globe, Pencil, Sun, ThermometerSnowflake, X } from "lucide-react";
import type { LucideIcon } from "../icons.ts";
import Ico from "./Ico.tsx";

// The weather service describes the forecast with an emoji; shown as a line icon like the rest of the app.
const WEATHER_ICON: Record<string, LucideIcon> = { "🌧️": CloudRain, "🌦️": CloudSunRain, "☀️": Sun, "🌤️": CloudSun, "🧥": ThermometerSnowflake };

// Every region code the browser can name (for the home-country picker).
const regionNames = new Intl.DisplayNames(undefined, { type: "region" });
const COUNTRIES = (() => {
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = regionNames.of(code);
      if (name && name !== code && !/unknown/i.test(name)) out.push({ code, name });
    }
  return out.sort((x, y) => x.name.localeCompare(y.name));
})();

const shortRange = (from: string, to: string) => `${formatDay(from)} – ${formatDay(to)}`;

function dueLabel(item: PrepItem) {
  if (!item.due) return null;
  const day = formatDay(item.due);
  if (item.custom) return `For ${day}`; // added from that day of the itinerary
  if (item.group === "For your activities") return `Day before · ${day}`;
  if (item.text.startsWith("Check in online")) return `Opens about ${day}`;
  if (item.when === "online") return `Online before you fly · by ${day}`;
  if (item.when === "plane") return `On the plane · ${day}`;
  if (item.when === "arrival") return `On arrival · ${day}`;
  if (item.when === "check") return `Check before ${day}`;
  return `By ${day}`;
}

const HIDE_DONE = "joy-prepare-hide-done";

export default function PrepareView({ tripId, version, onCounts }: { tripId: string; version?: number; onCounts?: (open: number) => void }) {
  const [data, setData] = useState<PrepData>();
  const [error, setError] = useState<string>();
  // Stays as you left it, on this device, until you change it.
  const [hideDone, setHideDone] = useState(() => {
    try {
      return localStorage.getItem(HIDE_DONE) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDE_DONE, hideDone ? "1" : "0");
    } catch {
      // Private browsing can refuse this: it just won't be remembered.
    }
  }, [hideDone]);
  const [home, setHome] = useState("");

  const load = useCallback(() => {
    api.prep(tripId).then((d) => {
      setData(d);
      setHome((h) => h || d.homeCountry || d.homeCountryGuess || "");
    }).catch((e) => setError((e as Error).message));
  }, [tripId]);
  useEffect(load, [load, version]); // refreshes in place when the trip changes, keeping your spot on the page

  const checked = useMemo(() => new Set(data?.checked ?? []), [data]);
  const all = useMemo(() => (data ? [...data.todo, ...data.packing, ...data.custom] : []), [data]);
  useEffect(() => {
    if (data) onCounts?.(all.filter((i) => i.section === "todo" && !checked.has(i.id)).length);
  }, [all, checked, data, onCounts]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Joy is getting your trip ready…</p>;

  const toggle = async (id: string, on: boolean) => {
    setData((d) => d && { ...d, checked: on ? [...d.checked, id] : d.checked.filter((x) => x !== id) });
    await api.checkPrep(tripId, id, on).catch(load);
    dispatchEvent(new Event("joy-reminders-changed"));
  };
  const section = (s: "todo" | "packing") => [...(s === "todo" ? data.todo : data.packing), ...data.custom.filter((c) => c.section === s)];
  const progress = (s: "todo" | "packing") => {
    const items = section(s);
    return { done: items.filter((i) => checked.has(i.id)).length, total: items.length };
  };
  const todo = progress("todo"), packed = progress("packing");

  return (
    <div className="prepare">
      {!data.homeCountry && (
        <div className="card home-country">
          <p className="small">
            <b>Where are you travelling from?</b> Joy uses it for plug adapters, entry requirements and currency tips
            {data.homeCountryGuess ? " — guessed from your first flight." : "."}
          </p>
          <div className="key-row">
            <select value={home} onChange={(e) => setHome(e.target.value)} aria-label="Home country">
              <option value="">Choose your country…</option>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <button disabled={!home} onClick={() => api.setHomeCountry(home).then(load)}>Save</button>
          </div>
        </div>
      )}

      {data.stops.length > 0 && (
        <section className="card">
          <Fold id={`${tripId}:weather`} title={data.stops.some((s) => s.assumed) ? "Typical weather" : "Weather where you're staying"}>
          {data.stops.some((s) => s.assumed) && (
            <p className="muted small">No city yet, so this is for the country's largest city. Add where you're staying or a flight for your own area.</p>
          )}
          <div className="weather-grid">
            {data.stops.map((s) => (
              <div key={`${s.city}-${s.from}`} className="weather">
                <div className="weather-head">
                  <span className="weather-icon"><Ico icon={WEATHER_ICON[s.weather?.icon ?? ""] ?? Globe} /></span>
                  <div>
                    <b>{s.city}</b>
                    <div className="muted tiny">{shortRange(s.from, s.to)}</div>
                  </div>
                </div>
                {s.weather ? (
                  <>
                    <div className="temps">
                      <b>{s.weather.high}°</b> <span className="muted">/ {s.weather.low}°C</span>
                    </div>
                    <div className="small">{s.weather.summary}</div>
                    <div className="muted tiny">
                      {s.weather.basis === "forecast" ? "Forecast" : "Typical for these dates"} · rain on ~{Math.round(s.weather.rainyShare * 100)}% of days
                    </div>
                  </>
                ) : (
                  <div className="muted small">Weather unavailable right now</div>
                )}
              </div>
            ))}
          </div>
          {data.transits.length > 0 && (
            <p className="muted small">
              Changing planes in {[...new Set(data.transits.map((t) => t.city))].join(", ")}.
            </p>
          )}
          <p className="muted tiny">
            Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>. “Typical” uses the same dates over the last 3 years; it switches to the forecast about 2 weeks out.
          </p>
          </Fold>
        </section>
      )}

      <div className="prep-controls">
        <span className="small">To-do <b>{todo.done}/{todo.total}</b> · Packed <b>{packed.done}/{packed.total}</b></span>
        <label className="checkbox small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span>Hide done</span>
        </label>
        <FoldAll ids={[...(data.stops.length ? ["weather"] : []), "todo", "packing"].map((key) => `${tripId}:${key}`)} />
      </div>

      <PrepSection
        tripId={tripId}
        foldId={`${tripId}:todo`}
        allItems={all}
        title="Before you go"
        items={section("todo")}
        checked={checked}
        hideDone={hideDone}
        onToggle={toggle}
        onAdd={(text) => api.addPrep(tripId, "todo", text).then((item) => { load(); return item; })}
        onDelete={(id) => api.deletePrep(tripId, id).then(load)}
        onEdit={(id, text) => api.updatePrep(tripId, id, text).then((item) => { load(); return item; })}
      />
      <PrepSection
        tripId={tripId}
        foldId={`${tripId}:packing`}
        allItems={all}
        title="Packing list"
        items={section("packing")}
        checked={checked}
        hideDone={hideDone}
        onToggle={toggle}
        onAdd={(text) => api.addPrep(tripId, "packing", text).then((item) => { load(); return item; })}
        onDelete={(id) => api.deletePrep(tripId, id).then(load)}
        onEdit={(id, text) => api.updatePrep(tripId, id, text).then((item) => { load(); return item; })}
      />
    </div>
  );
}

function PrepSection({
  tripId,
  foldId,
  allItems,
  title,
  items,
  checked,
  hideDone,
  onToggle,
  onAdd,
  onDelete,
  onEdit,
}: {
  tripId: string;
  foldId: string;
  allItems: PrepItem[];
  title: string;
  items: PrepItem[];
  checked: Set<string>;
  hideDone: boolean;
  onToggle: (id: string, on: boolean) => void;
  onAdd: (text: string) => Promise<PrepItem>;
  onDelete: (id: string) => Promise<unknown>;
  onEdit: (id: string, text: string) => Promise<PrepItem>;
}) {
  const [text, setText] = useState("");
  const [already, setAlready] = useState<PrepItem>(); // what you're typing is on the list already
  const [added, setAdded] = useState<string>(); // where the last one went
  const [editing, setEditing] = useState<string>(); // the item you're correcting
  const add = async () => {
    const item = await onAdd(text.trim());
    expand(`${foldId}:${item.group}`);
    setText("");
    setAlready(undefined);
    setAdded(`Added to ${item.group}`);
  };
  const now = new Date().toISOString().slice(0, 16);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <section className="card prep-section">
      <Fold id={foldId} title={title} summary={`${items.filter((i) => checked.has(i.id)).length}/${items.length} done`}>
      {groups.map((g) => {
        const shown = items.filter((i) => i.group === g && !(hideDone && checked.has(i.id)));
        if (!shown.length) return null;
        return (
          <div key={g} className="prep-group">
            <Fold id={`${foldId}:${g}`} heading="h5" title={g} summary={`${shown.filter((i) => !checked.has(i.id)).length} to do`}>
            {g === "Medications" && (
              <p className="muted tiny prep-note">
                General guidance from the <a href="https://wwwnc.cdc.gov/travel/page/pack-smart" target="_blank" rel="noopener noreferrer">CDC ↗</a> and <a href="https://travelhealthpro.org.uk/factsheet/43/medicines-abroad" target="_blank" rel="noopener noreferrer">TravelHealthPro ↗</a>, not medical advice. Check with a doctor or pharmacist what suits you, especially if you're pregnant, have allergies or take other medication.
              </p>
            )}
            <ul>
              {shown.map((i) => {
                const done = checked.has(i.id);
                const overdue = !done && i.due && i.due < now;
                return (
                  <li key={i.id} className={done ? "done" : ""}>
                    {editing === i.id ? (
                      <EditPrepItem
                        item={i}
                        others={allItems.filter((other) => other.id !== i.id)}
                        onCancel={() => setEditing(undefined)}
                        onSave={async (newText) => {
                          const saved = await onEdit(i.id, newText);
                          expand(`${foldId}:${saved.group}`);
                          setEditing(undefined);
                          setAdded(saved.group === i.group ? undefined : `Moved to ${saved.group}`);
                        }}
                      />
                    ) : (
                      <>
                      <div className="prep-row">
                      <label className="prep-item">
                        <input className="edit-lock" type="checkbox" checked={done} onChange={(e) => onToggle(i.id, e.target.checked)} />
                        <span>
                          <span className="prep-text">{i.text}</span>
                          {dueLabel(i) && <span className={`due ${overdue ? "overdue" : ""}`}>{dueLabel(i)}</span>}
                          {!done &&
                            i.reminders
                              ?.filter((r) => r.at > new Date().toISOString())
                              .map((r) => (
                                <span key={r.at} className="due reminder" title={r.label}>
                                  <Bell aria-hidden="true" /> {new Date(r.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                                </span>
                              ))}
                          {i.detail && <span className="muted small prep-detail">{i.detail}</span>}
                          {i.source && <span className="muted tiny prep-detail">For {i.source}</span>}
                        </span>
                      </label>
                      {i.custom && (
                        <span className="prep-actions edit-only">
                          <button type="button" className="prep-action" title="Edit" aria-label={`Edit ${i.text}`} onClick={() => setEditing(i.id)}><Pencil aria-hidden="true" /></button>
                          <button type="button" className="prep-action danger" title="Remove" aria-label={`Remove ${i.text}`} onClick={() => onDelete(i.id)}><X aria-hidden="true" /></button>
                        </span>
                      )}
                      </div>
                      {i.links?.length ? (
                        <div className="prep-links">
                          {i.links.map((l) => (
                            <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                          ))}
                        </div>
                      ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            </Fold>
          </div>
        );
      })}
      <form
        className="key-row add-prep edit-only"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const same = findSamePrepItem(text, allItems);
          if (!same) return add();
          // Show you where it is, in case that part of the list is minimized.
          expand(`${tripId}:${same.section}`);
          expand(`${tripId}:${same.section}:${same.group}`);
          setAdded(undefined);
          setAlready(same);
        }}
      >
        <input value={text} onChange={(e) => { setText(e.target.value); setAlready(undefined); setAdded(undefined); }} placeholder={`Add to ${title.toLowerCase()}…`} aria-label={`Add to ${title}`} />
        <button type="submit" className="secondary" disabled={!text.trim()}>Add</button>
      </form>
      {added && <p className="muted small edit-only prep-added" role="status">✓ {added}</p>}
      {already && (
        <p className="small edit-only prep-already" role="status">
          Already on your list: <b>{already.text}</b>
          <span className="muted"> · {already.section === "todo" ? "Before you go" : "Packing list"}, {already.group}{checked.has(already.id) ? " · ticked off" : ""}</span>
          <span className="prep-already-actions">
            <button type="button" className="link" onClick={add}>Add anyway</button>
            <button type="button" className="link muted-link" onClick={() => { setAlready(undefined); setText(""); }}>Never mind</button>
          </span>
        </p>
      )}
      </Fold>
    </section>
  );
}

/** Corrects an item you added, in place, with the same check for what's already on the list as adding one. */
function EditPrepItem({ item, others, onSave, onCancel }: { item: PrepItem; others: PrepItem[]; onSave: (text: string) => Promise<unknown>; onCancel: () => void }) {
  const [text, setText] = useState(item.text);
  const [already, setAlready] = useState<PrepItem>();
  const [error, setError] = useState<string>();
  const save = () => onSave(text.trim()).catch((e) => setError((e as Error).message));
  return (
    <>
      <form
        className="key-row prep-edit"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (!trimmed) return;
          if (trimmed === item.text) return onCancel();
          const same = findSamePrepItem(trimmed, others);
          if (same) setAlready(same);
          else void save();
        }}
      >
        <input
          autoFocus
          value={text}
          maxLength={200}
          aria-label={`Edit ${item.text}`}
          onChange={(e) => { setText(e.target.value); setAlready(undefined); }}
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        />
        <button type="submit" className="secondary" disabled={!text.trim()}>Save</button>
        <button type="button" className="link muted-link" onClick={onCancel}>Cancel</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {already && (
        <p className="small prep-already" role="status">
          Already on your list: <b>{already.text}</b>
          <span className="muted"> · {already.section === "todo" ? "Before you go" : "Packing list"}, {already.group}</span>
          <span className="prep-already-actions">
            <button type="button" className="link" onClick={save}>Save anyway</button>
          </span>
        </p>
      )}
    </>
  );
}
