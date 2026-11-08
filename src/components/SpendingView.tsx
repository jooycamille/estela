import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ItineraryItem, Trip } from "../../shared/types.ts";
import { api } from "../api.ts";
import { COMMON_CURRENCIES, currencyLabel } from "../currencies.ts";
import { formatDay } from "../format.ts";
import { formatMoney } from "./PriceField.tsx";

// The Spending tab: what's booked so far, in one currency of your choice, split by category and spread across the
// trip's days, with the largest bookings and the ones still missing a price. Amounts in other currencies are converted
// at today's rates, so totals are estimates (and say so).

type Fx = Awaited<ReturnType<typeof api.fx>>;
let fxPromise: Promise<Fx> | undefined; // one request per page load, shared by every trip

type Kind = ItineraryItem["kind"];
// Fixed order, and each category always keeps its colour (checked for colour-blind readers in light and dark).
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "flight", label: "Flights" },
  { kind: "stay", label: "Accommodation" },
  { kind: "activity", label: "Activities & transport" },
];

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
export function spendByDay(items: ItineraryItem[], value: (i: ItineraryItem) => number | undefined) {
  const out = new Map<string, Record<Kind, number>>();
  const add = (d: string, kind: Kind, amount: number) => {
    const row = out.get(d) ?? { flight: 0, stay: 0, activity: 0 };
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

export default function SpendingView({ trip, items }: { trip: Trip; items: ItineraryItem[] }) {
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
  for (const i of priced) byCurrency.set(i.price!.currency, (byCurrency.get(i.price!.currency) ?? 0) + i.price!.amount);
  // Default: your saved choice, else the currency most of your bookings are in.
  const mostUsed = [...byCurrency.keys()].sort((a, b) => priced.filter((i) => i.price!.currency === b).length - priced.filter((i) => i.price!.currency === a).length)[0];
  const target = currency ?? fx?.displayCurrency ?? mostUsed ?? "USD";
  const value = (i: ItineraryItem) => (i.price && fx && !error ? convert(i.price.amount, i.price.currency, target, fx) : undefined);
  const choose = (c: string) => {
    setCurrency(c);
    if (fxPromise) fxPromise = fxPromise.then((f) => ({ ...f, displayCurrency: c }));
    api.setDisplayCurrency(c).catch(() => {});
  };

  if (!items.length) return <div className="card empty"><p>Nothing booked yet. Add bookings with their prices, and what you've spent shows here.</p></div>;
  if (!priced.length) return <div className="card empty"><p>None of your bookings has a price yet. Add one with <b>Edit</b> on a booking (or it comes in with an imported email), and your spending shows here.</p></div>;

  const converted = priced.map((i) => ({ item: i, amount: value(i) }));
  const missingRate = [...new Set(converted.filter((c) => c.amount === undefined && fx).map((c) => c.item.price!.currency))];
  const total = converted.reduce((s, c) => s + (c.amount ?? 0), 0);
  const ready = !!fx && !error;
  const original = [...byCurrency].map(([c, a]) => formatMoney({ amount: a, currency: c })).join(" + ");
  const estimate = byCurrency.size > 1 || !byCurrency.has(target);

  const kinds = KINDS.map((k) => {
    const of = items.filter((i) => i.kind === k.kind);
    const sum = converted.filter((c) => c.item.kind === k.kind).reduce((s, c) => s + (c.amount ?? 0), 0);
    return { ...k, sum, count: of.length, unpriced: of.filter((i) => !i.price).length };
  }).filter((k) => k.count > 0);

  // Every day of the trip (and any booking outside it), with what falls on it.
  const perDay = spendByDay(items, value);
  const first = [trip.startDate, ...perDay.keys()].sort()[0];
  const last = [trip.endDate, ...perDay.keys()].sort().at(-1)!;
  const days: string[] = [];
  for (let d = first; d <= last && days.length < 400; d = addDays(d, 1)) days.push(d);
  const dayTotal = (d: string) => Object.values(perDay.get(d) ?? { flight: 0, stay: 0, activity: 0 }).reduce((a, b) => a + b, 0);
  const max = Math.max(...days.map(dayTotal), 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const labelEvery = days.length > 21 ? 7 : days.length > 10 ? 3 : 1;

  const largest = converted.filter((c) => c.amount !== undefined).sort((a, b) => b.amount! - a.amount!).slice(0, 5);
  const unpriced = items.filter((i) => !i.price);

  return (
    <div className="spending">
      <section className="card spend-hero">
        <span className="spend-label">Booked so far</span>
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
          {priced.length} of {items.length} booking{items.length === 1 ? "" : "s"} with a price
          {ready && estimate && <> · {original}</>}
        </p>
        {missingRate.length > 0 && <p className="spend-note warning">No exchange rate for {missingRate.join(", ")}, so not included.</p>}
        {ready && (
          <p className="spend-note" title={`Rates updated ${new Date(fx!.updatedAt).toLocaleDateString()}`}>
            {estimate ? `Converted at ${fx!.stale ? "the last saved" : "today's"} rates · ` : ""}
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a>
          </p>
        )}
        {error && <p className="spend-note">Exchange rates are unavailable right now, so amounts are shown in their own currencies.</p>}
      </section>

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
                      {k.count} booking{k.count === 1 ? "" : "s"}{k.unpriced ? ` · ${k.unpriced} without a price` : ""}
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
            <p className="spend-note">A stay's price is spread over its nights; flights and activities fall on their day.</p>
          </section>

          <div className="spend-columns">
            <section className="card">
              <h3 className="spend-heading">Largest bookings</h3>
              <ol className="largest">
                {largest.map(({ item, amount }) => (
                  <li key={item.id}>
                    <span className={`swatch cat-${item.kind}`} aria-hidden="true" />
                    <span className="cat-name">{itemName(item)}<span className="spend-note">{formatDay(itemDay(item))}</span></span>
                    <span className="cat-amount">{money(amount!, target)}</span>
                  </li>
                ))}
              </ol>
            </section>
            {unpriced.length > 0 && (
              <section className="card">
                <h3 className="spend-heading">Without a price</h3>
                <p className="spend-note">Add one with <b>Edit</b> on the booking in your itinerary, so the totals are complete.</p>
                <ul className="unpriced">
                  {unpriced.slice(0, 8).map((i) => <li key={i.id}><span className={`swatch cat-${i.kind}`} aria-hidden="true" />{itemName(i)}<span className="spend-note"> · {formatDay(itemDay(i))}</span></li>)}
                  {unpriced.length > 8 && <li className="spend-note">and {unpriced.length - 8} more</li>}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A round step for the axis (1, 2 or 5 × a power of ten), about two steps to the top. */
function niceStep(max: number) {
  const rough = max / 2;
  const pow = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
}
