import { useEffect, useState } from "react";
import { listTheme, THEME_EMOJI } from "../../shared/lists.ts";
import type { TripList, TripPlace } from "../../shared/types.ts";
import { api } from "../api.ts";
import { flag } from "./PlaceSelect.tsx";

const EMOJIS = ["🌮", "🍽️", "☕", "🍸", "🏛️", "📸", "🛍️", "🌿", "🏖️", "🎉", "👨‍👩‍👧", "⭐", "📝"];
const isEmoji = (g: string) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g);
/** The last emoji in what was typed or pasted ("🦜", "🇨🇴", "👨‍👩‍👧"), as one character. */
function lastEmoji(text: string) {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
  return graphemes.filter(isEmoji).at(-1);
}
const SHORTCUT = /Mac/i.test(navigator.platform) ? "Ctrl ⌃ + Cmd ⌘ + Space" : "Windows key + .";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const keyOf = (p: TripPlace) => `${p.type}|${p.name}|${p.countryCode}`;

/** Create or rename a list ("Mexico Eats"): name, emoji, and the place it's about. */
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
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  // Your own emoji (kept in its box even when you try a listed one, so you can switch back).
  const [custom, setCustom] = useState(initial && !EMOJIS.includes(initial.emoji) ? initial.emoji : "");
  const [customHint, setCustomHint] = useState(false);
  const [place, setPlace] = useState<string>(initial?.place ? keyOf(initial.place) : "");
  const [placeTouched, setPlaceTouched] = useState(!!initial);
  const [options, setOptions] = useState<TripPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.listPlaces(tripId).then(setOptions).catch(() => setOptions([]));
  }, [tripId]);

  // "Mexico Eats" → about Mexico, 🌮 — until you choose yourself.
  useEffect(() => {
    if (placeTouched) return;
    const words = fold(name);
    const match = [...options].sort((a, b) => b.name.length - a.name.length).find((o) => words.includes(fold(o.name)));
    setPlace(match ? keyOf(match) : "");
  }, [name, options, placeTouched]);
  const shownEmoji = emoji || THEME_EMOJI[listTheme(name)];

  return (
    <form
      className="card list-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await onSubmit({ name: name.trim(), emoji: shownEmoji, place: options.find((o) => keyOf(o) === place) ?? null });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{initial ? "Edit list" : "New list"}</h3>
      <p className="muted small">
        Make your own list, like <i>Mexico Eats</i> or <i>Mexico Places</i>. Joy suggests ideas that fit it, finds the places
        on the map, and helps you plan nearby ones on the same day.
      </p>
      <div className="grid2">
        <label>
          Name
          <input required autoFocus maxLength={60} value={name} placeholder="Mexico Eats" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          About
          <select
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setPlaceTouched(true);
            }}
          >
            <option value="">Anywhere on this trip</option>
            {options.map((o) => (
              <option key={keyOf(o)} value={keyOf(o)}>
                {flag(o.countryCode)} {o.type === "country" ? o.name : `   ${o.name}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="emoji-pick">
        <legend>Icon</legend>
        {EMOJIS.map((e) => (
          <button key={e} type="button" className={`emoji ${shownEmoji === e ? "on" : ""}`} aria-pressed={shownEmoji === e} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
        <input
          className={`emoji-custom ${custom && shownEmoji === custom ? "on" : ""}`}
          aria-label="Your own emoji"
          placeholder="+ Your own"
          title={`Type or paste any emoji (${SHORTCUT} opens the emoji keyboard)`}
          value={custom}
          onFocus={() => custom && setEmoji(custom)}
          onChange={(e) => {
            const picked = lastEmoji(e.target.value);
            setCustomHint(!picked && e.target.value.trim() !== "");
            setCustom(picked ?? "");
            if (picked) setEmoji(picked);
            else if (emoji === custom) setEmoji("");
          }}
        />
        {customHint && <span className="muted tiny emoji-hint">Use an emoji. {SHORTCUT} opens the emoji keyboard.</span>}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : initial ? "Save" : "Create list"}</button>
      </div>
    </form>
  );
}
