import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapPoint, Trip, TripMapData } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatDay } from "../format.ts";
import { t, tn } from "../i18n.ts";

// The whole trip on a map (OpenStreetMap): where you sleep, what you've booked, places saved in your guides and lists,
// and the flights between. Pick a day to see just that day, in order.

// What the legend can switch on and off. Saved places (not planned for a day yet) are kept apart from planned ones.
type Layer = "stay" | "activity" | "planned" | "saved" | "flights";
const LAYERS: { key: Layer; label: string }[] = [
  { key: "stay", get label() { return t("Stays"); } },
  { key: "activity", get label() { return t("Booked"); } },
  { key: "planned", get label() { return t("Planned places"); } },
  { key: "saved", get label() { return t("Saved, not planned"); } },
  { key: "flights", get label() { return t("Flights"); } },
];
const layerOf = (p: MapPoint): Layer => (p.kind === "place" ? (p.day ? "planned" : "saved") : p.kind);
const MANY_SAVED = 15; // more saved places than this start hidden, so the map isn't crowded

const KIND_LABEL: Record<MapPoint["kind"], string> = { get stay() { return t("Stay"); }, get activity() { return t("Booked"); }, get place() { return t("Saved place"); } };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Is the point on this day? A stay covers each night until the morning you leave. */
const onDay = (p: MapPoint, day: string) => (p.kind === "stay" ? p.day! <= day && day < (p.until ?? p.day!) : p.day === day);

