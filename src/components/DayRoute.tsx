import { Fragment, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { DayLeg } from "../../shared/types.ts";
import type { DayPlans } from "../api.ts";
import LegLine from "./LegLine.tsx";
import PlaceCard from "./PlaceCard.tsx";

// The places planned for a day, as a route: from where you sleep, place to place, and back, with how long each way
// takes. Drag a place by its handle (or use the arrow keys on it) to put it somewhere else in the day.

type Entry = DayPlans[string]["entries"][number];
type Drag = { id: string; from: number; dy: number; to: number; slots: { top: number; mid: number }[] };

export default function DayRoute({ entries, legs, home, canEdit, onOrder, onOpen, onRemove, onPhotoChanged }: {
  entries: Entry[];
  legs?: Record<string, DayLeg>;
  home?: string; // where you sleep that night
  canEdit: boolean;
  onOrder: (ordered: Entry[]) => void;
  onOpen: (e: Entry) => void;
  onRemove: (e: Entry) => void;
  onPhotoChanged: () => void;
}) {
  const [order, setOrder] = useState(entries);
  useEffect(() => setOrder(entries), [entries]);
  const [drag, setDrag] = useState<Drag>();
  const cards = useRef(new Map<string, HTMLDivElement>());

  const commit = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [e] = next.splice(from, 1);
    next.splice(to, 0, e);
    setOrder(next);
    onOrder(next);
  };

  // Where each card would sit while one is being dragged: the dragged one follows the pointer, the ones it passes
  // move into the next slot up or down.
  const shift = (n: number) => {
    if (!drag) return 0;
    if (n === drag.from) return drag.dy;
    if (drag.to > drag.from && n > drag.from && n <= drag.to) return drag.slots[n - 1].top - drag.slots[n].top;
    if (drag.to < drag.from && n >= drag.to && n < drag.from) return drag.slots[n + 1].top - drag.slots[n].top;
    return 0;
  };

  return (
    <div className={`place-cards ${drag ? "dragging" : ""}`}>
      {order[0] && <div className="route-leg"><LegLine leg={legs?.[`stay>${order[0].id}`]} note={home && `from ${home}`} /></div>}
      {order.map((e, n) => (
        <Fragment key={e.id}>
          <div
            className={`route-stop ${drag?.id === e.id ? "lifted" : ""}`}
            ref={(el) => void (el ? cards.current.set(e.id, el) : cards.current.delete(e.id))}
            style={drag ? { transform: `translateY(${shift(n)}px)` } : undefined}
          >
            {canEdit && order.length > 1 && (
              <button
                type="button"
                className="route-handle edit-only"
                aria-label={`Move ${e.title}. Drag, or use the up and down arrow keys`}
                title="Drag to reorder"
                onPointerDown={(ev) => {
                  if (ev.button !== 0) return;
                  ev.preventDefault();
                  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                  const slots = order.map((o) => {
                    const r = cards.current.get(o.id)!.getBoundingClientRect();
                    return { top: r.top, mid: r.top + r.height / 2 };
                  });
                  setDrag({ id: e.id, from: n, dy: 0, to: n, slots });
                  (ev.currentTarget as HTMLElement).dataset.startY = String(ev.clientY);
                }}
                onPointerMove={(ev) => {
                  if (!drag || drag.id !== e.id) return;
                  const dy = ev.clientY - Number((ev.currentTarget as HTMLElement).dataset.startY);
                  const centre = drag.slots[drag.from].mid + dy;
                  const to = drag.slots.filter((s, k) => k !== drag.from && s.mid < centre).length;
                  setDrag({ ...drag, dy, to });
                }}
                onPointerUp={() => {
                  if (!drag) return;
                  setDrag(undefined);
                  commit(drag.from, drag.to);
                }}
                onPointerCancel={() => setDrag(undefined)}
                onKeyDown={(ev) => {
                  if (ev.key === "ArrowUp" && n > 0) { ev.preventDefault(); commit(n, n - 1); }
                  if (ev.key === "ArrowDown" && n < order.length - 1) { ev.preventDefault(); commit(n, n + 1); }
                }}
              >
                <GripVertical aria-hidden="true" />
              </button>
            )}
            <PlaceCard entry={e} number={order.length > 1 ? n + 1 : undefined} onOpen={() => onOpen(e)} onRemove={() => onRemove(e)} onPhotoChanged={onPhotoChanged} />
          </div>
          {/* While dragging, the ways between keep their room but are hidden: they're about to change. */}
          {n < order.length - 1 && <div className="route-leg"><LegLine leg={legs?.[`${e.id}>${order[n + 1].id}`]} /></div>}
        </Fragment>
      ))}
      {order.length > 0 && <div className="route-leg"><LegLine leg={legs?.[`${order.at(-1)!.id}>stay`]} note={home && `back to ${home}`} /></div>}
    </div>
  );
}
