import { useCallback, useEffect, useRef, useState } from "react";
import { api, type UpcomingReminder } from "../api.ts";
import { Bell, BellOff } from "lucide-react";

// The bell in the header: turning on reminders (push notifications) for this device, and what's coming up on the trip
// you're looking at. Browsers only allow notifications from an installed or secure app: on iPhone, from the Home Screen
// app (iOS 16.4+).

type State = "checking" | "on" | "off" | "blocked" | "needs-install" | "unsupported";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** The server's public key, as the bytes the browser wants. */
function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.getRegistration().then((r) => r ?? navigator.serviceWorker.ready);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function ReminderBell({ tripId }: { tripId?: string }) {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [upcoming, setUpcoming] = useState<UpcomingReminder[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const loadUpcoming = useCallback(() => {
    if (!tripId) return setUpcoming([]);
    api.upcomingReminders(tripId).then(setUpcoming).catch(() => setUpcoming([]));
  }, [tripId]);
  useEffect(() => {
    loadUpcoming();
    addEventListener("joy-reminders-changed", loadUpcoming); // an item was ticked or unticked
    return () => removeEventListener("joy-reminders-changed", loadUpcoming);
  }, [loadUpcoming]);

  // Closes when you tap elsewhere or press Esc.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(isIos() && !standalone() ? "needs-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await registration().catch(() => undefined);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (sub) {
        await api.pushSubscribe(sub.toJSON()).catch(() => undefined); // make sure the server still has it
        setState("on");
      } else setState("off");
    })();
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
      const reg = await registration();
      const { publicKey } = await api.pushKey();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await api.pushSubscribe(sub.toJSON());
      setState("on");
      setMessage("Reminders are on. Send a test to see one.");
    } catch (e) {
      setMessage(`Couldn't turn on reminders: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe();
    }
    setState("off");
    setMessage(undefined);
  };

  const coming = upcoming.filter((r) => r.at > new Date().toISOString());
  const on = state === "on";

  return (
    <div className="bell" ref={box}>
      <button
        type="button"
        className={`bell-button ${on ? "on" : ""}`}
        aria-expanded={open}
        aria-label={`Reminders${on ? ", on" : ", off"}${coming.length ? `, ${coming.length} coming up` : ""}`}
        title="Reminders"
        onClick={() => { setOpen((o) => !o); loadUpcoming(); }}
      >
        {on ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
        {coming.length > 0 && <span className="bell-count" aria-hidden="true">{coming.length > 9 ? "9+" : coming.length}</span>}
      </button>
      {open && (
      <div className="bell-panel reminders">
      <h3>Reminders</h3>
      {state === "on" && <p className="reminders-status"><span className="reminders-on">On for this device</span></p>}
      {state === "off" && (
        <>
          <p className="muted small">Get a notification on this device when it's time: Check-MIG opening (and a last call before it closes), other online border forms, and online check-in.</p>
          <button type="button" onClick={turnOn} disabled={busy}>{busy ? "Turning on…" : "Turn on reminders"}</button>
        </>
      )}
      {state === "on" && (
        <div className="actions left">
          <button type="button" className="secondary" onClick={() => api.pushTest().then((r) => setMessage(r.sent ? "Test sent. It should appear in a moment." : "Couldn't reach this device. Try turning reminders off and on."))}>
            Send a test
          </button>
          <button type="button" className="ghost" onClick={turnOff}>Turn off here</button>
        </div>
      )}
      {state === "blocked" && (
        <p className="small">
          Notifications are blocked for Estela on this device. On iPhone: <b>Settings → Notifications → Estela</b>. In a browser: the site settings
          (the icon left of the address).
        </p>
      )}
      {state === "needs-install" && (
        <p className="small">
          On iPhone, reminders work in the Home Screen app: in Safari tap <b>Share → Add to Home Screen</b>, open Estela from there, sign in, and
          turn reminders on.
        </p>
      )}
      {state === "unsupported" && <p className="muted small">This browser can't show notifications. Try the Home Screen app on your phone, or Chrome, Edge, Firefox or Safari on a computer.</p>}
      {message && <p className="notice">{message}</p>}
      {tripId && (coming.length === 0 ? <p className="muted small bell-none">Nothing coming up on this trip.</p> : (
        <ul className="upcoming-reminders">
          {coming.slice(0, 5).map((r) => (
            <li key={r.at + r.label}>
              <span className="muted small">{when(r.at)}</span> {r.label}
            </li>
          ))}
        </ul>
      ))}
      <p className="muted tiny">Reminders come from your Mac, so it needs to be on. Ticked items aren't reminded.</p>
      </div>
      )}
    </div>
  );
}
