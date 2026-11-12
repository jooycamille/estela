import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { loadLanguage, preferredLanguage } from "./i18n.ts";
import { keepScrollPlace } from "./pagePlace.ts";
import { introduceTabTitle } from "./tabTitle.ts";
// Fonts are bundled, so the app looks the same offline: Inter for text, Cormorant Garamond for titles.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import "./styles.css";

// The app's language first (its translations are a small download), so nothing shows in English and then changes.
loadLanguage(preferredLanguage()).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  keepScrollPlace();
  introduceTabTitle();
});

// Offline copy on your phone (see public/sw.js). Only in the built app, and only over HTTPS or on this Mac, which is
// where browsers allow it (Tailscale gives the phone an HTTPS address).
if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
