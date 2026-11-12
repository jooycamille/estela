import { useId, useState } from "react";
import { api, type LodgingResult } from "../api.ts";
import { Hotel, MapPin } from "lucide-react";
import { t } from "../i18n.ts";

// A Property or Address input with a Find button (OpenStreetMap). Searches only on Find or Enter — no
// search-as-you-type, per Nominatim's usage policy.

export default function LodgingField({
  label,
  value,
  required,
  placeholder,
  tripId,
  date,
  onChange,
  onPick,
  search,
  className,
}: {
  label: string;
  value: string;
  required?: boolean;
  placeholder?: string;
  tripId?: string;
  date?: string;
  onChange: (v: string) => void;
  onPick: (r: LodgingResult) => void;
  search?: (q: string) => Promise<LodgingResult[]>; // default: accommodation near where you'll be
  className?: string;
}) {
  const id = useId();
  const [results, setResults] = useState<LodgingResult[]>();
  const [busy, setBusy] = useState(false);

  const find = async () => {
    if ((value ?? "").trim().length < 3) return;
    setBusy(true);
    try {
      setResults(await (search ? search(value.trim()) : api.searchLodging(value.trim(), tripId, date)));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className={`lodging-field ${className ?? ""}`} htmlFor={id}>
      {label}
      <div className="key-row">
        <input
          id={id}
          required={required}
          placeholder={placeholder}
          value={value ?? ""}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setResults(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // find, don't submit the form
              find();
            } else if (e.key === "Escape") setResults(undefined);
          }}
        />
        <button type="button" className="secondary" disabled={busy || (value ?? "").trim().length < 3} onClick={find} title={t("Look up this {v1}", { v1: label.toLowerCase() })}>
          {busy ? "…" : t("Find")}
        </button>
      </div>
      {results && (
        <ul className="lodging-results" role="listbox" aria-label={t("{label} matches", { label })}>
          {results.length === 0 && <li className="muted small none">{t("No matches on the map — just keep what you typed.")}</li>}
          {results.slice(0, 6).map((r) => (
            <li key={`${r.name}|${r.address}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(r);
                  setResults(undefined);
                }}
              >
                {r.kind === "property" && !search ? <Hotel aria-hidden="true" /> : <MapPin aria-hidden="true" />}{" "}
                <span>
                  {r.name && <b>{r.name}</b>}
                  <span className={r.name ? "muted small block" : "small"}>{r.address}</span>
                </span>
              </button>
            </li>
          ))}
          {results[0]?.source === "google" ? (
            <li className="muted tiny none">{t("Results from Google Maps")}</li>
          ) : (
            <li className="muted tiny none">{t("Map data ©")}{" "}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{t("OpenStreetMap")}</a>{" "}{t("contributors")}</li>
          )}
        </ul>
      )}
    </label>
  );
}
