import { useEffect, useState } from "react";
import { api, type FlightDataSettings as Settings, type FlightProviderName, type FlightService } from "../api.ts";
import { t } from "../i18n.ts";

const ROUTES = {
  rapidapi: { get name() { return t("RapidAPI (free plan)"); }, signup: "https://rapidapi.com/aedbx-aedbx/api/aerodatabox", get where() { return t("Subscribe to the free Basic plan, then copy “X-RapidAPI-Key” from the endpoint playground."); } },
  apimarket: { get name() { return t("API.market (free plan)"); }, signup: "https://api.market/store/aedbx/aerodatabox", get where() { return t("Start the free Basic plan, then copy your API key from your dashboard."); } },
  direct: { get name() { return t("AeroDataBox direct (paid)"); }, signup: "https://aerodatabox.com/pricing/", get where() { return t("Paid plans from US$19/month; copy the API key from your AeroDataBox account."); } },
} as const;
type Route = keyof typeof ROUTES;

const INFO: Record<FlightProviderName, { name: string; summary: string; howTo: string; link: string; unit: string }> = {
  aerodatabox: {
    name: "AeroDataBox",
    get summary() { return t("Best for adding flights: any flight number on a specific date up to a year ahead, plus live status. Free plan ≈ 200 lookups a month."); },
    howTo: "",
    link: "https://rapidapi.com/aedbx-aedbx/api/aerodatabox",
    get unit() { return t("units (2 per lookup)"); },
  },
  airlabs: {
    name: "AirLabs",
    get summary() { return t("1 request per lookup from the airline's regular weekly schedule (not one-off changes), plus live status on the day."); },
    get howTo() { return t("Sign up on AirLabs and copy your API key from your account dashboard. After saving, enter your plan's monthly allowance."); },
    link: "https://airlabs.co/signup",
    get unit() { return t("requests"); },
  },
  aviationstack: {
    name: "Aviationstack",
    get summary() { return t("Free plan: 100 requests a month. Live status for today's flights; a future date takes 2–3 requests and may need a paid plan."); },
    get howTo() { return t("Copy your access key from your Aviationstack dashboard."); },
    link: "https://aviationstack.com/dashboard",
    get unit() { return t("requests"); },
  },
};

export default function FlightDataSettings({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<Settings>();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    api.flightData().then(setSettings);
  }, []);

  const run = async (label: string, fn: () => Promise<Settings>, success: (s: Settings) => string) => {
    setBusy(label);
    setMessage(undefined);
    try {
      const s = await fn();
      setSettings(s);
      setMessage({ ok: true, text: success(s) });
      onChanged();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  if (!settings) return <p className="muted">{t("Loading…")}</p>;
  const connected = settings.services.filter((s) => s.configured);

  return (
    <div className="card settings">
      <a href="#/" className="back">{t("← Back")}</a>
      <h2>{t("Flight data")}</h2>
      <p className="muted small">
        {t("Connect one or more flight data services to fill in flight details from a flight number and date, and to get live status (delays, gate changes, cancellations). The")}{" "}<b>{t("primary")}</b>{" "}{t("service is used first; if it can't find a flight, fails, or runs out of its monthly allowance, the next one is tried.")}
      </p>
      <div className={`status-line ${connected.length ? "ok" : ""}`}>
        {connected.length
          ? t("Using {v1}", { v1: connected.map((s) => INFO[s.provider].name).join(" → ") })
          : t("Not connected — using demo flight data")}
      </div>
      {message && <p className={message.ok ? "ok-text small" : "error small"}>{message.text}</p>}
      <div className="services">
        {settings.services.map((s) => (
          <ServiceCard key={s.provider} service={s} primary={settings.primary === s.provider} busy={busy} run={run} />
        ))}
      </div>
      <p className="muted tiny">{t("Keys are stored only on this computer, in")}{" "}<code>{t("data/settings.json")}</code>{" "}{t("(never in")}{" "}<code>{t(".env.example")}</code>).</p>
    </div>
  );
}

