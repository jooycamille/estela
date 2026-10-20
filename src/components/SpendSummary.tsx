import { useEffect, useState } from "react";
import type { ItineraryItem } from "../../shared/types.ts";
import { api } from "../api.ts";
import { COMMON_CURRENCIES, currencyLabel } from "../currencies.ts";
import { formatMoney } from "./PriceField.tsx";

type Fx = Awaited<ReturnType<typeof api.fx>>;
let fxPromise: Promise<Fx> | undefined; // one request per page load, shared by every trip view

const CATEGORY_LABEL = { flight: "Flights", stay: "Accommodation", activity: "Activities" } as const;

function totals(items: ItineraryItem[]) {
  const byCurrency = new Map<string, number>();
  for (const i of items) if (i.price) byCurrency.set(i.price.currency, (byCurrency.get(i.price.currency) ?? 0) + i.price.amount);
  return byCurrency;
}

/** Converts via the rates' base currency (USD): amount ÷ rate[from] × rate[to]. */
function convert(byCurrency: Map<string, number>, to: string, fx: Fx) {
  let sum = 0;
  const missing: string[] = [];
  for (const [currency, amount] of byCurrency) {
    const from = fx.rates[currency];
    if (!from || !fx.rates[to]) missing.push(currency);
    else sum += (amount / from) * fx.rates[to];
  }
  return { sum, missing };
}

export default function SpendSummary({ items, category }: { items: ItineraryItem[]; category: "all" | ItineraryItem["kind"] }) {
  const [fx, setFx] = useState<Fx>();
  const [error, setError] = useState(false);
  const [currency, setCurrency] = useState<string>();

  useEffect(() => {
    fxPromise ??= api.fx();
    fxPromise.then(setFx).catch(() => {
      fxPromise = undefined;
      setError(true);
    });
  }, []);

  const all = totals(items);
  if (all.size === 0) return null;
  // Default: your saved choice, else the currency you've spent most bookings in.
  const mostUsed = [...all.keys()].sort(
    (a, b) => items.filter((i) => i.price?.currency === b).length - items.filter((i) => i.price?.currency === a).length,
  )[0];
  const target = currency ?? fx?.displayCurrency ?? mostUsed;
  const original = [...all].map(([c, a]) => formatMoney({ amount: a, currency: c })).join(" + ");

  const choose = (c: string) => {
    setCurrency(c);
    if (fxPromise) fxPromise = fxPromise.then((f) => ({ ...f, displayCurrency: c }));
    api.setDisplayCurrency(c).catch(() => {});
  };

  const mine = fx ? [...new Set([...all.keys(), ...COMMON_CURRENCIES])].filter((c) => fx.rates[c]) : [];
  const others = fx ? Object.keys(fx.rates).sort().filter((c) => !mine.includes(c)) : [];
  const label = currencyLabel;
  const total = fx ? convert(all, target, fx) : undefined;
  const sub = fx && category !== "all" ? convert(totals(items.filter((i) => i.kind === category)), target, fx) : undefined;
  const ofKind = items.filter((i) => category !== "all" && i.kind === category);
  const priced = ofKind.filter((i) => i.price).length;

  return (
    <div className="spend">
      <div className="spend-main">
        <span className="small">Booked so far</span>
        {total && !error ? (
          <>
            <b className="spend-total">
              {all.size > 1 || !all.has(target) ? "≈ " : ""}
              {formatMoney({ amount: total.sum, currency: target })}
            </b>
            <select className="currency-select" value={target} onChange={(e) => choose(e.target.value)} aria-label="Show total in currency">
              <optgroup label="Your currencies & common">
                {mine.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </optgroup>
              <optgroup label="All currencies">
                {others.map((c) => <option key={c} value={c}>{label(c)}</option>)}
              </optgroup>
            </select>
          </>
        ) : (
          <b>{original}</b>
        )}
      </div>
      {total && !error && (all.size > 1 || !all.has(target)) && <p className="muted tiny">{original}</p>}
      {sub && (
        <p className="small">
          {CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL]}: <b>{sub.sum ? `≈ ${formatMoney({ amount: sub.sum, currency: target })}` : "no prices yet"}</b>
          <span className="muted"> · {priced} of {ofKind.length} with a price{category === "flight" && priced < ofKind.length ? " (a booking's total is recorded on its first flight)" : ""}</span>
        </p>
      )}
      {total?.missing.length ? <p className="warning tiny">No exchange rate for {total.missing.join(", ")} — not included.</p> : null}
      {fx && !error && (
        <p className="muted tiny">
          Estimate using {fx.stale ? "the last saved" : "current"} rates (updated {new Date(fx.updatedAt).toLocaleDateString()}) ·{" "}
          <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a>
        </p>
      )}
      {error && <p className="muted tiny">Exchange rates are unavailable right now, so amounts are shown in their own currencies.</p>}
    </div>
  );
}
