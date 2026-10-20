import { useEffect, useId, useRef, useState } from "react";
import type { TripPlace } from "../../shared/types.ts";

/** 🇲🇽 from "MX" */
export const flag = (cc: string) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));

const regionNames = new Intl.DisplayNames(undefined, { type: "region" });
const countryOf = (cc: string) => {
  try {
    return regionNames.of(cc) ?? cc;
  } catch {
    return cc;
  }
};
const KIND = { country: "Country", region: "State / region", city: "City" } as const;

function describe(p: TripPlace) {
  if (p.type === "country") return KIND.country;
  return `${KIND[p.type]} · ${[p.type === "city" ? p.region : undefined, countryOf(p.countryCode)].filter(Boolean).join(", ")}`;
}
const keyOf = (p: TripPlace) => `${p.type}|${p.name}|${p.region ?? ""}|${p.countryCode}`;

/** Pick one or more destinations — countries, states/regions or cities — by searching. */
export default function PlaceSelect({ value, onChange }: { value: TripPlace[]; onChange: (places: TripPlace[]) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TripPlace[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const chosen = new Set(value.map(keyOf));
      setResults(((await res.json()) as TripPlace[]).filter((p) => !chosen.has(keyOf(p))));
      setActive(0);
      setOpen(true);
    }, 120);
    return () => clearTimeout(t);
  }, [query, value]);

  // Native form validation: at least one destination.
  useEffect(() => {
    input.current?.setCustomValidity(value.length ? "" : "Choose at least one destination");
  }, [value]);

  const add = (p: TripPlace) => {
    onChange([...value, p]);
    setQuery("");
    setResults([]);
    setOpen(false);
    input.current?.focus();
  };
  const remove = (p: TripPlace) => onChange(value.filter((x) => keyOf(x) !== keyOf(p)));

  return (
    <label className="place-select" htmlFor={id}>
      Destinations
      <div className="place-box" onClick={() => input.current?.focus()}>
        {value.map((p) => (
          <span key={keyOf(p)} className="place-chip" title={describe(p)}>
            <span aria-hidden="true">{flag(p.countryCode)}</span> {p.name}
            <button type="button" className="chip-x" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}>×</button>
          </span>
        ))}
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          placeholder={value.length ? "Add another…" : "Search countries, states or cities"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && results.length) {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp" && results.length) {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (open && results[active]) {
                e.preventDefault();
                add(results[active]);
              }
            } else if (e.key === "Backspace" && !query && value.length) {
              remove(value[value.length - 1]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && (
        <ul className="airport-list" id={`${id}-list`} role="listbox">
          {results.length === 0 && <li className="muted small none">No places match</li>}
          {results.map((p, i) => (
            <li
              key={keyOf(p)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                add(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span aria-hidden="true">{flag(p.countryCode)}</span> <b>{p.name}</b>
              <span className="muted"> · {describe(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