function ServiceCard({
  service: s,
  primary,
  busy,
  run,
}: {
  service: FlightService;
  primary: boolean;
  busy?: string;
  run: (label: string, fn: () => Promise<Settings>, success: (s: Settings) => string) => Promise<boolean>;
}) {
  const info = INFO[s.provider];
  const [editing, setEditing] = useState(!s.configured);
  const [apiKey, setApiKey] = useState("");
  const [route, setRoute] = useState<Route>((s.route as Route) ?? "rapidapi");
  const [allowHttp, setAllowHttp] = useState(s.allowHttp);
  const [allowance, setAllowance] = useState(String(s.usage.limit));
  const pct = Math.min(100, Math.round((s.usage.used / s.usage.limit) * 100));
  const id = (x: string) => `${x}-${s.provider}`;

  return (
    <section className={`service ${s.configured ? "on" : ""} ${primary ? "primary" : ""}`}>
      <div className="service-head">
        <b>{info.name}</b>
        {primary && <span className="tag primary-tag">{t("Primary")}</span>}
        {s.configured && !primary && <span className="tag">{t("Backup")}</span>}
        {s.configured && <span className="muted small">{s.source === "env" ? t("key {keyHint} (from .env)", { keyHint: s.keyHint }) : t("key {keyHint}", { keyHint: s.keyHint })}</span>}
      </div>
      <p className="muted small">{info.summary}</p>

      {s.configured && (
        <>
          <div className="usage-bar"><span style={{ width: `${pct}%` }} /></div>
          <p className="muted tiny">{t("{used} of {limit} {unit} used in {month}", { used: s.usage.used, limit: s.usage.limit, unit: info.unit, month: s.usage.month })}</p>
          <div className="actions start">
            {!primary && (
              <button className="ghost" disabled={!!busy} onClick={() => run(id("primary"), () => api.updateFlightData({ provider: s.provider, primary: true }), () => t("{name} is now the primary service.", { name: info.name }))}>
                {t("Make primary")}
              </button>
            )}
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => run(id("test"), () => api.testFlightData(s.provider), (r) => t("{name} works — found {sample}.", { name: info.name, sample: (r as Settings & { sample: string }).sample }))}
            >
              {busy === id("test") ? t("Testing…") : s.provider === "aerodatabox" ? t("Test (2 units)") : t("Test (1 request)")}
            </button>
            {s.source === "app" && (
              <>
                <button className="ghost" disabled={!!busy} onClick={() => setEditing((e) => !e)}>{editing ? t("Cancel") : t("Replace key")}</button>
                <button className="ghost danger" disabled={!!busy} onClick={() => confirm(t("Remove the {name} key?", { name: info.name })) && run(id("remove"), () => api.removeFlightData(s.provider), () => t("{name} key removed.", { name: info.name }))}>
                  {t("Remove")}
                </button>
              </>
            )}
          </div>
          {s.source === "app" && (
            <form
              className="allowance"
              onSubmit={(e) => {
                e.preventDefault();
                run(id("allowance"), () => api.updateFlightData({ provider: s.provider, monthlyUnits: Number(allowance) }), (r) => t("{name} allowance set to {limit}.", { name: info.name, limit: r.services.find((x) => x.provider === s.provider)?.usage.limit }));
              }}
            >
              <label>
                {t("Monthly allowance")}
                <input type="number" min={1} value={allowance} onChange={(e) => setAllowance(e.target.value)} />
              </label>
              <button type="submit" className="ghost" disabled={!!busy || !Number(allowance) || Number(allowance) === s.usage.limit}>{t("Update")}</button>
            </form>
          )}
        </>
      )}

      {(editing || !s.configured) && (
        <form
          className="key-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(id("save"), () => api.saveFlightData({ provider: s.provider, apiKey, route, allowHttp }), () => t("{name} key saved. Press “Test” to check it.", { name: info.name }));
            if (ok) {
              setApiKey("");
              setEditing(false);
            }
          }}
        >
          {s.provider === "aerodatabox" ? (
            <>
              <p className="small">
                {t("Sign up on")}{" "}<a href={ROUTES[route].signup} target="_blank" rel="noreferrer">{ROUTES[route].name.replace(/ \(.*\)/, "")}</a>. {ROUTES[route].where}
              </p>
              <label>
                {t("Get access through")}
                <select value={route} onChange={(e) => setRoute(e.target.value as Route)}>
                  {Object.entries(ROUTES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <p className="small">
              <a href={info.link} target="_blank" rel="noreferrer">{info.name}</a>: {info.howTo}
            </p>
          )}
          {s.provider === "aviationstack" && (
            <label className="checkbox">
              <input type="checkbox" checked={allowHttp} onChange={(e) => setAllowHttp(e.target.checked)} />
              <span>
                {t("Allow unencrypted HTTP if my plan requires it.")}{" "}<span className="muted">{t("The free plan may refuse secure connections; your key and lookups would then be sent unencrypted.")}</span>
              </span>
            </label>
          )}
          <div className="key-row">
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t("Paste your {name} key", { name: info.name })} aria-label={t("{name} API key", { name: info.name })} />
            <button type="submit" disabled={!!busy || apiKey.trim().length < 10}>{busy === id("save") ? t("Saving…") : t("Save key")}</button>
          </div>
        </form>
      )}
    </section>
  );
}