export default function TripMap({ trip, version, onShowDay }: { trip: Trip; version: number; onShowDay: (day: string) => void }) {
  const [data, setData] = useState<TripMapData>();
  const [error, setError] = useState<string>();
  const [day, setDay] = useState<string>(); // undefined: the whole trip
  const [hidden, setHidden] = useState<Set<Layer>>(new Set()); // kinds of things you've switched off in the legend
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(null);
  const layer = useRef<L.LayerGroup>(null);
  const showDay = useRef(onShowDay);
  showDay.current = onShowDay;

  useEffect(() => {
    api.map(trip.id).then(setData).catch((e) => setError(e.message));
  }, [trip.id, version]);
  // Lots of saved places: hidden to begin with (the legend shows how many, and turns them on).
  const [decided, setDecided] = useState(false);
  useEffect(() => {
    if (!data || decided) return;
    setDecided(true);
    if (data.points.filter((p) => layerOf(p) === "saved").length > MANY_SAVED) setHidden((h) => new Set([...h, "saved"]));
  }, [data, decided]);

  // The map itself, once.
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    m.setView([20, 0], 2);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // Scroll-wheel zoom only once you've clicked into the map, so the page still scrolls past it.
    m.on("click", () => m.scrollWheelZoom.enable());
    m.on("mouseout", () => m.scrollWheelZoom.disable());
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = new Date(`${trip.startDate}T12:00:00Z`); d <= new Date(`${trip.endDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
  }, [trip.startDate, trip.endDate]);

  const shown = useMemo(() => {
    if (!data) return { points: [], flights: [] };
    const points = data.points.filter((p) => !hidden.has(layerOf(p)) && (!day || onDay(p, day)));
    // A day's stops in order: booked and planned things, then where you sleep last.
    if (day) points.sort((a, b) => Number(a.kind === "stay") - Number(b.kind === "stay"));
    return { points, flights: hidden.has("flights") ? [] : data.flights.filter((f) => !day || f.day === day) };
  }, [data, day, hidden]);

  // Draw what's shown, and fit the view to it.
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g || !data) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const f of shown.flights) {
      const line: L.LatLngExpression[] = [[f.from.lat, f.from.lon], [f.to.lat, f.to.lon]];
      L.polyline(line, { className: "map-flight", weight: 1.5, dashArray: "4 6", interactive: true }).bindTooltip(esc(f.title), { sticky: true }).addTo(g);
      for (const end of [f.from, f.to]) {
        L.marker([end.lat, end.lon], { icon: L.divIcon({ className: "map-airport", html: `<span>${esc(end.code)}</span>`, iconSize: [36, 18], iconAnchor: [18, 9] }), keyboard: false }).addTo(g);
      }
      if (day || shown.points.length === 0) bounds.push(...line);
    }
    let n = 0;
    for (const p of shown.points) {
      const number = day && p.kind !== "stay" ? ++n : undefined;
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin ${p.kind}${p.kind === "place" && !p.day ? " unplanned" : ""}${p.done ? " done" : ""}">${number ?? ""}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -10],
      });
      const popup = document.createElement("div");
      popup.className = "map-popup";
      popup.innerHTML = `<span class="map-popup-kind">${KIND_LABEL[p.kind]}${p.day ? ` · ${esc(formatDay(p.day))}` : ` · ${esc(t("not planned yet"))}`}</span><b>${esc(p.title)}</b>${p.sub ? `<span>${esc(p.sub)}</span>` : ""}`;
      const links = document.createElement("div");
      links.className = "map-popup-links";
      if (p.day) {
        const show = document.createElement("button");
        show.type = "button";
        show.className = "link";
        show.textContent = t("Show in itinerary");
        show.onclick = () => showDay.current(p.day!);
        links.append(show);
      }
      const go = document.createElement("a");
      go.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      go.textContent = t("Directions ↗");
      links.append(go);
      popup.append(links);
      L.marker([p.lat, p.lon], { icon, title: p.title, riseOnHover: true }).bindPopup(popup, { closeButton: false }).addTo(g);
      bounds.push([p.lat, p.lon]);
    }
    if (bounds.length === 1) m.setView(bounds[0], 14);
    else if (bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 15 });
  }, [shown, data, day]);

  const count = (d: string) => (data?.points.filter((p) => p.kind !== "stay" && onDay(p, d)).length ?? 0) + (data?.flights.filter((f) => f.day === d).length ?? 0);
  // How many of each there are (on the day picked, or the whole trip).
  const layerCount = (l: Layer) =>
    l === "flights" ? data?.flights.filter((f) => !day || f.day === day).length ?? 0 : data?.points.filter((p) => layerOf(p) === l && (!day || onDay(p, day))).length ?? 0;
  const toggle = (l: Layer) => setHidden((h) => {
    const next = new Set(h);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    return next;
  });

  return (
    <section className="trip-map" aria-label={t("Map of your trip")}>
      <div className="map-days categories" role="tablist" aria-label={t("Show a day")}>
        <button role="tab" aria-selected={!day} className={`category ${!day ? "on" : ""}`} onClick={() => setDay(undefined)}>{t("Whole trip")}</button>
        {days.map((d) => (
          <button key={d} role="tab" aria-selected={day === d} className={`category ${day === d ? "on" : ""} ${count(d) ? "" : "quiet-day"}`} onClick={() => setDay(day === d ? undefined : d)}>
            {formatDay(d).replace(",", "")}
          </button>
        ))}
      </div>
      <div className="map-box" ref={box} />
      {/* The legend is also the switch: tap a kind to hide it or show it again. */}
      <div className="map-legend" role="group" aria-label={t("Show on the map")}>
        {LAYERS.filter((l) => layerCount(l.key) > 0).map((l) => (
          <button
            key={l.key}
            type="button"
            className={`map-chip ${hidden.has(l.key) ? "off" : ""}`}
            aria-pressed={!hidden.has(l.key)}
            title={hidden.has(l.key) ? t("Show {v1}", { v1: l.label.toLowerCase() }) : t("Hide {v1}", { v1: l.label.toLowerCase() })}
            onClick={() => toggle(l.key)}
          >
            {l.key === "flights" ? <i className="map-line" aria-hidden="true" /> : <i className={`map-pin ${l.key === "planned" || l.key === "saved" ? "place" : l.key}${l.key === "saved" ? " unplanned" : ""}`} aria-hidden="true" />}
            {l.label}
            <span className="map-chip-count">{layerCount(l.key)}</span>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted small">{t("Finding your places…")}</p>}
      {data && day && shown.points.length === 0 && shown.flights.length === 0 && <p className="muted small">{t("Nothing with a place on {formatDay} yet.", { formatDay: formatDay(day) })}</p>}
      {data && data.missing > 0 && (
        <p className="muted small">
          {tn(data.missing, "{n} booking isn't on the map: pick the place when you edit it (the Where or address field) and it'll appear here.", "{n} bookings aren't on the map: pick the place when you edit them (the Where or address field) and they'll appear here.")}
        </p>
      )}
    </section>
  );
}
