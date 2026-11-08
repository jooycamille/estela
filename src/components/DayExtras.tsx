import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Hotel, MapPin, NotebookPen, Pencil, Plane, Plus, Ticket, X } from "lucide-react";
import type { PrepItem } from "../../shared/types.ts";
import { api } from "../api.ts";
import type { LucideIcon } from "../icons.ts";
import Ico from "./Ico.tsx";

// What you can add to a day from the itinerary, and your own notes and checklist items for it.

export type DayAdd = "note" | "activity" | "place" | "todo" | "stay" | "flight";

const CHOICES: { key: DayAdd; label: string; icon: LucideIcon }[] = [
  { key: "note", label: "Note", icon: NotebookPen },
  { key: "activity", label: "Activity", icon: Ticket },
  { key: "place", label: "Place", icon: MapPin },
  { key: "todo", label: "Checklist item", icon: ClipboardCheck },
  { key: "stay", label: "Accommodation", icon: Hotel },
  { key: "flight", label: "Flight", icon: Plane },
];

/** A quiet line at the end of a day: pointing at it shows a +, which opens what you can add. Pressing + again closes it. */
export function DayAddMenu({ day, label, extra, onPick }: { day: string; label: string; extra: boolean; onPick: (what: DayAdd) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const choices = CHOICES.filter((c) => extra || (c.key !== "stay" && c.key !== "flight"));
  return (
    <div className={`day-add-line edit-only ${open ? "open" : ""}`} ref={ref}>
      <button
        type="button"
        className="day-add-plus"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Add to ${label}`}
        title={`Add to ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus aria-hidden="true" />
      </button>
      {open && (
        <div className="day-add-menu" role="menu" aria-label={`Add to ${label}`}>
          {choices.map((c) => (
            <button key={c.key} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(c.key); }} data-day={day}>
              <Ico icon={c.icon} /> {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One line of text for a day: a note or a checklist item. Enter saves, Esc cancels. */
export function DayTextForm({ initial = "", placeholder, multiline, onDone }: { initial?: string; placeholder: string; multiline?: boolean; onDone: (text?: string) => void }) {
  const [text, setText] = useState(initial);
  const props = {
    autoFocus: true,
    value: text,
    placeholder,
    "aria-label": placeholder,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onDone();
      if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDone(text.trim());
    },
  };
  return (
    <form className="day-text-form" onSubmit={(e) => { e.preventDefault(); onDone(text.trim()); }}>
      {multiline ? <textarea rows={3} maxLength={2000} {...props} /> : <input maxLength={200} {...props} />}
      <span className="day-text-actions">
        <button type="submit">Save</button>
        <button type="button" className="ghost" onClick={() => onDone()}>Cancel</button>
      </span>
    </form>
  );
}

/** Your note for a day, with edit and remove. */
export function DayNote({ text, canEdit, onEdit, onRemove }: { text: string; canEdit: boolean; onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="day-note">
      <NotebookPen aria-hidden="true" className="day-note-icon" />
      <p>{text}</p>
      {canEdit && (
        <span className="prep-actions edit-only">
          <button type="button" className="prep-action" title="Edit note" aria-label="Edit note" onClick={onEdit}><Pencil aria-hidden="true" /></button>
          <button type="button" className="prep-action danger" title="Remove note" aria-label="Remove note" onClick={onRemove}><X aria-hidden="true" /></button>
        </span>
      )}
    </div>
  );
}

/** Checklist items you added for this day. Ticking one here ticks it in Prepare too. */
export function DayChecklist({ tripId, items, checked, onChange }: { tripId: string; items: PrepItem[]; checked: string[]; onChange: () => void }) {
  if (!items.length) return null;
  return (
    <ul className="day-checklist">
      {items.map((i) => (
        <li key={i.id} className={checked.includes(i.id) ? "done" : ""}>
          <label>
            <input className="edit-lock" type="checkbox" checked={checked.includes(i.id)} onChange={(e) => api.checkPrep(tripId, i.id, e.target.checked).then(onChange)} />
            <span>{i.text}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
