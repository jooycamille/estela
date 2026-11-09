import { useCallback, useEffect, useState } from "react";
import { api, signOutHere, type Device, type Me } from "../api.ts";
import QrLink from "./QrLink.tsx";

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
})();

/** You: your name (as travel companions see it), your signed-in devices, signing in another device, signing out. */
export default function AccountView({ me, onChanged, onSignedOut }: { me: Me; onChanged: (me: Me) => void; onSignedOut: () => void }) {
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? "");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<string>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [link, setLink] = useState<{ url: string; expiresInMinutes: number }>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api.devices().then(setDevices).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

  return (
    <div className="account">
      <h1>Your account</h1>
      {me.isAdmin && <p className="small"><a href="#/settings">Flight data settings</a></p>}
      {error && <p className="error">{error}</p>}
      {saved && <p className="notice">{saved}</p>}
      {(!me.email || !me.hasPassword) && (
        <p className="claim-note">Finish setting up your account: add your email and a password, so you can sign in on any device.</p>
      )}
      <section className="card">
        <h3>Your details</h3>
        <form
          className="auth-form wide"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            try {
              onChanged((await api.updateMe({ name: name.trim(), email: email.trim() || undefined })).user);
              setSaved("Saved.");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            Name <span className="muted tiny">(how people you share trips with see you)</span>
            <input value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Email <span className="muted tiny">(to sign in, and to reset your password)</span>
            <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" disabled={!name.trim() || (name.trim() === me.name && email.trim() === (me.email ?? ""))}>Save</button>
        </form>
      </section>

      <section className="card">
        <h3>Home time zone</h3>
        <p className="muted small">Flight times and time differences on your trips are shown against this.</p>
        <select
          aria-label="Home time zone"
          value={me.homeTimeZone ?? ""}
          onChange={async (e) => {
            setError(undefined);
            try {
              onChanged((await api.updateMe({ homeTimeZone: e.target.value })).user);
              setSaved("Saved.");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {!me.homeTimeZone && <option value="">Choose…</option>}
          {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ").replace("/", " / ")}</option>)}
        </select>
      </section>

      <section className="card">
        <h3>{me.hasPassword ? "Change password" : "Set a password"}</h3>
        <form
          className="auth-form wide"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            try {
              await api.changePassword(me.hasPassword ? current : undefined, password);
              onChanged({ ...me, hasPassword: true });
              setCurrent("");
              setPassword("");
              setSaved("Password saved. Your other devices were signed out.");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {me.hasPassword && (
            <label>
              Current password
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
          )}
          <label>
            New password
            <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="muted tiny">At least 8 characters. Changing it signs out your other devices.</p>
          <button type="submit" disabled={password.length < 8 || (me.hasPassword && !current)}>Save password</button>
        </form>
      </section>

      <section className="card">
        <h3>Sign in another device</h3>
        <p className="muted small">You can just sign in there with your email and password, or scan a code instead (handy for the Home Screen app on iPhone).</p>
        {link ? (
          <QrLink
            url={link.url}
            title="Scan with the other device's camera"
            note={`Or open this link on it. It works once and expires in ${link.expiresInMinutes} minutes. On a phone, Tailscale needs to be on.`}
          />
        ) : (
          <button type="button" onClick={() => api.deviceLink().then(setLink).catch((e) => setError((e as Error).message))}>Show a sign-in code</button>
        )}
      </section>

      <section className="card">
        <h3>Signed-in devices</h3>
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.id}>
              <span>
                {d.device}
                {d.current && <span className="muted small"> · this device</span>}
                <span className="muted tiny"> · last used {new Date(d.lastSeenAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              </span>
              {!d.current && (
                <button type="button" className="link danger" onClick={() => api.removeDevice(d.id).then(load)}>Sign out</button>
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            await signOutHere();
            onSignedOut();
          }}
        >
          Sign out of this device
        </button>
        <p className="muted tiny">Signing out also removes the offline copy of your trips from this device.</p>
      </section>
    </div>
  );
}
