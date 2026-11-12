import { useEffect, useState } from "react";
import { THEME_EMOJI, type ListTheme } from "../../shared/lists.ts";
import { listThemeOf, THEME_ICON } from "../icons.ts";
import Ico from "./Ico.tsx";
import type { TripList, TripPlace } from "../../shared/types.ts";
import { api } from "../api.ts";
import { t } from "../i18n.ts";

const THEMES: { theme: ListTheme; label: string }[] = [
  { theme: "food", get label() { return t("Food"); } }, { theme: "drinks", get label() { return t("Drinks"); } }, { theme: "sights", get label() { return t("Sights"); } }, { theme: "shopping", get label() { return t("Shopping"); } },
  { theme: "nature", get label() { return t("Nature"); } }, { theme: "nightlife", get label() { return t("Nightlife"); } }, { theme: "general", get label() { return t("Other"); } },
];
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const keyOf = (p: TripPlace) => `${p.type}|${p.name}|${p.countryCode}`;

/** Create or rename a list ("Mexico Eats"): name, what it's about (its icon), and the place. */
export default function ListForm({
  tripId,
  initial,
  onSubmit,
  onCancel,
}: {
  tripId: string;
  initial?: TripList;
  onSubmit: (v: { name: string; emoji: string; place: TripPlace | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // What it's about, from its name ("Mexico Eats" is food) until you choose. Saved as that theme's emoji, which older lists also have.
  const [chosen, setChosen] = useState<ListTheme | undefined>(initial ? listThemeOf(initial) : undefined);
  const [place, setPlace] = useState<string>(initial?.place ? keyOf(initial.place) : "");
  const [placeTouched, setPlaceTouched] = useState(!!initial);
  const [options, setOptions] = useState<TripPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.listPlaces(tripId).then(setOptions).catch(() => setOptions([]));
  }, [tripId]);

  // "Mexico Eats" → about Mexico, until you choose yourself.
  useEffect(() => {
    if (placeTouched) return;
    const words = fold(name);
    const match = [...options].sort((a, b) => b.name.length - a.name.length).find((o) => words.includes(fold(o.name)));
    setPlace(match ? keyOf(match) : "");
  }, [name, options, placeTouched]);
  const theme = chosen ?? listThemeOf({ name, emoji: "" });

  return (
    <form
      className="card list-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await onSubmit({ name: name.trim(), emoji: THEME_EMOJI[theme], place: options.find((o) => keyOf(o) === place) ?? null });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{initial ? t("Edit list") : t("New list")}</h3>
      <p className="muted small">
        {t("Make your own list, like")}{" "}<i>{t("Mexico Eats")}</i>{" "}{t("or")}{" "}<i>{t("Mexico Places")}</i>{t(". Estela suggests ideas that fit it, finds the places on the map, and helps you plan nearby ones on the same day.")}
      </p>
      <div className="grid2">
        <label>
          {t("Name")}
          <input required autoFocus maxLength={60} value={name} placeholder={t("Mexico Eats")} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t("About")}
          <select
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setPlaceTouched(true);
            }}
          >
            <option value="">{t("Anywhere on this trip")}</option>
            {options.map((o) => (
              <option key={keyOf(o)} value={keyOf(o)}>
                {o.type === "country" ? o.name : `   ${o.name}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="theme-pick">
        <legend>{t("Type")}</legend>
        {THEMES.map((o) => (
          <button key={o.theme} type="button" className={`chip ${theme === o.theme ? "on" : ""}`} aria-pressed={theme === o.theme} onClick={() => setChosen(o.theme)}>
            <Ico icon={THEME_ICON[o.theme]} /> {o.label}
          </button>
        ))}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" disabled={busy || !name.trim()}>{busy ? t("Saving…") : initial ? t("Save") : t("Create list")}</button>
      </div>
    </form>
  );
}
