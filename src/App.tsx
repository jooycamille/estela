import { useEffect, useState } from "react";
import { api, type ConnectionState } from "./api.ts";
import TripDetail from "./components/TripDetail.tsx";
import TripList from "./components/TripList.tsx";
import FlightDataSettings from "./components/FlightDataSettings.tsx";
import Logo from "./components/Logo.tsx";

// Minimal hash routing: #/ (trips) and #/trip/:id
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return { tripId: hash.match(/^#\/trip\/(.+)$/)?.[1], settings: hash === "#/settings" };
}

/** Live or saved copy: from each API response (see api.ts), plus the browser's own online/offline signal. */
function useConnection() {
  const [state, setState] = useState<ConnectionState>({ offline: !navigator.onLine });
  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<ConnectionState>).detail);
    const offline = () => setState((s) => (s.offline ? s : { offline: true }));
    addEventListener("joy-connection", onChange);
    addEventListener("offline", offline);
    return () => {
      removeEventListener("joy-connection", onChange);
      removeEventListener("offline", offline);
    };
  }, []);
  return state;
}

const PROVIDER_NAMES: Record<string, string> = { aerodatabox: "AeroDataBox", aviationstack: "Aviationstack", airlabs: "AirLabs" };
const PROVIDER_SITES: Record<string, string> = {
  aerodatabox: "https://aerodatabox.com",
  aviationstack: "https://aviationstack.com",
  airlabs: "https://airlabs.co",
};

export default function App() {
  const { tripId, settings } = useRoute();
  const [status, setStatus] = useState<{ ai: boolean; flightProvider: string }>();
  const loadStatus = () => api.health().then(setStatus).catch(() => {});
  const connection = useConnection();

  // Refresh the header status on every navigation (e.g. after connecting flight data in settings).
  useEffect(() => {
    loadStatus();
  }, [tripId, settings]);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Hey Joy — Go with Joy, home">
          <Logo height={34} />
          <span className="brand-tagline">Go with Joy</span>
        </a>
        {status && (
          <div className="status">
            <span className={`pill ${status.ai ? "ok" : ""}`}>AI {status.ai ? "on" : "off"}</span>
            <a href="#/settings" className={`pill ${status.flightProvider !== "mock" ? "ok" : "attention"}`} title="Flight data settings">
              Flight data: {status.flightProvider === "mock" ? "demo — connect" : PROVIDER_NAMES[status.flightProvider] ?? status.flightProvider}
            </a>
          </div>
        )}
      </header>
      {connection.offline && (
        <div className="offline-banner" role="status">
          📴 Offline: showing the copy saved on this device
          {connection.savedAt && <> (from {new Date(connection.savedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })})</>}
          . Changes need a connection to your Mac.
        </div>
      )}
      <main>
        {settings ? (
          <FlightDataSettings onChanged={loadStatus} />
        ) : tripId ? (
          <TripDetail key={tripId} tripId={tripId} mockFlights={status?.flightProvider === "mock"} />
        ) : (
          <TripList />
        )}
      </main>
      {status && status.flightProvider !== "mock" && (
        <footer className="attribution">
          Flight data by{" "}
          <a href={PROVIDER_SITES[status.flightProvider]} target="_blank" rel="noreferrer">
            {PROVIDER_NAMES[status.flightProvider] ?? status.flightProvider}
          </a>
        </footer>
      )}
    </div>
  );
}
