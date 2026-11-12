import { useEffect, useState } from "react";
import type { ExploreIdea, ExploreIdeas, ExplorePlace, ListEntry, TripList } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Sparkles } from "lucide-react";
import { t } from "../i18n.ts";

// A day that only names a town: what's there, to add to that day. Looked up when you open it.

type Saved = Pick<ListEntry, "kind" | "section">;
const PARTS: { key: "sights" | "toDo" | "eat"; title: string; saved: Saved }[] = [
  { key: "sights", get title() { return t("Places to visit"); }, saved: { kind: "place", section: "see" } },
  { key: "toDo", get title() { return t("Things to do"); }, saved: { kind: "activity" } },
  { key: "eat", get title() { return t("Restaurants"); }, saved: { kind: "place", section: "eat" } },
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export default function ExploreArea({ tripId, place, lists, onAdded }: { tripId: string; place: ExplorePlace; lists: TripList[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [ideas, setIdeas] = useState<ExploreIdeas>();
  const [error, setError] = useState<string>();
  const [justAdded, setJustAdded] = useState<string[]>([]);

  useEffect(() => {
    if (!open || ideas) return;
    api.exploreIdeas(tripId, place).then(setIdeas).catch((e) => setError((e as Error).message));
  }, [open, ideas, tripId, place]);

  const saved = new Set([...lists.flatMap((l) => l.entries.map((e) => fold(e.title))), ...justAdded.map(fold)]);
  const add = async (idea: ExploreIdea, as: Saved) => {
    setError(undefined);
    try {
      await api.addEntry(place.listId, { ...as, title: idea.title, lat: idea.lat, lon: idea.lon, address: idea.address, day: place.day, autoDescribe: false });
      setJustAdded((names) => [...names, idea.title]);
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const shown = PARTS.map((p) => ({ ...p, items: (ideas?.[p.key] ?? []).filter((i) => !saved.has(fold(i.title))) })).filter((p) => p.items.length);

  return (
    <div className="explore-area">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Sparkles aria-hidden="true" /> {open ? t("Hide ideas") : t("Explore {name}: places, things to do and food", { name: place.name })}
      </button>
      {open && (
        <div className="explore-ideas">
          {!ideas && !error && <p className="muted small">{t("Estela is looking around {name}… The first look takes a few seconds.", { name: place.name })}</p>}
          {error && <p className="error small">{error}</p>}
          {ideas && !shown.length && <p className="muted small">{t("The map doesn't list anything more here. Try the links below.")}</p>}
          {shown.map((p) => (
            <div key={p.key} className="explore-part">
              <h5>{p.title}</h5>
              <ul className="by-date-picks">
                {p.items.map((idea) => (
                  <li key={idea.title} className="small">
                    <span>
                      <a href={`https://www.google.com/maps/search/?api=1&query=${idea.lat},${idea.lon}`} target="_blank" rel="noopener noreferrer">{idea.title}</a>
                      {" "}<span className="muted tiny">· {idea.label}</span>
                    </span>
                    <button type="button" className="link edit-only" onClick={() => add(idea, p.saved)}>{t("+ Add to this day")}</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {ideas && (
            <>
              <p className="finders">
                {ideas.links.map((l) => <a key={l.url} className="book-link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
              </p>
              <p className="muted tiny">{t("From OpenStreetMap, so no ratings or opening hours. Check a place is still open before you go.")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
