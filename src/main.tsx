import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { keepScrollPlace } from "./pagePlace.ts";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
keepScrollPlace();

// Offline copy on your phone (see public/sw.js). Only in the built app, and only over HTTPS or on this Mac, which is
// where browsers allow it (Tailscale gives the phone an HTTPS address).
if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
