import { useState } from "react";
import { Car, Pencil, Receipt, ShoppingBag, Ticket, Trash2, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type TravellerView, type Trip } from "../../shared/types.ts";
import { api, type ExpenseInput } from "../api.ts";
import { COMMON_CURRENCIES } from "../currencies.ts";
import { formatDay } from "../format.ts";
import { nowIn } from "../zones.ts";
import { t } from "../i18n.ts";

// Spending during the trip: what you paid for (a meal, a taxi, a ticket on the day), who paid, and who it's shared by.

export const EXPENSE_LOOK: Record<ExpenseCategory, { label: string; icon: LucideIcon }> = {
  food: { get label() { return t("Food & drink"); }, icon: UtensilsCrossed },
  transport: { get label() { return t("Getting around"); }, icon: Car },
  shopping: { get label() { return t("Shopping"); }, icon: ShoppingBag },
  fun: { get label() { return t("Tickets & fun"); }, icon: Ticket },
  other: { get label() { return t("Other"); }, icon: Receipt },
};

const LAST_CURRENCY = "joy-expense-currency";
const lastCurrency = (tripId: string) => {
  try {
    return localStorage.getItem(`${LAST_CURRENCY}:${tripId}`) ?? undefined;
  } catch {
    return undefined;
  }
};

type Money = (amount: number, currency: string) => string;

