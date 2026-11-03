import type { PriceLevel } from "../../shared/types.ts";

// Restaurant price levels, relative to the city: $ cheap eats · $$ mid-range · $$$ splurge.

export const PRICE_LABEL: Record<PriceLevel, string> = { 1: "Cheap eats", 2: "Mid-range", 3: "Splurge" };

/** "$$" with the rest of "$$$" faded, so levels line up and read at a glance. */
export function PriceTag({ level }: { level?: PriceLevel }) {
  if (!level) return null;
  return (
    <span className="price-tag" title={`${PRICE_LABEL[level]} (for this city)`} aria-label={PRICE_LABEL[level]}>
      {"$".repeat(level)}
      <span className="price-rest">{"$".repeat(3 - level)}</span>
    </span>
  );
}

/** Choose $, $$ or $$$ (tap the chosen one again to clear it). */
export function PricePicker({ value, onChange }: { value?: PriceLevel; onChange: (level: PriceLevel | null) => void }) {
  return (
    <span className="price-picker" role="radiogroup" aria-label="Price">
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
