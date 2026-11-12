import { useCallback, useEffect, useState } from "react";
import { api, signOutHere, type Device, type Me } from "../api.ts";
import QrLink from "./QrLink.tsx";
import * as sb from "../supabaseAuth.ts";
import { language, LANGUAGES, locale, rememberLanguage, t, type LanguageCode } from "../i18n.ts";

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
  const [emailPassword, setEmailPassword] = useState(""); // with Supabase: a new email needs your password
  const viaSupabase = sb.supabaseOn();
  const emailChanged = email.trim().toLowerCase() !== (me.email ?? "");
  const [saved, setSaved] = useState<string>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [link, setLink] = useState<{ url: string; expiresInMinutes: number }>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api.devices().then(setDevices).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

  return (
    <div className="account">
      <h1>{t("Your account")}</h1>
      {me.isAdmin && <p className="small"><a href="#/settings">{t("Flight data settings")}</a></p>}
      {error && <p className="error">{error}</p>}
      {saved && <p className="notice">{saved}</p>}
      {(!me.email || !me.hasPassword) && (
        <p className="claim-note">{t("Finish setting up your account: add your email and a password, so you can sign in on any device.")}</p>
      )}
      <section className="card">
        <h3>{t("Your details")}</h3>
        <form
          className="auth-form wide"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            try {
              if (viaSupabase) {
                if (name.trim() !== me.name) onChanged((await api.updateMe({ name: name.trim() })).user);
                if (emailChanged && me.email) {
                  await sb.changeEmail(email.trim(), me.email, emailPassword);
                  setEmailPassword("");
                  return setSaved(t("Almost done: we've sent a link to {email}. Your email changes once you open it.", { email: email.trim() }));
                }
                return setSaved(t("Saved."));
              }
              onChanged((await api.updateMe({ name: name.trim(), email: email.trim() || undefined })).user);
              setSaved(t("Saved."));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            {t("Name")} <span className="muted tiny">{t("(how people you share trips with see you)")}</span>
            <input value={name} maxLength={40} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {t("Email")} <span className="muted tiny">{t("(to sign in, and to reset your password)")}</span>
            <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          {viaSupabase && emailChanged && me.email && (
            <label>
              {t("Your password")} <span className="muted tiny">{t("(to change your email)")}</span>
              <input type="password" autoComplete="current-password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
            </label>
          )}
          <button
            type="submit"
            disabled={!name.trim() || (viaSupabase && !email.trim()) || (name.trim() === me.name && !emailChanged) || (viaSupabase && emailChanged && !!me.email && !emailPassword)}
          >
            {t("Save")}
          </button>
        </form>
      </section>

      <section className="card">
        <h3>{t("Language")}</h3>
        <p className="muted small">{t("Estela's screens, dates and Ask Estela's answers are in this language, on all your devices.")}</p>
        <select
          aria-label={t("Language")}
          value={language()}
          onChange={async (e) => {
            const code = e.target.value as LanguageCode;
            setError(undefined);
            try {
              await api.updateMe({ language: code });
              rememberLanguage(code);
              location.reload();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
        </select>
      </section>

      <section className="card">
        <h3>{t("Home time zone")}</h3>
        <p className="muted small">{t("Flight times and time differences on your trips are shown against this.")}</p>
        <select
          aria-label={t("Home time zone")}
          value={me.homeTimeZone ?? ""}
          onChange={async (e) => {
            setError(undefined);
            try {
              onChanged((await api.updateMe({ homeTimeZone: e.target.value })).user);
              setSaved(t("Saved."));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {!me.homeTimeZone && <option value="">{t("Choose…")}</option>}
          {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ").replace("/", " / ")}</option>)}
        </select>
      </section>

      <section className="card">
        <h3>{me.hasPassword ? t("Change password") : t("Set a password")}</h3>
        <form
          className="auth-form wide"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            try {
              if (viaSupabase && me.email) await sb.changePassword(me.email, current, password);
              else await api.changePassword(me.hasPassword ? current : undefined, password);
              onChanged({ ...me, hasPassword: true });
              setCurrent("");
              setPassword("");
              setSaved(t("Password saved. Your other devices were signed out."));
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          {me.hasPassword && (
            <label>
              {t("Current password")}
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
          )}
          <label>
            {t("New password")}
            <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="muted tiny">{t("At least 8 characters. Changing it signs out your other devices.")}</p>
          <button type="submit" disabled={password.length < 8 || (me.hasPassword && !current)}>{t("Save password")}</button>
        </form>
      </section>

      <section className="card">
        <h3>{t("Sign in another device")}</h3>
        <p className="muted small">{t("You can just sign in there with your email and password, or scan a code instead (handy for the Home Screen app on iPhone).")}</p>
        {link ? (
          <QrLink
            url={link.url}
            title={t("Scan with the other device's camera")}
            note={`${t("Or open this link on it. It works once and expires in {n} minutes.", { n: link.expiresInMinutes })} ${t("On a phone, Tailscale needs to be on.")}`}
          />
        ) : (
          <button type="button" onClick={() => api.deviceLink().then(setLink).catch((e) => setError((e as Error).message))}>{t("Show a sign-in code")}</button>
        )}
      </section>

      <section className="card">
        <h3>{t("Signed-in devices")}</h3>
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.id}>
              <span>
                {d.device}
                {d.current && <span className="muted small"> · {t("this device")}</span>}
                <span className="muted tiny"> · {t("last used {when}", { when: new Date(d.lastSeenAt).toLocaleDateString(locale(), { day: "numeric", month: "short" }) })}</span>
              </span>
              {!d.current && (
                <button type="button" className="link danger" onClick={() => api.removeDevice(d.id).then(load)}>{t("Sign out")}</button>
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
          {t("Sign out of this device")}
        </button>
        <p className="muted tiny">{t("Signing out also removes the offline copy of your trips from this device.")}</p>
      </section>
    </div>
  );
}
