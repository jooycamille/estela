import { useEffect, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { Expense, ItineraryItem, TravellerView, Trip } from "../../shared/types.ts";
import { api } from "../api.ts";
import { balances, settleUp } from "../../shared/expenses.ts";
import ExpenseLog from "./ExpenseLog.tsx";
import SplitFields, { type Split } from "./SplitFields.tsx";
import { nowIn } from "../zones.ts";
import { COMMON_CURRENCIES, currencyLabel } from "../currencies.ts";
import { formatDay } from "../format.ts";
import { formatMoney } from "./PriceField.tsx";
import Ico from "./Ico.tsx";
import { itemIcon } from "../icons.ts";

// The Spending tab: what's booked so far, in one currency of your choice, split by category and spread across the
// trip's days, with the largest bookings and the ones still missing a price. Amounts in other currencies are converted
// at today's rates, so totals are estimates (and say so).

type Fx = Awaited<ReturnType<typeof api.fx>>;
let fxPromise: Promise<Fx> | undefined; // one request per page load, shared by every trip

type Kind = ItineraryItem["kind"] | "trip";
// Fixed order, and each category always keeps its colour (checked for colour-blind readers in light and dark).
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "flight", label: "Flights" },
  { kind: "stay", label: "Accommodation" },
  { kind: "activity", label: "Activities & transport" },
  { kind: "trip", label: "On the trip" },
];
const emptyRow = (): Record<Kind, number> => ({ flight: 0, stay: 0, activity: 0, trip: 0 });

const day = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const itemName = (i: ItineraryItem) => (i.kind === "flight" ? `${i.flightNumber} ${i.from} → ${i.to}` : i.kind === "stay" ? i.name : i.title);
const itemDay = (i: ItineraryItem) => day(i.kind === "flight" ? i.departureTime : i.kind === "stay" ? i.checkIn : i.start);

/** Amount in `to`, via the rates' base currency; undefined without a rate. */
function convert(amount: number, from: string, to: string, fx: Fx) {
  const a = fx.rates[from], b = fx.rates[to];
  return a && b ? (amount / a) * b : undefined;
}

/** When each booking's money falls: flights and activities on their day, a stay spread evenly over its nights. */
export function spendByDay(items: ItineraryItem[], value: (i: ItineraryItem) => number | undefined, expenses: Expense[] = [], expenseValue: (e: Expense) => number | undefined = () => undefined) {
  const out = new Map<string, Record<Kind, number>>();
  const add = (d: string, kind: Kind, amount: number) => {
    const row = out.get(d) ?? emptyRow();
    row[kind] += amount;
    out.set(d, row);
  };
  for (const i of items) {
    const v = value(i);
    if (!v) continue;
    if (i.kind === "stay") {
      const nights: string[] = [];
      for (let d = day(i.checkIn); d < day(i.checkOut); d = addDays(d, 1)) nights.push(d);
      if (!nights.length) nights.push(day(i.checkIn));
      for (const d of nights) add(d, "stay", v / nights.length);
    } else add(itemDay(i), i.kind, v);
  }
  for (const e of expenses) {
    const v = expenseValue(e);
    if (v) add(e.day, "trip", v);
  }
  return out;
}

