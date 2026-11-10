import { useEffect, useRef, useState } from "react";
import { Ellipsis, LogOut, Pencil, Trash2 } from "lucide-react";

/**
 * The ⋯ on a trip card: edit or delete the trip (or leave one shared with you) without opening it. On phones, swiping
 * the card left does the same.
 */
export default function TripMenu({ name, canEdit, owner, onEdit, onRemove }: {
  name: string;
  canEdit: boolean;
  owner: boolean; // delete it; otherwise leave it
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    // The first choice gets focus, so the menu works from the keyboard.
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className={`trip-menu ${open ? "open" : ""}`}>
      <button
        ref={button}
        type="button"
        className="trip-menu-button"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      {open && (
        <div
          className="day-add-menu trip-menu-list"
          role="menu"
          aria-label={name}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          {canEdit && (
            <button type="button" role="menuitem" onClick={pick(onEdit)}>
              <Pencil aria-hidden="true" /> Edit trip
            </button>
          )}
          <button type="button" role="menuitem" className="danger" onClick={pick(onRemove)}>
            {owner ? <><Trash2 aria-hidden="true" /> Delete trip</> : <><LogOut aria-hidden="true" /> Leave trip</>}
          </button>
        </div>
      )}
    </div>
  );
}
