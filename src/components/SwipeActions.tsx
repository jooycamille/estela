import { useEffect, useRef, useState, type ReactNode } from "react";

// Swipe a row left (touch screens) to reveal its actions, like Mail on iPhone. Vertical scrolling still works:
// the row only moves once the finger is clearly going sideways. Tapping the row while it's open closes it instead of
// opening the link underneath. Only one row is open at a time.

const OPEN = "joy-swipe-open";

export default function SwipeActions({ id, actions, children }: { id: string; actions: ReactNode; children: ReactNode }) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; from: number; horizontal?: boolean } | null>(null);
  const [offset, setOffset] = useState(0); // px, ≤ 0
  const [dragging, setDragging] = useState(false);
  const width = () => actionsRef.current?.offsetWidth ?? 160;
  const open = offset < 0;

  // Close when another row opens.
  useEffect(() => {
    const other = (e: Event) => (e as CustomEvent<string>).detail !== id && setOffset(0);
    addEventListener(OPEN, other);
    return () => removeEventListener(OPEN, other);
  }, [id]);

  return (
    <div className={`swipe-row ${open ? "open" : ""}`}>
      <div className="swipe-actions" ref={actionsRef} aria-hidden={!open}>
        {actions}
      </div>
      <div
        className={`swipe-front ${dragging ? "dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          start.current = { x: t.clientX, y: t.clientY, from: offset };
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const t = e.touches[0];
          const dx = t.clientX - s.x, dy = t.clientY - s.y;
          if (s.horizontal === undefined) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            s.horizontal = Math.abs(dx) > Math.abs(dy);
          }
          if (!s.horizontal) return; // a scroll: leave it to the page
          setDragging(true);
          setOffset(Math.max(-width() - 24, Math.min(0, s.from + dx)));
        }}
        onTouchEnd={() => {
          const s = start.current;
          start.current = null;
          setDragging(false);
          if (!s?.horizontal) return;
          // Snap open past a third of the way, else closed.
          const shouldOpen = offset < -width() / 3;
          setOffset(shouldOpen ? -width() : 0);
          if (shouldOpen) dispatchEvent(new CustomEvent(OPEN, { detail: id }));
        }}
        onClickCapture={(e) => {
          // A tap on an open row closes it rather than opening the trip.
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            setOffset(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
