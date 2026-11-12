import { useEffect, useRef, useState } from "react";
import type { TripInbox } from "../../shared/types.ts";
import { api } from "../api.ts";
import { t as tr, locale } from "../i18n.ts";

const STATUS_TEXT = { get imported() { return tr("Imported"); }, get no_bookings() { return tr("No bookings found"); }, get error() { return tr("Failed"); } };

function timeAgo(iso?: string) {
  if (!iso) return tr("never");
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr("just now");
  if (s < 3600) return tr("{n} min ago", { n: Math.round(s / 60) });
  return new Date(iso).toLocaleString(locale());
}

/** The trip's forwarding address: forward booking emails here and they load into the itinerary. */
export default function ForwardingInbox({ tripId, onItemsChanged }: { tripId: string; onItemsChanged: () => void }) {
  const [inbox, setInbox] = useState<TripInbox | null>();
  const [busy, setBusy] = useState<"create" | "check" | string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const seen = useRef<number | undefined>(undefined);

  // Poll while the panel is open so newly forwarded emails show up without a refresh.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.inbox(tripId).then((i) => {
        if (!alive) return;
        setInbox(i);
        const imported = i?.emails.filter((e) => e.added + e.updated > 0).length ?? 0;
        if (seen.current !== undefined && imported > seen.current) onItemsChanged();
        seen.current = imported;
      });
    load().catch((e) => setError(e.message));
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => { alive = false; clearInterval(t); };
  }, [tripId, onItemsChanged]);

  const create = async () => {
    if (inbox && !confirm(tr("Replace this address? Emails sent to the old one will no longer be imported."))) return;
    setBusy("create");
    setError(undefined);
    try {
      setInbox(await api.createInbox(tripId));
      seen.current = 0;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const check = async () => {
    setBusy("check");
    setError(undefined);
    try {
      const r = await api.checkInbox(tripId);
      setInbox(r.inbox);
      if (r.received > 0) onItemsChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (inbox === undefined) return <p className="muted small">{tr("Loading forwarding address…")}</p>;

  return (
    <div className="inbox">
      <h4>{tr("Forward your bookings to Estela")}</h4>
      {!inbox ? (
        <>
          <p className="muted small">
            {tr("Get an email address just for this trip. Forward any airline, hotel or tour confirmation to it and the bookings are added to your itinerary automatically.")}
          </p>
          <button onClick={create} disabled={!!busy}>{busy ? tr("Creating…") : tr("Create forwarding address")}</button>
        </>
      ) : (
        <>
          <div className="address-row">
            <code className="address">{inbox.address}</code>
            <button
              className="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(inbox.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? tr("Copied ✓") : tr("Copy")}
            </button>
          </div>
          <p className="muted small">
            {inbox.provider === "mailtm"
              ? tr("Checked every {pollSeconds}s · last checked {v2}", { pollSeconds: inbox.pollSeconds, v2: timeAgo(inbox.lastCheckedAt) })
              : tr("Emails are imported as soon as they arrive")}
            {" · "}
            {inbox.provider === "mailtm" && <button className="link" onClick={check} disabled={!!busy}>{busy === "check" ? tr("Checking…") : tr("Check now")}</button>}
            {inbox.provider === "mailtm" && " · "}
            <button className="link" onClick={create} disabled={!!busy}>{tr("New address")}</button>
          </p>

          {inbox.emails.length === 0 ? (
            <p className="muted small waiting">{tr("Estela is waiting for your first email…")}</p>
          ) : (
            <ul className="inbox-log">
              {inbox.emails.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <div className="draft-row">
                    <span className={`inbox-status ${e.status}`}>{STATUS_TEXT[e.status]}</span>
                    <span className="grow">{e.subject}</span>
                    <span className="muted small">{timeAgo(e.receivedAt)}</span>
                    {e.canReimport && (
                      <button
                        type="button"
                        className="link"
                        disabled={!!busy}
                        title={tr("Read this email again and update the itinerary")}
                        onClick={async () => {
                          setBusy(e.id);
                          setError(undefined);
                          try {
                            setInbox((await api.reimportEmail(tripId, e.id)).inbox);
                            onItemsChanged();
                          } catch (err) {
                            setError((err as Error).message);
                          } finally {
                            setBusy(undefined);
                          }
                        }}
                      >
                        {busy === e.id ? tr("Re-importing…") : tr("Re-import")}
                      </button>
                    )}
                  </div>
                  <p className="muted small">
                    {e.status === "imported" && tr("{added} added{v2}", { added: e.added, v2: e.updated ? `, ${e.updated} updated` : "" })}
                    {e.status === "error" && e.error}
                    {e.status === "no_bookings" && e.preview}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {inbox.provider === "mailtm" && (
            <p className="muted tiny">
              {tr("Temporary inbox powered by")}{" "}<a href="https://mail.tm" target="_blank" rel="noreferrer">{tr("mail.tm")}</a>{tr(", a public disposable-email service. For Gmail auto-forwarding, the confirmation code Google sends will appear above.")}
            </p>
          )}
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
