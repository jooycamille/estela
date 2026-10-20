// Currency choices shared by price fields and the trip total.

export const COMMON_CURRENCIES = ["AUD", "USD", "EUR", "GBP", "NZD", "CAD", "MXN", "COP", "PAB", "SGD", "JPY", "PHP"];

/** Every ISO currency the browser knows (≈ 160), alphabetically. */
export function allCurrencies(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return [...COMMON_CURRENCIES].sort();
  }
}

const names = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" });
  } catch {
    return undefined;
  }
})();

/** "AUD — Australian Dollar" */
export function currencyLabel(code: string) {
  const name = names?.of(code);
  return name && name !== code ? `${code} — ${name}` : code;
}
