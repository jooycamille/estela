import { useEffect, useRef, useState } from "react";

/**
 * A floating "back to top" button (bottom right). It appears once you've scrolled down, hides while you're scrolling
 * (so it never covers what you're reading), and comes back a moment after you stop.
 */
export default function ScrollTop() {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onScroll = () => {
      setShow(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(window.scrollY > 600), 700);
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      className={`scroll-top ${show ? "show" : ""}`}
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}