/** "AUD 5,623" without cents for big round display; with cents in the details. */
const money = (amount: number, currency: string, cents = true) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: cents ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(cents ? 2 : 0)}`;
  }
};

export default function SpendingView({ trip, items, canEdit, onChanged }: { trip: Trip; items: ItineraryItem[]; canEdit: boolean; onChanged: () => void }) {
  const [people, setPeople] = useState<TravellerView[]>([]);
  useEffect(() => {
    api.travellers(trip.id).then((r) => setPeople(r.travellers)).catch(() => setPeople([]));
  }, [trip.id]);
  const me = people.find((p) => p.you)?.userId;
  // Everyone costs can be shared with: people on the trip, and trip-mates you've added by name who don't use Estela.
  const everyone: TravellerView[] = [
    ...people,
    ...(trip.spendPeople ?? []).map((p) => ({ userId: p.id, name: p.name, role: "viewer" as const, signedIn: false, you: false })),
  ];
  const expenses = trip.expenses ?? [];
  const [fx, setFx] = useState<Fx>();
  const [error, setError] = useState(false);
  const [currency, setCurrency] = useState<string>();
  const [active, setActive] = useState<string>(); // the day under your pointer (or tapped)
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    fxPromise ??= api.fx();
    fxPromise.then(setFx).catch(() => {
      fxPromise = undefined;
      setError(true);
    });
  }, []);

  const priced = items.filter((i) => i.price);
  const byCurrency = new Map<string, number>();
  for (const m of [...priced.map((i) => i.price!), ...expenses.map((e) => e.amount)]) byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.amount);
  // Default: your saved choice, else the currency most of your bookings are in.
  const mostUsed = [...byCurrency.keys()].sort((a, b) => priced.filter((i) => i.price!.currency === b).length - priced.filter((i) => i.price!.currency === a).length)[0];
  const target = currency ?? fx?.displayCurrency ?? mostUsed ?? "USD";
  const value = (i: ItineraryItem) => (i.price && fx && !error ? convert(i.price.amount, i.price.currency, target, fx) : undefined);
  const expenseValue = (e: Expense) => (fx && !error ? convert(e.amount.amount, e.amount.currency, target, fx) : undefined);
  const choose = (c: string) => {
    setCurrency(c);
    if (fxPromise) fxPromise = fxPromise.then((f) => ({ ...f, displayCurrency: c }));
    api.setDisplayCurrency(c).catch(() => {});
  };

  const log = (
    <ExpenseLog trip={trip} people={everyone} me={me} canEdit={canEdit} currency={target} money={(a, c) => money(a, c)} onChanged={onChanged} />
  );
  if (!priced.length && !expenses.length) {
    return (
      <div className="spending">
        <div className="card empty">
          <p>{items.length ? <>None of your bookings has a price yet. Add one with <b>Edit</b> on a booking (or it comes in with an imported email), and your spending shows here.</> : "Nothing booked yet. Add bookings with their prices, and what you've spent shows here."}</p>
        </div>
        {log}
      </div>
    );
  }

  const converted = priced.map((i) => ({ item: i, amount: value(i) }));
  const missingRate = [...new Set(converted.filter((c) => c.amount === undefined && fx).map((c) => c.item.price!.currency))];
  const bookedTotal = converted.reduce((s, c) => s + (c.amount ?? 0), 0);
  const spentTotal = expenses.reduce((s, e) => s + (expenseValue(e) ?? 0), 0);
  const total = bookedTotal + spentTotal;
  const missingExpenseRate = [...new Set(expenses.filter((e) => fx && expenseValue(e) === undefined).map((e) => e.amount.currency))];
  const ready = !!fx && !error;
  const original = [...byCurrency].map(([c, a]) => formatMoney({ amount: a, currency: c })).join(" + ");
  const estimate = byCurrency.size > 1 || !byCurrency.has(target);

  const kinds = KINDS.map((k) => {
    if (k.kind === "trip") return { ...k, sum: spentTotal, count: expenses.length, unpriced: 0 };
    const of = items.filter((i) => i.kind === k.kind);
    const sum = converted.filter((c) => c.item.kind === k.kind).reduce((s, c) => s + (c.amount ?? 0), 0);
    return { ...k, sum, count: of.length, unpriced: of.filter((i) => !i.price).length };
  }).filter((k) => k.count > 0);

  // Every day of the trip (and any booking outside it), with what falls on it.
  const perDay = spendByDay(items, value, expenses, expenseValue);
  const first = [trip.startDate, ...perDay.keys()].sort()[0];
  const last = [trip.endDate, ...perDay.keys()].sort().at(-1)!;
  const days: string[] = [];
  for (let d = first; d <= last && days.length < 400; d = addDays(d, 1)) days.push(d);
  const dayTotal = (d: string) => Object.values(perDay.get(d) ?? emptyRow()).reduce((a, b) => a + b, 0);
  const max = Math.max(...days.map(dayTotal), 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const labelEvery = days.length > 21 ? 7 : days.length > 10 ? 3 : 1;

  const largest = converted.filter((c) => c.amount !== undefined).sort((a, b) => b.amount! - a.amount!);
  const unpriced = items.filter((i) => !i.price);

  return (
    <div className="spending">
      <section className="card spend-hero">
        <span className="spend-label">{expenses.length ? "Booked and spent so far" : "Booked so far"}</span>
        <div className="spend-hero-row">
          <span className="spend-hero-total">
            {ready ? <>{estimate ? "≈ " : ""}{money(total, target, false)}</> : original}
          </span>
          {ready && (
            <label className="currency-pick" title="Show amounts in another currency">
              <span aria-hidden="true">{target} <ChevronDown /></span>
              <select value={target} onChange={(e) => choose(e.target.value)} aria-label="Show amounts in currency">
                <optgroup label="Your currencies & common">
                  {[...new Set([...byCurrency.keys(), ...COMMON_CURRENCIES])].filter((c) => fx!.rates[c]).map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
                </optgroup>
                <optgroup label="All currencies">
                  {Object.keys(fx!.rates).sort().map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
                </optgroup>
              </select>
            </label>
          )}
        </div>
        <p className="spend-note">
          {ready && expenses.length > 0 && <>Bookings {money(bookedTotal, target, false)} · On the trip {money(spentTotal, target, false)} · </>}
          {priced.length} of {items.length} booking{items.length === 1 ? "" : "s"} with a price
          {ready && estimate && <> · {original}</>}
        </p>
        {[...missingRate, ...missingExpenseRate].length > 0 && <p className="spend-note warning">No exchange rate for {[...new Set([...missingRate, ...missingExpenseRate])].join(", ")}, so not included.</p>}
        {ready && (
          <p className="spend-note" title={`Rates updated ${new Date(fx!.updatedAt).toLocaleDateString()}`}>
            {estimate ? `Converted at ${fx!.stale ? "the last saved" : "today's"} rates · ` : ""}
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a>
          </p>
        )}
        {error && <p className="spend-note">Exchange rates are unavailable right now, so amounts are shown in their own currencies.</p>}
      </section>

      {ready && <Budget trip={trip} total={total} target={target} fx={fx!} canEdit={canEdit} onChanged={onChanged} />}

      {ready && total > 0 && (
        <>
          <section className="card">
            <h3 className="spend-heading">By category</h3>
            {/* One whole, split: each part's share printed on it where it fits. */}
            <div className="seg-bar" role="img" aria-label={kinds.map((k) => `${k.label} ${Math.round((k.sum / total) * 100)}%`).join(", ")}>
              {kinds.filter((k) => k.sum > 0).map((k) => (
                <div key={k.kind} className={`seg cat-${k.kind}`} style={{ flexGrow: k.sum }} title={`${k.label}: ${money(k.sum, target)}`}>
                  {k.sum / total >= 0.12 && <span>{Math.round((k.sum / total) * 100)}%</span>}
                </div>
              ))}
            </div>
            <ul className="cat-rows">
              {kinds.map((k) => (
                <li key={k.kind}>
                  <span className={`swatch cat-${k.kind}`} aria-hidden="true" />
                  <span className="cat-name">
                    {k.label}
                    <span className="spend-note">
                      {k.count} {k.kind === "trip" ? `expense${k.count === 1 ? "" : "s"}` : `booking${k.count === 1 ? "" : "s"}`}{k.unpriced ? ` · ${k.unpriced} without a price` : ""}
                    </span>
                  </span>
                  <span className="cat-amount">{money(k.sum, target)}</span>
                  <span className="cat-share">{Math.round((k.sum / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="spend-heading-row">
              <h3 className="spend-heading">Across your trip</h3>
              <button type="button" className="link muted-link" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)}>{asTable ? "Show chart" : "Show as table"}</button>
            </div>
            <ul className="chart-legend" aria-hidden={asTable}>
              {kinds.map((k) => <li key={k.kind}><span className={`swatch cat-${k.kind}`} />{k.label}</li>)}
            </ul>
            {asTable ? (
              <div className="table-wrap">
                <table className="spend-table">
                  <thead><tr><th>Day</th>{kinds.map((k) => <th key={k.kind}>{k.label}</th>)}<th>Total</th></tr></thead>
                  <tbody>
                    {days.filter((d) => dayTotal(d) > 0).map((d) => (
                      <tr key={d}>
                        <td>{formatDay(d)}</td>
                        {kinds.map((k) => <td key={k.kind}>{perDay.get(d)?.[k.kind] ? money(perDay.get(d)![k.kind], target) : "—"}</td>)}
                        <td><b>{money(dayTotal(d), target)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="day-chart" onPointerLeave={() => setActive(undefined)}>
                <div className="day-chart-grid" aria-hidden="true">
                  {[...ticks].reverse().map((t) => <div key={t} className="gridline"><span>{money(t, target, false)}</span></div>)}
                </div>
                <div className="day-chart-cols" role="list" aria-label="Spending by day">
                  {days.map((d, n) => {
                    const row = perDay.get(d);
                    const sum = dayTotal(d);
                    return (
                      <div
                        key={d}
                        role="listitem"
                        className={`day-col ${active === d ? "on" : ""}`}
                        tabIndex={sum ? 0 : -1}
                        aria-label={`${formatDay(d)}: ${sum ? money(sum, target) : "nothing booked"}`}
                        onPointerEnter={() => setActive(d)}
                        onFocus={() => setActive(d)}
                        onClick={() => setActive(d)}
                      >
                        <div className="day-col-stack" style={{ height: `${(sum / top) * 100}%` }}>
                          {KINDS.filter((k) => row?.[k.kind]).map((k) => (
                            <div key={k.kind} className={`stack-seg cat-${k.kind}`} style={{ flexGrow: row![k.kind] }} />
                          ))}
                        </div>
                        {n % labelEvery === 0 && <span className="day-col-label">{formatDay(d).replace(/^\w+,\s*/, "")}</span>}
                        {active === d && sum > 0 && (
                          <div className={`chart-tip ${n > days.length * 0.6 ? "left" : ""}`} role="tooltip">
                            <b>{formatDay(d)}</b>
                            {KINDS.filter((k) => row?.[k.kind]).map((k) => (
                              <span key={k.kind} className="tip-row"><span className={`swatch cat-${k.kind}`} />{k.label}<span className="tip-amount">{money(row![k.kind], target)}</span></span>
                            ))}
                            {KINDS.filter((k) => row?.[k.kind]).length > 1 && <span className="tip-row tip-total">Total<span className="tip-amount">{money(sum, target)}</span></span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="spend-note">A stay's price is spread over its nights; flights, activities and spending fall on their day.</p>
          </section>

          <div className="spend-columns">
            <Bookings rows={largest} people={everyone} canEdit={canEdit} target={target} onChanged={onChanged} />
            {unpriced.length > 0 && <Unpriced items={unpriced} canEdit={canEdit} currency={target} onChanged={onChanged} />}
          </div>
        </>
      )}
      {log}
      {ready && <SettleUp expenses={[...expenses, ...splitBookings(items)]} people={everyone} me={me} value={expenseValue} target={target} />}
    </div>
  );
}

/** A round step for the axis (1, 2 or 5 × a power of ten), about two steps to the top. */
function niceStep(max: number) {
  const rough = max / 2;
  const pow = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
}

/** How a budget is going: on track, close (85% or more used), or over. */
export function budgetStatus(spent: number, budget: number): "on-track" | "close" | "over" {
  return spent > budget ? "over" : spent >= budget * 0.85 ? "close" : "on-track";
}

const STATUS = {
  "on-track": { label: "On track", icon: CircleCheck },
  close: { label: "Close to your budget", icon: TriangleAlert },
  over: { label: "Over budget", icon: CircleAlert },
} as const;

/**
 * Your budget for the whole trip (bookings and spending along the way): whether you're on track, close to it or over,
 * how much is left, and roughly how much a day for the days still to come.
 */
function Budget({ trip, total, target, fx, canEdit, onChanged }: { trip: Trip; total: number; target: string; fx: Fx; canEdit: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const budget = trip.budget && convert(trip.budget.amount, trip.budget.currency, target, fx);
  const [amount, setAmount] = useState(budget ? String(Math.round(budget)) : "");
  if (editing) {
    return (
      <section className="card budget-card">
        <h3 className="spend-heading">Budget</h3>
        <form
          className="budget-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Number(amount.replace(/[, ]/g, ""));
            await api.setBudget(trip.id, v > 0 ? { amount: v, currency: target } : null);
            setEditing(false);
            onChanged();
          }}
        >
          <label>For the whole trip (bookings and spending), in {target}<input autoFocus inputMode="decimal" value={amount} placeholder="e.g. 4000" onChange={(e) => setAmount(e.target.value)} /></label>
          <button type="submit">Save</button>
          <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
          {trip.budget && <button type="button" className="link danger" onClick={async () => { await api.setBudget(trip.id, null); setEditing(false); onChanged(); }}>Remove budget</button>}
        </form>
      </section>
    );
  }
  if (!budget) {
    return canEdit ? (
      <section className="card budget-card budget-empty">
        <div>
          <h3 className="spend-heading">Budget</h3>
          <p className="spend-note">Set one, and Estela shows whether you're on track, getting close or over.</p>
        </div>
        <button type="button" className="secondary" onClick={() => setEditing(true)}>Set a budget</button>
      </section>
    ) : null;
  }
  const share = total / budget;
  const status = budgetStatus(total, budget);
  const { label, icon: Icon } = STATUS[status];
  const left = budget - total;
  const today = nowIn().slice(0, 10);
  const from = today > trip.startDate ? today : trip.startDate;
  const daysLeft = today > trip.endDate ? 0 : Math.round((Date.parse(`${trip.endDate}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000) + 1;
  return (
    <section className={`card budget-card ${status}`}>
      <div className="budget-head">
        <h3 className="spend-heading">Budget</h3>
        {canEdit && <button type="button" className="link" onClick={() => setEditing(true)}>Change</button>}
      </div>
      <p className={`budget-status ${status}`}><Icon aria-hidden="true" /> {label}</p>
      <p className="budget-figures">
        <b>{money(total, target, false)}</b> of {money(budget, target, false)} <span className="muted">· {Math.round(share * 100)}%</span>
      </p>
      <div className="budget-bar" role="img" aria-label={`${Math.round(share * 100)}% of your budget used`}>
        <div className="budget-used" style={{ width: `${Math.min(share, 1) * 100}%` }} />
        <span className="budget-mark" style={{ left: "85%" }} title="85%: close to your budget" />
      </div>
      <p className="spend-note">
        {left >= 0
          ? <>{money(left, target, false)} left{daysLeft > 0 ? ` · about ${money(left / daysLeft, target, false)} a day for the ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go` : ""}.</>
          : <>{money(-left, target, false)} more than you planned{daysLeft > 0 ? `, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} to go` : ""}.</>}
        {trip.budget && trip.budget.currency !== target && <> Set in {trip.budget.currency}; shown at today's rate.</>}
      </p>
    </section>
  );
}

