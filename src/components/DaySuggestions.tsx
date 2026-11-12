import { useState } from "react";
import type { DateCard, ListSuggestion } from "../../shared/types.ts";
import { Sparkles } from "lucide-react";
import { t, tn } from "../i18n.ts";

// What could fit on a date: saved places close to that day's tour, and things to do. Shown on a guide's dates, and under
// each day in the itinerary, where it stays one line until you open it so the itinerary doesn't get longer.

type Picks = Pick<DateCard, "day" | "free" | "nearby" | "things" | "ideas">;
type Handlers = {
  onPlan: (day: string, entries: { listId: string; id: string }[]) => void;
  onAddIdea: (idea: ListSuggestion) => void;
};

export function SuggestionLists({ card, onPlan, onAddIdea }: { card: Picks } & Handlers) {
  const toDo = card.things.length + card.ideas.length;
  return (
    <>
      {card.nearby.length > 0 && (
        <>
          <div className="by-date-nearby-head">
            <span className="small"><b>{t("On your list, close by")}</b></span>
            {card.nearby.length > 1 && card.nearby.length <= (card.free?.room ?? 0) && <button type="button" className="link edit-only" onClick={() => onPlan(card.day, card.nearby)}>{t("Add all {length}", { length: card.nearby.length })}</button>}
          </div>
          <ul className="by-date-picks">
            {card.nearby.map((e) => (
              <li key={e.id} className="small">
                <span>{e.title} <span className="muted tiny">· {e.km < 0.1 ? t("next to") : t("{km} km from", { km: e.km })} {e.near}</span></span>
                <button type="button" className="link edit-only" onClick={() => onPlan(card.day, [e])}>{t("+ Add to this day")}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {toDo > 0 && (
        <>
          <div className="by-date-nearby-head"><span className="small"><b>{t("Things to do")}</b></span></div>
          <ul className="by-date-picks">
            {card.things.map((e) => (
              <li key={e.id} className="small">
                <span>{e.title} <span className="muted tiny">{t("· on your list")}</span></span>
                <button type="button" className="link edit-only" onClick={() => onPlan(card.day, [e])}>{t("+ Add to this day")}</button>
              </li>
            ))}
            {card.ideas.map((idea) => (
              <li key={idea.title} className="small">
                <span>
                  {idea.title} <span className="muted tiny">· {idea.tag ?? t("idea from Estela")}</span>
                  {idea.detail && <span className="muted tiny by-date-detail">{idea.detail}</span>}
                </span>
                <button type="button" className="link edit-only" onClick={() => onAddIdea(idea)}>{t("+ Add to this day")}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export const freeLine = (free: DateCard["free"]) => (free ? t("Free {from}–{to}, time for about {room}", { from: free.from, to: free.to, room: free.room }) : undefined);

export default function DaySuggestions({ card, place, ...handlers }: { card: Picks; place?: string } & Handlers) {
  const [open, setOpen] = useState(false);
  const count = card.nearby.length + card.things.length + card.ideas.length;
  if (!count) return null;
  return (
    <div className="explore-area day-suggestions">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Sparkles aria-hidden="true" /> {open ? t("Hide suggestions") : place ? tn(count, "{n} suggestion for this day in {place}", "{n} suggestions for this day in {place}", { place }) : tn(count, "{n} suggestion for this day", "{n} suggestions for this day")}
      </button>
      {!open && card.free && <span className="muted tiny">{" "}{t("· free {from}–{to}", { from: card.free.from, to: card.free.to })}</span>}
      {open && (
        <div className="explore-ideas">
          {freeLine(card.free) && <div className="muted tiny by-date-free">{freeLine(card.free)}</div>}
          <SuggestionLists card={card} {...handlers} />
        </div>
      )}
    </div>
  );
}
