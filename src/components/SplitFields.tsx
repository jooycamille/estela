import { useEffect, useState } from "react";
import type { TravellerView } from "../../shared/types.ts";
import { api } from "../api.ts";

// Splitting a booking's cost: who paid, and who shares it equally (people on the trip, and trip-mates added by name in
// Spending who don't use Estela). Settle up counts it.

export type Split = { paidBy: string; split: string[] } | null;

/** Everyone a cost can be shared with on a trip; "you" first. */
export function useSharers(tripId?: string) {
  const [people, setPeople] = useState<TravellerView[]>([]);
  useEffect(() => {
    if (!tripId) return;
    Promise.all([api.travellers(tripId).catch(() => ({ travellers: [] as TravellerView[] })), api.trip(tripId).catch(() => undefined)]).then(([t, d]) => {
      const extra = (d?.trip.spendPeople ?? []).map((p) => ({ userId: p.id, name: p.name, role: "viewer" as const, signedIn: false, you: false }));
      setPeople([...t.travellers.sort((a, b) => Number(b.you) - Number(a.you)), ...extra]);
    });
  }, [tripId]);
  return people;
}

/**
 * "Split this cost" with Paid by and Shared by. Shown only when there's more than one person to share with. `value`
 * null: not split.
 */
export default function SplitFields({ people, value, onChange, alwaysOn }: { people: TravellerView[]; value: Split; onChange: (s: Split) => void; alwaysOn?: boolean }) {
  if (people.length < 2) return null;
  const me = people.find((p) => p.you)?.userId ?? people[0].userId;
  const on = alwaysOn || !!value;
  const v = value ?? { paidBy: me, split: people.map((p) => p.userId) };
  const name = (p: TravellerView) => (p.you ? "You" : p.name);
  return (
    <fieldset className="split-fields">
      {!alwaysOn && (
        <label className="check">
          <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? v : null)} />
          Split this cost between people
        </label>
      )}
      {on && (
        <>
          <label className="split-paid">
            Paid by
            <select value={v.paidBy} onChange={(e) => onChange({ ...v, paidBy: e.target.value })}>
              {people.map((p) => <option key={p.userId} value={p.userId}>{name(p)}</option>)}
            </select>
          </label>
          <div className="split-who" role="group" aria-label="Shared by">
            <span className="split-label">Shared by</span>
            {people.map((p) => (
              <label key={p.userId} className="check">
                <input
                  type="checkbox"
                  checked={v.split.includes(p.userId)}
                  onChange={(e) => onChange({ ...v, split: e.target.checked ? [...v.split, p.userId] : v.split.filter((id) => id !== p.userId) })}
                />
                {name(p)}
              </label>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}