export default function ExpenseLog({ trip, people, me, canEdit, currency, money, onChanged }: {
  trip: Trip;
  people: TravellerView[];
  me?: string;
  canEdit: boolean;
  currency: string; // the one you view amounts in: the default for a new expense
  money: Money;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Expense | "new">();
  const expenses = [...(trip.expenses ?? [])].sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.localeCompare(a.createdAt));
  const name = (id: string) => (id === me ? t("You") : people.find((p) => p.userId === id)?.name ?? t("Someone who left"));
  const together = people.length > 1;
  const byDay = new Map<string, Expense[]>();
  for (const e of expenses) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

  return (
    <section className="card expenses" aria-labelledby="expenses-title">
      <div className="spend-heading-row">
        <h3 className="spend-heading" id="expenses-title">{t("On the trip")}</h3>
        {canEdit && editing !== "new" && <button type="button" className="secondary small-btn" onClick={() => setEditing("new")}>{t("+ Add spending")}</button>}
      </div>
      {canEdit && <SharingWith trip={trip} people={people} me={me} onChanged={onChanged} />}
      {editing === "new" && (
        <ExpenseForm trip={trip} people={people} me={me} currency={lastCurrency(trip.id) ?? currency} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged(); }} />
      )}
      {!expenses.length && editing !== "new" && (
        <p className="spend-note">{together ? t("Meals, taxis, tickets bought on the day: add them as you go, with who paid, and Estela works out who owes whom.") : t("Meals, taxis, tickets bought on the day: add them as you go.")}</p>
      )}
      {[...byDay].map(([day, list]) => (
        <div key={day} className="expense-day">
          <span className="expense-day-head">{formatDay(day)}</span>
          <ul>
            {list.map((e) =>
              editing !== "new" && editing?.id === e.id ? (
                <li key={e.id} className="expense-editing">
                  <ExpenseForm trip={trip} people={people} me={me} initial={e} currency={e.amount.currency} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged(); }} />
                </li>
              ) : (
                <li key={e.id} className="expense">
                  <span className="expense-icon" aria-hidden="true">{(() => { const I = EXPENSE_LOOK[e.category].icon; return <I />; })()}</span>
                  <span className="cat-name">
                    {e.title}
                    <span className="spend-note">
                      {EXPENSE_LOOK[e.category].label}
                      {together && <>{" "}{(e.split.length === people.length
                        ? t("· {name} paid, shared by everyone", { name: name(e.paidBy) })
                        : e.split.length === 1
                          ? e.split[0] === e.paidBy
                            ? t("· {name} paid, just for themselves", { name: name(e.paidBy) })
                            : t("· {name} paid, for {who}", { name: name(e.paidBy), who: name(e.split[0]) })
                          : t("· {name} paid, shared by {n}", { name: name(e.paidBy), n: e.split.length }))}</>}
                    </span>
                  </span>
                  <span className="cat-amount">{money(e.amount.amount, e.amount.currency)}</span>
                  {canEdit && (
                    <span className="expense-actions">
                      <button type="button" className="prep-action" aria-label={t("Edit {title}", { title: e.title })} title={t("Edit")} onClick={() => setEditing(e)}><Pencil aria-hidden="true" /></button>
                      <button type="button" className="prep-action danger" aria-label={t("Delete {title}", { title: e.title })} title={t("Delete")} onClick={() => confirm(t("Delete \"{title}\"?", { title: e.title })) && api.deleteExpense(trip.id, e.id).then(onChanged)}><Trash2 aria-hidden="true" /></button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ExpenseForm({ trip, people, me, initial, currency, onCancel, onSaved }: {
  trip: Trip;
  people: TravellerView[];
  me?: string;
  initial?: Expense;
  currency: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const today = nowIn().slice(0, 10);
  const defaultDay = today < trip.startDate ? trip.startDate : today > trip.endDate ? trip.endDate : today;
  const everyone = people.map((p) => p.userId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amount.amount) : "");
  const [cur, setCur] = useState(initial?.amount.currency ?? currency);
  const [day, setDay] = useState(initial?.day ?? defaultDay);
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "food");
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? me ?? everyone[0] ?? "");
  const [split, setSplit] = useState<string[]>(initial?.split ?? (everyone.length ? everyone : me ? [me] : []));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(",", "."));

  return (
    <form
      className="expense-form"
      onSubmit={async (ev) => {
        ev.preventDefault();
        setError(undefined);
        setBusy(true);
        const body: ExpenseInput = { title: title.trim(), amount: { amount: value, currency: cur }, day, category, paidBy, split };
        try {
          if (initial) await api.updateExpense(trip.id, initial.id, body);
          else await api.addExpense(trip.id, body);
          try { localStorage.setItem(`${LAST_CURRENCY}:${trip.id}`, cur); } catch { /* fine without */ }
          onSaved();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="expense-form-row">
        <label className="grow">{t("What")}{" "}<input autoFocus required maxLength={120} value={title} placeholder={t("e.g. Dinner, taxi to the hotel")} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="amount">{t("Amount")}{" "}<input required inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="cur">{t("Currency")}
          <select value={cur} onChange={(e) => setCur(e.target.value)}>
            {[...new Set([cur, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="expense-form-row">
        <label>{t("Day")}{" "}<input type="date" required value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label>{t("Kind")}
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_LOOK[c].label}</option>)}
          </select>
        </label>
        {people.length > 1 && (
          <label>{t("Paid by")}
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.userId === me ? t("You") : p.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {people.length > 1 && (
        <fieldset className="expense-split">
          <legend>{t("Shared by")}</legend>
          {people.map((p) => (
            <label key={p.userId} className="check">
              <input type="checkbox" checked={split.includes(p.userId)} onChange={(e) => setSplit(e.target.checked ? [...split, p.userId] : split.filter((id) => id !== p.userId))} />
              {p.userId === me ? t("You") : p.name}
            </label>
          ))}
          {split.length > 0 && value > 0 && <span className="spend-note">{t("{v1} {cur} each", { v1: (value / split.length).toFixed(2), cur })}</span>}
        </fieldset>
      )}
      {error && <p className="error small">{error}</p>}
      <div className="actions left">
        <button type="submit" disabled={busy || !title.trim() || !(value > 0) || !split.length}>{initial ? t("Save") : t("Add")}</button>
        <button type="button" className="secondary" onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

/**
 * Who costs are shared with: the people on the trip, plus trip-mates who don't use Estela, added by name (they can't
 * sign in or see the trip; they're just there so spending divides properly).
 */
function SharingWith({ trip, people, me, onChanged }: { trip: Trip; people: TravellerView[]; me?: string; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const extra = new Set((trip.spendPeople ?? []).map((p) => p.id));
  return (
    <div className="sharing">
      <span className="sharing-label">{t("Sharing costs")}</span>
      <ul className="sharing-people">
        {people.map((p) => (
          <li key={p.userId} className={extra.has(p.userId) ? "extra" : ""} title={extra.has(p.userId) ? t("Not on Estela: here to share costs with") : undefined}>
            {p.userId === me ? t("You") : p.name}
            {extra.has(p.userId) && (
              <button
                type="button"
                className="chip-x"
                aria-label={t("Remove {name}", { name: p.name })}
                onClick={() => api.removeSpendPerson(trip.id, p.userId).then(onChanged).catch((e) => setError(e.message))}
              >
                ×
              </button>
            )}
          </li>
        ))}
        <li className="sharing-add">
          {adding ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!name.trim()) return;
                setError(undefined);
                try {
                  await api.addSpendPerson(trip.id, name.trim());
                  setName("");
                  setAdding(false);
                  onChanged();
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <input autoFocus maxLength={40} value={name} placeholder={t("Their name")} aria-label={t("Trip-mate's name")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
              <button type="submit" className="small-btn" disabled={!name.trim()}>{t("Add")}</button>
            </form>
          ) : (
            <button type="button" className="link" onClick={() => setAdding(true)}>{t("+ Add someone")}</button>
          )}
        </li>
      </ul>
      {error && <p className="error small">{error}</p>}
      {(trip.spendPeople?.length ?? 0) === 0 && !adding && (
        <p className="spend-note">{t("Travelling with someone who doesn't use Estela? Add them here to split costs with them too.")}</p>
      )}
    </div>
  );
}
