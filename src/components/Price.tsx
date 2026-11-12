import type { PriceLevel } from "../../shared/types.ts";
import { t } from "../i18n.ts";

// Restaurant price levels, relative to the city: $ cheap eats · $$ mid-range · $$$ splurge.

export const PRICE_LABEL: Record<PriceLevel, string> = { get 1() { return t("Cheap eats"); }, get 2() { return t("Mid-range"); }, get 3() { return t("Splurge"); } };

/** "$$" with the rest of "$$$" faded, so levels line up and read at a glance. */
export function PriceTag({ level }: { level?: PriceLevel }) {
  if (!level) return null;
  return (
    <span className="price-tag" title={t("{v1} (for this city)", { v1: PRICE_LABEL[level] })} aria-label={PRICE_LABEL[level]}>
      {"$".repeat(level)}
      <span className="price-rest">{"$".repeat(3 - level)}</span>
    </span>
  );
}

/** Choose $, $$ or $$$ (tap the chosen one again to clear it). */
export function PricePicker({ value, onChange }: { value?: PriceLevel; onChange: (level: PriceLevel | null) => void }) {
  return (
    <span className="price-picker" role="radiogroup" aria-label={t("Price")}>
      {([1, 2, 3] as const).map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          title={PRICE_LABEL[level]}
          className={value === level ? "on" : ""}
          onClick={() => onChange(value === level ? null : level)}
        >
          {"$".repeat(level)}
        </button>
      ))}
    </span>
  );
}
