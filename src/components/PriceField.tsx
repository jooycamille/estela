import type { Money } from "../../shared/types.ts";
import { allCurrencies, COMMON_CURRENCIES, currencyLabel } from "../currencies.ts";
import { t } from "../i18n.ts";

export type PriceValue = { amount: string; currency: string };

export const priceValue = (p?: Money): PriceValue => ({ amount: p ? String(p.amount) : "", currency: p?.currency ?? "" });

/** Form value -> Money (undefined when left blank). Throws a user-facing message when half-filled. */
export function toMoney(v: PriceValue): Money | undefined {
  if (!v.amount.trim() && !v.currency.trim()) return undefined;
  const amount = Number(v.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(t("Enter the price as a number, e.g. 564.88"));
  const currency = v.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(t("Choose the currency for the price, e.g. USD"));
  return { amount, currency };
}

export function formatMoney(m: Money) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency, currencyDisplay: "code" }).format(m.amount);
  } catch {
    return `${m.currency} ${m.amount.toFixed(2)}`;
  }
}

export default function PriceField({ value, onChange }: { value: PriceValue; onChange: (v: PriceValue) => void }) {
  const others = allCurrencies().filter((c) => !COMMON_CURRENCIES.includes(c));
  // Keep a saved currency selectable even if this browser doesn't list it.
  const extra = value.currency && !COMMON_CURRENCIES.includes(value.currency) && !others.includes(value.currency) ? [value.currency] : [];
  return (
    <label>
      {t("Price paid")}
      <div className="price-field">
        <select
          className="currency"
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value })}
          aria-label={t("Currency")}
        >
          <option value="">{t("Currency…")}</option>
          <optgroup label={t("Common")}>
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
          </optgroup>
          <optgroup label={t("All currencies")}>
            {[...extra, ...others].map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
          </optgroup>
        </select>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          aria-label={t("Amount")}
        />
      </div>
    </label>
  );
}
