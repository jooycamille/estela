import { useCallback, useEffect, useState } from "react";
import type { TripRole } from "../../shared/types.ts";
import { api, type InviteLink, type Travellers } from "../api.ts";
import QrLink from "./QrLink.tsx";
import { t as tr } from "../i18n.ts";

const ROLE_LABEL: Record<TripRole, string> = { get owner() { return tr("Owner"); }, get editor() { return tr("Can edit"); }, get viewer() { return tr("View only"); } };

/**
 * Who's on this trip. The owner adds people (each gets a one-time link to sign in, and then sees only the trips
 * they're on), changes what they can do, or removes them. Anyone else can see who's coming, and leave.
 */
export default function TravellersPanel({ tripId, tripName, role, onClose, onLeft }: { tripId: string; tripName: string; role: TripRole; onClose: () => void; onLeft: () => void }) {
  const [data, setData] = useState<Travellers>();
  const [name, setName] = useState("");
  const [existing, setExisting] = useState("");
  const [newRole, setNewRole] = useState<"editor" | "viewer">("editor");
  const [invite, setInvite] = useState<InviteLink>();
  const [error, setError] = useState<string>();
  const owner = role === "owner";

  const load = useCallback(() => api.travellers(tripId).then(setData).catch((e) => setError((e as Error).message)), [tripId]);
  useEffect(() => void load(), [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card travellers">
      <div className="travellers-head">
        <h3>{tr("Travellers")}</h3>
        <button type="button" className="link" onClick={onClose}>{tr("Close")}</button>
      </div>
      <p className="muted small">
        {owner ? tr("Everyone here sees this trip ({tripName}) and nothing else of yours. People who can edit can add and change bookings, lists and the checklist.", { tripName }) : tr("Everyone here sees this trip ({tripName}) and nothing else of yours.", { tripName })}
      </p>
      {error && <p className="error">{error}</p>}

      <ul className="traveller-list">
        {data?.travellers.map((t) => (
          <li key={t.userId}>
            <span className="traveller-name">
              <b>{t.name}</b>
              {t.you && <span className="muted small">{" "}{tr("(you)")}</span>}
              {!t.signedIn && t.role !== "owner" && <span className="pending">{tr("Invited, hasn't joined yet")}</span>}
            </span>
            {owner && t.role !== "owner" ? (
              <span className="traveller-actions">
                <select value={t.role} onChange={(e) => act(() => api.setTravellerRole(tripId, t.userId, e.target.value as "editor" | "viewer"))} aria-label={tr("What {name} can do", { name: t.name })}>
                  <option value="editor">{tr("Can edit")}</option>
                  <option value="viewer">{tr("View only")}</option>
                </select>
                {!t.signedIn && <button type="button" className="link" onClick={() => act(async () => setInvite(await api.travellerLink(tripId, t.userId)))}>{tr("New link")}</button>}
                <button
                  type="button"
                  className="link danger"
                  onClick={() => confirm(tr("Remove {name} from this trip? They'll no longer see it.", { name: t.name })) && act(() => api.removeTraveller(tripId, t.userId))}
                >
                  {tr("Remove")}
                </button>
              </span>
            ) : (
              <span className="muted small">{ROLE_LABEL[t.role]}</span>
            )}
          </li>
        ))}
      </ul>

      {invite && (
        <QrLink
          url={invite.url}
          title={tr("Send this to {name}", { name: invite.name })}
          note={tr("They open it, create a free account (or sign in), and the trip appears in their Estela. It works once and expires in {expiresInDays} days. Send it yourself (Messages, WhatsApp…).", { expiresInDays: invite.expiresInDays })}
        />
      )}

      {owner && (
        <form
          className="add-traveller"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const r = await api.addTraveller(tripId, existing ? { userId: existing, role: newRole } : { name: name.trim(), role: newRole });
              setInvite(r.invite ?? undefined);
              setName("");
              setExisting("");
            });
          }}
        >
          <h4>{tr("Add someone")}</h4>
          <div className="grid2">
            {data?.contacts.length ? (
              <label>
                {tr("Someone you've travelled with")}
                <select value={existing} onChange={(e) => setExisting(e.target.value)}>
                  <option value="">{tr("A new person…")}</option>
                  {data.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : null}
            {!existing && (
              <label>
                {tr("Their name")}
                <input value={name} maxLength={40} placeholder={tr("e.g. Andrés")} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label>
              {tr("They can")}
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as "editor" | "viewer")}>
                <option value="editor">{tr("Edit the trip")}</option>
                <option value="viewer">{tr("Only view it")}</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button type="submit" disabled={!existing && !name.trim()}>{tr("Add to trip")}</button>
          </div>
        </form>
      )}

      {!owner && (
        <button
          type="button"
          className="ghost"
          onClick={() => confirm(tr("Leave {tripName}? You'll no longer see it.", { tripName })) && data && act(async () => {
            await api.removeTraveller(tripId, data.travellers.find((t) => t.you)!.userId);
            onLeft();
          })}
        >
          {tr("Leave this trip")}
        </button>
      )}
    </section>
  );
}
