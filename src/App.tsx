import ReminderBell from "./components/ReminderBell.tsx";
import { useCallback, useEffect, useState } from "react";
import { api, type ConnectionState, type Me } from "./api.ts";
import AccountView from "./components/AccountView.tsx";
import SignIn, { JoinTrip } from "./components/SignIn.tsx";
import TripDetail from "./components/TripDetail.tsx";
import TripList from "./components/TripList.tsx";
import FlightDataSettings from "./components/FlightDataSettings.tsx";
import { Wordmark } from "./components/Logo.tsx";
import ScrollTop from "./components/ScrollTop.tsx";
import { CircleHelp } from "lucide-react";
import HelpView from "./components/HelpView.tsx";
import WelcomeTour from "./components/WelcomeTour.tsx";

// Minimal hash routing: #/ (trips) and #/trip/:id
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return {
    tripId: hash.match(/^#\/trip\/([^/]+)/)?.[1],
    tripView: hash.match(/^#\/trip\/[^/]+\/prepare$/) ? ("prepare" as const) : undefined, // from a reminder
    settings: hash === "#/settings",
    account: hash === "#/account",
    help: hash === "#/help",
    // One-time links: sign in another device / owner link, reset a password, join a trip.
    links: {
      link: hash.match(/^#\/signin\/([\w-]+)$/)?.[1],
      reset: hash.match(/^#\/reset\/([\w-]+)$/)?.[1],
      invite: hash.match(/^#\/invite\/([\w-]+)$/)?.[1],
    },
  };
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
  const { tripId, tripView, settings, account, help, links } = useRoute();
  // Who's signed in: undefined while checking, null when signed out.
  const [me, setMe] = useState<Me | null>();
  const [auth, setAuth] = useState({ claimHere: false, emailReset: false });
  useEffect(() => {
    api
      .me()
      .then((r) => {
        setMe(r.user);
        setAuth({ claimHere: r.claimHere, emailReset: r.emailReset });
      })
      .catch(() => setMe((m) => m ?? null));
    const out = () => setMe(null);
    addEventListener("joy-signed-out", out);
    return () => removeEventListener("joy-signed-out", out);
  }, []);
  const signedIn = useCallback((user: Me, trip?: string) => {
    setMe(user);
    location.replace(trip ? `#/trip/${trip}` : "#/"); // drop the used link from the address bar and history
  }, []);
  const [status, setStatus] = useState<{ ai: boolean; flightProvider: string }>();
  // The welcome tour: once for a new account, or again from Help.
  const [tourAgain, setTourAgain] = useState(false);
  const closeTour = () => {
    setTourAgain(false);
    if (me?.tourPending) {
      setMe({ ...me, tourPending: false });
      api.tourDone().catch(() => {}); // if this fails, it shows once more next time: harmless
    }
  };
  const loadStatus = () => api.health().then(setStatus).catch(() => {});
  const connection = useConnection();

  // Refresh the header status on every navigation (e.g. after connecting flight data in settings).
  useEffect(() => {
    if (me) loadStatus();
  }, [tripId, settings, me]);

  if (me === undefined) return <div className="app" />;
  // Signed in and opening an invite: join its trip. Signed out (or using a sign-in or reset link): the sign-in screen.
  if (me && links.invite) {
    return (
      <div className="app">
        <main>
          <JoinTrip token={links.invite} onJoined={(trip) => signedIn(me, trip)} />
        </main>
      </div>
    );
  }
  if (me === null || links.link || links.reset) {
    return (
      <div className="app">
        <main>
          <SignIn links={links} claimHere={auth.claimHere} emailReset={auth.emailReset} onSignedIn={signedIn} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {/* The name centred, with its tagline beneath; your trips on the left, reminders and account on the right. */}
      <header className="topbar">
        <nav className="topbar-left" aria-label="Main">
          <a href="#/" className="topbar-link">Trips</a>
        </nav>
        <a href="#/" className="brand" aria-label="Estela, your journey, composed. Home">
          <Wordmark />
          <span className="brand-tagline" aria-hidden="true">Your journey, composed.</span>
        </a>
        {!status && <span />}
        {status && (
          <div className="status">
            <a href="#/help" className={`help-link ${help ? "on" : ""}`} title="Help" aria-label="Help">
              <CircleHelp aria-hidden="true" />
            </a>
            <ReminderBell tripId={tripId} />
            <a href="#/account" className="account-link" title="You, your devices, sign out" aria-label={`Your account: ${me.name}`}>
              <span className="avatar" aria-hidden="true">{[...me.name.trim()][0]?.toUpperCase() ?? "?"}</span>
              <span className="account-name">{me.name}</span>
            </a>
          </div>
        )}
      </header>
      {connection.offline && (
        <div className="offline-banner" role="status">
          Offline: showing the copy saved on this device
          {connection.savedAt && <> (from {new Date(connection.savedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })})</>}
          . Changes need a connection to your Mac.
        </div>
      )}
      <main>
        {help ? (
          <HelpView onTour={() => setTourAgain(true)} />
        ) : account ? (
          <AccountView me={me} onChanged={setMe} onSignedOut={() => setMe(null)} />
        ) : settings && me.isAdmin ? (
          <FlightDataSettings onChanged={loadStatus} />
        ) : tripId ? (
          <TripDetail key={tripId} tripId={tripId} initialView={tripView} mockFlights={status?.flightProvider === "mock"} ai={!!status?.ai} />
        ) : (
          <TripList />
        )}
      </main>
      <ScrollTop />
      {(me.tourPending || tourAgain) && <WelcomeTour ai={!!status?.ai} onClose={closeTour} />}
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