/** The fewest payments that even things out between the people on the trip. */
/** Bookings you've split, as shared costs for Settle up. */
const splitBookings = (items: ItineraryItem[]): Expense[] =>
  items
    .filter((i) => i.price && i.paidBy && i.split?.length)
    .map((i) => ({ id: i.id, title: itemName(i), amount: i.price!, day: itemDay(i), category: "other", paidBy: i.paidBy!, split: i.split!, addedBy: "", createdAt: "" }));

/**
 * Your priced bookings, largest first, with who paid and who shares each. Split one right here, so Settle up counts it.
 */
function Bookings({ rows, people, canEdit, target, onChanged }: {
  rows: { item: ItineraryItem; amount?: number }[];
  people: TravellerView[];
  canEdit: boolean;
  target: string;
  onChanged: () => void;
}) {
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<Split>(null);
  const shown = all ? rows : rows.slice(0, 5);
  const together = people.length > 1;
  const name = (id: string) => { const p = people.find((x) => x.userId === id); return p?.you ? "You" : p?.name ?? "someone who left"; };
  return (
    <section className="card">
      <h3 className="spend-heading">Bookings <span className="spend-count">{rows.length}</span></h3>
      {rows.length === 0 && <p className="spend-note">None of your bookings has a price yet.</p>}
      {together && rows.length > 0 && <p className="spend-note">Split a booking to share its cost in Settle up.</p>}
      <ol className="largest">
        {shown.map(({ item, amount }) => (
          <li key={item.id} className={editing === item.id ? "editing" : ""}>
            <span className={`swatch cat-${item.kind}`} aria-hidden="true" />
            <span className="cat-name">
              {itemName(item)}
              <span className="spend-note">
                {formatDay(itemDay(item))}
                {item.paidBy && item.split?.length ? <> · {name(item.paidBy)} paid, shared by {item.split.length === people.length ? "everyone" : item.split.length}</> : null}
              </span>
            </span>
            <span className="cat-amount">{money(amount!, target)}</span>
            {canEdit && together && editing !== item.id && (
              <button
                type="button"
                className="link booking-split"
                onClick={() => { setEditing(item.id); setDraft(item.paidBy && item.split?.length ? { paidBy: item.paidBy, split: item.split } : null); }}
              >
                {item.split?.length ? "Change split" : "Split"}
              </button>
            )}
            {editing === item.id && (
              <div className="booking-split-form">
                <SplitFields people={people} value={draft} onChange={setDraft} alwaysOn />
                <div className="actions left">
                  <button type="button" disabled={draft !== null && !draft.split.length} onClick={async () => {
                    const me = people.find((p) => p.you)?.userId ?? people[0].userId;
                    const v = draft ?? { paidBy: me, split: people.map((p) => p.userId) };
                    await api.setItemSplit(item.id, v);
                    setEditing(undefined);
                    onChanged();
                  }}>Save</button>
                  {item.split?.length ? <button type="button" className="secondary" onClick={async () => { await api.setItemSplit(item.id, null); setEditing(undefined); onChanged(); }}>Don't split</button> : null}
                  <button type="button" className="link" onClick={() => setEditing(undefined)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {rows.length > 5 && <button type="button" className="link unpriced-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button>}
    </section>
  );
}

function SettleUp({ expenses, people, me, value, target }: { expenses: Expense[]; people: TravellerView[]; me?: string; value: (e: Expense) => number | undefined; target: string }) {
  if (people.length < 2 || !expenses.length) return null;
  const payments = settleUp(balances(expenses, value));
  const name = (id: string) => (id === me ? "You" : people.find((p) => p.userId === id)?.name ?? "Someone who left");
  return (
    <section className="card settle">
      <h3 className="spend-heading">Settle up</h3>
      {payments.length ? (
        <ul className="settle-rows">
          {payments.map((p) => (
            <li key={`${p.from}>${p.to}`}>
              <span><b>{name(p.from)}</b> {p.from === me ? "pay" : "pays"} <b>{p.to === me ? "you" : name(p.to)}</b></span>
              <span className="cat-amount">{money(p.amount, target)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="spend-note">Everyone's even.</p>
      )}
      <p className="spend-note">From your spending on the trip and the bookings you've split, in {target}.</p>
    </section>
  );
}

/**
 * Bookings without a price: each on one line (its kind, name and date), with Add price right there, so the totals can
 * be completed without going back to the itinerary.
 */
function Unpriced({ items, canEdit, currency, onChanged }: { items: ItineraryItem[]; canEdit: boolean; currency: string; onChanged: () => void }) {
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string>();
  const shown = all ? items : items.slice(0, 6);
  return (
    <section className="card unpriced-card">
      <h3 className="spend-heading">Without a price <span className="spend-count">{items.length}</span></h3>
      <p className="spend-note">Add what each cost{canEdit ? "" : " (with Edit, by someone who can change the trip)"}, so your totals are complete.</p>
      <ul className="unpriced">
        {shown.map((i) => (
          <li key={i.id}>
            <span className={`unpriced-icon cat-${i.kind}`} aria-hidden="true"><Ico icon={itemIcon(i)} /></span>
            <span className="unpriced-name" title={itemName(i)}>{itemName(i)}</span>
            <span className="unpriced-day">{formatDay(itemDay(i)).replace(/^\w+, /, "")}</span>
            {canEdit && editing !== i.id && (
              <button type="button" className="link unpriced-add" onClick={() => setEditing(i.id)} aria-label={`Add a price for ${itemName(i)}`}>Add price</button>
            )}
            {editing === i.id && (
              <PriceRow
                currency={currency}
                onCancel={() => setEditing(undefined)}
                onSave={async (price) => {
                  await api.setItemPrice(i.id, price);
                  setEditing(undefined);
                  onChanged();
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {items.length > 6 && (
        <button type="button" className="link unpriced-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>
      )}
    </section>
  );
}

function PriceRow({ currency, onSave, onCancel }: { currency: string; onSave: (p: { amount: number; currency: string }) => Promise<void>; onCancel: () => void }) {
  const [amount, setAmount] = useState("");
  const [cur, setCur] = useState(currency);
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(",", "."));
  return (
    <form
      className="unpriced-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!(value > 0)) return;
        setBusy(true);
        await onSave({ amount: value, currency: cur }).finally(() => setBusy(false));
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <input autoFocus inputMode="decimal" placeholder="0.00" aria-label="Price" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select aria-label="Currency" value={cur} onChange={(e) => setCur(e.target.value)}>
        {[...new Set([cur, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
      </select>
      <button type="submit" disabled={busy || !(value > 0)}>Save</button>
      <button type="button" className="link" onClick={onCancel}>Cancel</button>
    </form>
  );
}
