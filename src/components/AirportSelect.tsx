import { useEffect, useId, useRef, useState } from "react";
import { t as tr } from "../i18n.ts";

type Airport = { iata: string; name: string; city: string; country: string };

const cache = new Map<string, Airport | null>();
async function airportByCode(code: string): Promise<Airport | null> {
  if (!cache.has(code)) {
    const res = await fetch(`/api/airports/${encodeURIComponent(code)}`);
    cache.set(code, res.ok ? ((await res.json()) as Airport) : null);
  }
  return cache.get(code)!;
}

const display = (a: Airport) => `${a.iata} — ${a.city}`;

/**
 * Airport picker: type a code, city, airport or country and choose from the list. The value is always an IATA code
 * from the list (or the code already saved on the booking).
 */
export default function AirportSelect({
  label,
  value,
  onChange,
  required,
  overridden,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
  required?: boolean;
  overridden?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Airport | null>(null);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);

  // Show the chosen airport's city/name (also when the value is set from outside, e.g. by a schedule lookup).
  useEffect(() => {
    if (!value) {
      setSelected(null);
      if (!focused) setQuery("");
      return;
    }
    let alive = true;
    airportByCode(value).then((a) => {
      if (!alive) return;
      setSelected(a);
      if (!focused) setQuery(a ? display(a) : value);
    });
    return () => {
      alive = false;
    };
  }, [value, focused]);

  // Search as you type.
  useEffect(() => {
    if (!focused) return;
    const q = query.trim();
    if (!q || (selected && q === display(selected))) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        setResults((await res.json()) as Airport[]);
        setActive(0);
        setOpen(true);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [query, focused, selected]);

  // Native form validation: a value must be chosen from the list.
  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? tr("Choose an airport from the list") : "");
  }, [required, value]);

  const choose = (a: Airport) => {
    onChange(a.iata);
    setSelected(a);
    setQuery(display(a));
    setOpen(false);
  };

  return (
    <label className={`airport-select ${overridden ? "overridden" : ""}`} htmlFor={id}>
      {label}
      <input
        id={id}
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${id}-${results[active].iata}` : undefined}
        autoComplete="off"
        placeholder={tr("Type a city, airport or code")}
        value={query}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => {
          setFocused(false);
          // Typing without choosing doesn't change the airport.
          setTimeout(() => setOpen(false), 150);
          setQuery(selected ? display(selected) : value);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && results.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp" && results.length) {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {selected && !focused && <span className="muted tiny airport-name">{selected.name}, {selected.country}</span>}
      {open && focused && (
        <ul className="airport-list" id={`${id}-list`} role="listbox">
          {results.length === 0 && <li className="muted small none">{tr("No airports match")}</li>}
          {results.map((a, i) => (
            <li
              key={a.iata}
              id={`${id}-${a.iata}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus until chosen
                choose(a);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <b>{a.iata}</b> {a.city}
              <span className="muted"> · {a.name}, {a.country}</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
