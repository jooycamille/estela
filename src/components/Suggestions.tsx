import { useEffect, useState } from "react";
import type { Suggestion } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatDay } from "../format.ts";

const ICON: Record<Suggestion["category"], string> = {
  logistics: "🧭", productivity: "💼", food: "🍜", sightseeing: "🏛", wellness: "🧘", packing: "🧳", safety: "🛟", experience: "✨",
};

export default function Suggestions({ tripId, version }: { tripId: string; version: number }) {
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
    <div className="card suggestions">
      <h3>Joy’s suggestions</h3>
      <p className="muted small">Ideas and heads-ups based on your trip type, who's going, your travel style, and gaps in your plans.</p>
      {aiAvailable && (
        <button className="secondary full" onClick={askClaude} disabled={loading}>
          {loading ? "Joy is thinking…" : usedAi ? "↻ Ask Joy again" : "✨ Ask Joy for more ideas"}
        </button>
      )}
      {error && <p className="warning small">{error}</p>}
      <ul>
        {suggestions.map((s, i) => (
          <li key={i} className={`suggestion ${s.category}`}>
            <div className="s-head">
              <span>{ICON[s.category]}</span>
              <strong>{s.title}</strong>
            </div>
            <p>{s.description}</p>
            {s.day && <p className="muted small">{formatDay(s.day)}</p>}
            {s.links && s.links.length > 0 && (
              <div className="book-links">
                <span className="muted tiny">{s.search?.kind === "stay" ? "Find a stay" : "Find & book"}{s.place ? ` in ${s.place}` : ""}:</span>
                {s.links.map((l) => (
                  <a
                    key={l.label}
                    className="book-link"
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={l.label === "Agoda" ? `Opens Agoda — search for ${s.place ?? "your destination"} there` : `Search ${l.label}`}
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
