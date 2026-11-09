// Keeps your place when the page reloads: how far down you were, and which tab or guide was open. The browser can't do
// this by itself, because the page is still short when it tries (your trip loads a moment later). Kept for this tab
// only, and only a reload goes back to it: opening the app or following a reminder starts as normal.

type Place = { y?: number; view?: string; section?: string; category?: string; map?: string };

const STORE = "joy-page-place";
const MAX_WAIT_MS = 8000; // the saved copy can take up to 6s to answer when your Mac is out of reach

const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
let reloaded = navigation?.type === "reload" || navigation?.type === "back_forward";

function allPlaces(): Record<string, Place> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

/** Where you were on this page, if it has just been reloaded. */
export function restoredPlace(): Place {
  return reloaded ? allPlaces()[location.hash] ?? {} : {};
}

export function rememberPlace(change: Place) {
  try {
    const places = allPlaces();
    places[location.hash] = { ...places[location.hash], ...change };
    sessionStorage.setItem(STORE, JSON.stringify(places));
  } catch {
    // Private browsing can refuse this: a reload then just starts at the top.
  }
}

/** Saves the scroll position as you go, and after a reload scrolls back once the page is long enough. */
export function keepScrollPlace() {
  history.scrollRestoration = "manual";
  let restoring = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    if (!restoring) rememberPlace({ y: Math.round(window.scrollY) });
  };
  addEventListener("scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(save, 150);
  }, { passive: true });
  addEventListener("pagehide", save);
  addEventListener("hashchange", () => {
    reloaded = false; // moving around the app afterwards isn't a reload
  });

  const y = restoredPlace().y;
  const root = document.getElementById("root");
  if (!y || !root) return;

  restoring = true;
  const INPUT = ["wheel", "touchstart", "pointerdown", "keydown"];
  const goBack = () => {
    if (document.documentElement.scrollHeight - window.innerHeight >= y) window.scrollTo(0, y);
  };
  // Parts of the page keep arriving, so go back again each time it changes, until you scroll or tap yourself.
  const observer = new ResizeObserver(goBack);
  const stop = () => {
    restoring = false;
    observer.disconnect();
    clearTimeout(limit);
    INPUT.forEach((name) => removeEventListener(name, stop));
  };
  const limit = setTimeout(() => {
    window.scrollTo(0, y); // as far as the page goes now
    stop();
  }, MAX_WAIT_MS);
  INPUT.forEach((name) => addEventListener(name, stop, { passive: true }));
  observer.observe(root);
}
