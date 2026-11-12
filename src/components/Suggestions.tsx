import { useEffect, useState } from "react";
import type { Suggestion } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatDay } from "../format.ts";
import { BriefcaseBusiness, Compass, Flower2, Landmark, Luggage, ShieldCheck, Sparkles, Star, Utensils } from "lucide-react";
import type { LucideIcon } from "../icons.ts";
import Ico from "./Ico.tsx";
import { t } from "../i18n.ts";

const ICON: Record<Suggestion["category"], LucideIcon> = {
  logistics: Compass, productivity: BriefcaseBusiness, food: Utensils, sightseeing: Landmark, wellness: Flower2, packing: Luggage, safety: ShieldCheck, experience: Star,
};

export default function Suggestions({ tripId, version, onCount }: { tripId: string; version: number; onCount?: (n: number) => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [usedAi, setUsedAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Rule-based tips are instant and refresh whenever the itinerary changes.
  useEffect(() => {
    if (usedAi) return;
    api.suggestions(tripId, false).then((r) => { setSuggestions(r.suggestions); setAiAvailable(r.ai); });
  }, [tripId, version, usedAi]);
  useEffect(() => onCount?.(suggestions.length), [suggestions, onCount]);

  const askClaude = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.suggestions(tripId, true);
      setSuggestions(r.suggestions);
      setError(r.error);
      setUsedAi(!r.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="suggestions">
      <p className="muted small">{t("Ideas and heads-ups based on your trip type, who's going, your travel style, and gaps in your plans.")}</p>
      {aiAvailable && (
        <button className="secondary" onClick={askClaude} disabled={loading}>
          <Sparkles aria-hidden="true" /> {loading ? t("Estela is thinking…") : usedAi ? t("Ask Estela again") : t("Ask Estela for more ideas")}
        </button>
      )}
      {error && <p className="warning small">{error}</p>}
      <ul>
        {suggestions.map((s, i) => (
          <li key={i} className={`card suggestion ${s.category}`}>
            <div className="s-head">
              <span className="s-icon"><Ico icon={ICON[s.category]} /></span>
              <strong>{s.title}</strong>
            </div>
            <p>{s.description}</p>
            {s.day && <p className="muted small">{formatDay(s.day)}</p>}
            {s.links && s.links.length > 0 && (
              <div className="book-links">
                <span className="muted tiny">{s.search?.kind === "stay" ? t("Find a stay") : s.search ? t("Find & book") : t("Search")}{s.place ? t(" in {place}", { place: s.place }) : ""}:</span>
                {s.links.map((l) => (
                  <a
                    key={l.label}
                    className="book-link"
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.label === "Agoda" ? s.place ? t("Opens Agoda — search for {place} there", { place: s.place }) : t("Opens Agoda — search for your destination there") : t("Search {label}", { label: l.label })}
                  >
                    {l.label} ↗
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
