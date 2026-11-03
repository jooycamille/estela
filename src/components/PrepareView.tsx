import { useCallback, useEffect, useMemo, useState } from "react";
import type { PrepItem } from "../../shared/types.ts";
import { api, type PrepData } from "../api.ts";
import { formatDay } from "../format.ts";
import RemindersCard from "./RemindersCard.tsx";

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
  if (item.group === "For your activities") return `Day before · ${day}`;
  if (item.text.startsWith("Check in online")) return `Opens about ${day}`;
  if (item.when === "online") return `Online before you fly · by ${day}`;
  if (item.when === "plane") return `On the plane · ${day}`;
  if (item.when === "arrival") return `On arrival · ${day}`;
  if (item.when === "check") return `Check before ${day}`;
  return `By ${day}`;
}

export default function PrepareView({ tripId, onCounts }: { tripId: string; onCounts?: (open: number) => void }) {
  const [data, setData] = useState<PrepData>();
  const [error, setError] = useState<string>();
  const [hideDone, setHideDone] = useState(false);
  const [home, setHome] = useState("");

  const load = useCallback(() => {
    api.prep(tripId).then((d) => {
      setData(d);
      setHome((h) => h || d.homeCountry || d.homeCountryGuess || "");
    }).catch((e) => setError((e as Error).message));
  }, [tripId]);
  useEffect(load, [load]);

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
          <h3>Weather where you're staying</h3>
          <div className="weather-grid">
            {data.stops.map((s) => (
              <div key={`${s.city}-${s.from}`} className="weather">
                <div className="weather-head">
                  <span className="weather-icon" aria-hidden="true">{s.weather?.icon ?? "🌍"}</span>
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
        </section>
      )}

      <RemindersCard items={data.todo} checked={checked} />

      <div className="prep-controls">
        <span className="small">To-do <b>{todo.done}/{todo.total}</b> · Packed <b>{packed.done}/{packed.total}</b></span>
        <label className="checkbox small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          <span>Hide done</span>
        </label>
      </div>

      <PrepSection
        title="Before you go"
        items={section("todo")}
        checked={checked}
        hideDone={hideDone}
        onToggle={toggle}
        onAdd={(text) => api.addPrep(tripId, "todo", text).then(load)}
        onDelete={(id) => api.deletePrep(tripId, id).then(load)}
      />
      <PrepSection
        title="Packing list"
        items={section("packing")}
        checked={checked}
        hideDone={hideDone}
        onToggle={toggle}
        onAdd={(text) => api.addPrep(tripId, "packing", text).then(load)}
        onDelete={(id) => api.deletePrep(tripId, id).then(load)}
      />
    </div>
  );
}

function PrepSection({
  title,
  items,
  checked,
  hideDone,
  onToggle,
  onAdd,
  onDelete,
}: {
  title: string;
  items: PrepItem[];
  checked: Set<string>;
  hideDone: boolean;
  onToggle: (id: string, on: boolean) => void;
  onAdd: (text: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const now = new Date().toISOString().slice(0, 16);
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <section className="card prep-section">
      <h3>{title}</h3>
      {groups.map((g) => {
        const shown = items.filter((i) => i.group === g && !(hideDone && checked.has(i.id)));
        if (!shown.length) return null;
        return (
          <div key={g} className="prep-group">
            <h5>{g}</h5>
            <ul>
              {shown.map((i) => {
                const done = checked.has(i.id);
                const overdue = !done && i.due && i.due < now;
                return (
                  <li key={i.id} className={done ? "done" : ""}>
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
                                🔔 {new Date(r.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                              </span>
                            ))}
                        {i.detail && <span className="muted small prep-detail">{i.detail}</span>}
                        {i.source && <span className="muted tiny prep-detail">For {i.source}</span>}
                      </span>
                    </label>
                    {(i.links?.length || i.custom) && (
                      <div className="prep-links">
                        {i.links?.map((l) => (
                          <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                        ))}
                        {i.custom && <button className="link danger edit-only" onClick={() => onDelete(i.id)}>Remove</button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <form
        className="key-row add-prep edit-only"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await onAdd(text.trim());
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Add to ${title.toLowerCase()}…`} aria-label={`Add to ${title}`} />
        <button type="submit" className="secondary" disabled={!text.trim()}>Add</button>
      </form>
    </section>
  );
}
