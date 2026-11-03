import { useEffect, useState } from "react";
import type { PrepItem } from "../../shared/types.ts";
import { api } from "../api.ts";

// Turning on reminders (push notifications) for this device, and the next few that are coming up. Browsers only allow
// notifications from an installed or secure app: on iPhone, from the Home Screen app (iOS 16.4+).

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

export default function RemindersCard({ items, checked }: { items: PrepItem[]; checked: Set<string> }) {
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

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

  const upcoming = items
    .filter((i) => !checked.has(i.id))
    .flatMap((i) => (i.reminders ?? []).map((r) => ({ ...r, item: i.text })))
    .filter((r) => r.at > new Date().toISOString())
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 3);

  return (
    <section className="card reminders">
      <div className="reminders-head">
        <h3>🔔 Reminders</h3>
        {state === "on" && <span className="reminders-on">On for this device</span>}
      </div>
      {state === "off" && (
        <>
          <p className="muted small">Get a notification on this device when it's time: Check-MIG opening (and a last call before it closes), other online border forms, and online check-in.</p>
          <button type="button" onClick={turnOn} disabled={busy}>{busy ? "Turning on…" : "🔔 Turn on reminders"}</button>
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
          Notifications are blocked for Hey Joy on this device. On iPhone: <b>Settings → Notifications → Hey Joy</b>. In a browser: the site settings
          (the icon left of the address).
        </p>
      )}
      {state === "needs-install" && (
        <p className="small">
          On iPhone, reminders work in the Home Screen app: in Safari tap <b>Share → Add to Home Screen</b>, open Hey Joy from there, sign in, and
          turn reminders on.
        </p>
      )}
      {state === "unsupported" && <p className="muted small">This browser can't show notifications. Try the Home Screen app on your phone, or Chrome, Edge, Firefox or Safari on a computer.</p>}
      {message && <p className="notice">{message}</p>}
      {upcoming.length > 0 && (
        <ul className="upcoming-reminders">
          {upcoming.map((r) => (
            <li key={r.at + r.label}>
              <span className="muted small">{when(r.at)}</span> {r.label}
            </li>
          ))}
        </ul>
      )}
      <p className="muted tiny">Reminders come from your Mac, so it needs to be on. Ticked items aren't reminded.</p>
    </section>
  );
}
