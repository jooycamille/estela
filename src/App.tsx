import ReminderBell from "./components/ReminderBell.tsx";
import { useCallback, useEffect, useState } from "react";
import { api, type ConnectionState, type Me } from "./api.ts";
import AccountView from "./components/AccountView.tsx";
import SignIn, { JoinTrip } from "./components/SignIn.tsx";
import { emailLinkInAddress, finishEmailLink, setSupabaseConfig, takePendingInvite } from "./supabaseAuth.ts";
import { language, locale, rememberLanguage, t, type LanguageCode } from "./i18n.ts";
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
  const [auth, setAuth] = useState({ claimHere: false, emailReset: false, supabase: false });
  // Opened from a link in one of Supabase's emails (confirming an account or email, or resetting a password).
  const [emailLink] = useState(emailLinkInAddress);
  const [choosePassword, setChoosePassword] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  useEffect(() => {
    api
      .me()
      .then(async (r) => {
        setSupabaseConfig(r.supabase);
        setAuth({ claimHere: r.claimHere, emailReset: r.emailReset, supabase: !!r.supabase });
        if (emailLink && r.supabase) {
          if (emailLink.kind === "error") {
            history.replaceState(null, "", `${location.pathname}#/`);
            setLinkError(emailLink.error);
          } else {
            try {
              const out = await finishEmailLink(emailLink.kind);
              if (out === "reset") {
                setChoosePassword(true);
                return void setMe(r.user);
              }
              // Signed up from an invite: join its trip now the account is confirmed.
              const invite = takePendingInvite();
              const joined = invite ? await api.acceptInvite(invite).catch(() => undefined) : undefined;
              setMe(out);
              return void location.replace(joined ? `#/trip/${joined.tripId}` : "#/");
            } catch (e) {
              setLinkError((e as Error).message);
            }
          }
        }
        setMe(r.user);
      })
      .catch(() => setMe((m) => m ?? null));
    const out = () => setMe(null);
    addEventListener("joy-signed-out", out);
    return () => removeEventListener("joy-signed-out", out);
  }, []);
  // Your home time zone, for "lands 07:10 there, 01:10 at home": the first device you use is taken to be at home
  // (you can change it under Account).
  // Your language follows you: a new device switches to the one you chose; your first device's language is kept.
  useEffect(() => {
    if (!me) return;
    if (me.language && me.language !== language()) {
      rememberLanguage(me.language as LanguageCode);
      location.reload();
    } else if (!me.language) {
      api.updateMe({ language: language() }).then((r) => setMe(r.user)).catch(() => undefined);
    }
  }, [me?.language]);
  useEffect(() => {
    if (!me || me.homeTimeZone) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) api.updateMe({ homeTimeZone: tz }).then((r) => setMe(r.user)).catch(() => undefined);
  }, [me]);
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
  if (me === null || links.link || links.reset || choosePassword) {
    return (
      <div className="app">
        <main>
          <SignIn
            links={choosePassword ? { ...links, reset: "supabase" } : links}
            claimHere={auth.claimHere}
            emailReset={auth.emailReset}
            supabase={auth.supabase}
            linkError={linkError}
            onSignedIn={(user, trip) => {
              setChoosePassword(false);
              signedIn(user, trip);
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {/* The name centred, with its tagline beneath; your trips on the left, reminders and account on the right. */}
      <header className="topbar">
        <nav className="topbar-left" aria-label={t("Main")}>
          <a href="#/" className="topbar-link">{t("Trips")}</a>
        </nav>
        <a href="#/" className="brand" aria-label={t("Estela, {v1} {v2}", { v1: t("Craft your perfect journey."), v2: t("Home") })}>
          <Wordmark />
          <span className="brand-tagline" aria-hidden="true">{t("Craft your perfect journey.")}</span>
        </a>
        {!status && <span />}
        {status && (
          <div className="status">
            <a href="#/help" className={`help-link ${help ? "on" : ""}`} title={t("Help")} aria-label={t("Help")}>
              <CircleHelp aria-hidden="true" />
            </a>
            <ReminderBell tripId={tripId} />
            <a href="#/account" className="account-link" title={t("You, your devices, sign out")} aria-label={t("Your account: {name}", { name: me.name })}>
              <span className="avatar" aria-hidden="true">{[...me.name.trim()][0]?.toUpperCase() ?? "?"}</span>
              <span className="account-name">{me.name}</span>
            </a>
          </div>
        )}
      </header>
      {connection.offline && (
        <div className="offline-banner" role="status">
          {connection.savedAt
            ? t("Offline: showing the copy saved on this device (from {when}). Changes need a connection.", {
                when: new Date(connection.savedAt).toLocaleString(locale(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
              })
            : t("Offline: showing the copy saved on this device. Changes need a connection.")}
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
          {t("Flight data by")}{" "}
          <a href={PROVIDER_SITES[status.flightProvider]} target="_blank" rel="noreferrer">
            {PROVIDER_NAMES[status.flightProvider] ?? status.flightProvider}
          </a>
        </footer>
      )}
    </div>
  );
}
