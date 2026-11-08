// The browser tab's title: "Estela", then "— Your journey, composed." typed in once when the app opens (never again,
// and never on a loop). With reduced motion on, the whole title is just there.

const NAME = "Estela";
const TAGLINE = " — Your journey, composed.";

export function introduceTabTitle() {
  const full = NAME + TAGLINE;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.title = full;
    return;
  }
  document.title = NAME;
  let shown = 0;
  const step = () => {
    shown += 1;
    document.title = NAME + TAGLINE.slice(0, shown);
    if (shown < TAGLINE.length) setTimeout(step, 65);
  };
  setTimeout(step, 700); // a beat on the name first
}
