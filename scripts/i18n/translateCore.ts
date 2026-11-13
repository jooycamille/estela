// The parts of the translation script that don't call Claude: what's left to translate, checking a translation keeps
// what the app relies on ({placeholders}, leading and trailing spaces), and the cost estimate. Tested in
// tests/translate.test.ts.

export interface Text {
  id: number;
  en: string;
  where: string; // which screens use it, to help the translation fit
}

/** Texts in the catalog with no translation yet in this language, numbered so answers can point back at them. */
export function missing(catalog: Record<string, string>, done: Record<string, string>): Text[] {
  return Object.entries(catalog)
    .filter(([en]) => !done[en]?.trim())
    .map(([en, where], id) => ({ id, en, where: where.split(", ").map((f) => f.replace(/^.*\//, "").replace(/\.\w+$/, "")).join(", ") }));
}

export const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/**
 * A translation the app can use, or why not. The same {placeholders} as the English (they're filled in by the app),
 * and the English text's leading and trailing spaces (these texts are parts of a sentence joined to others).
 */
export function check(en: string, translated: string): { ok: true; text: string } | { ok: false; why: string } {
  const core = translated.trim();
  if (!core) return { ok: false, why: "empty" };
  if (placeholders(en) !== placeholders(core)) return { ok: false, why: `placeholders ${placeholders(en) || "none"} → ${placeholders(core) || "none"}` };
  const lead = en.match(/^\s*/)![0];
  const trail = en.match(/\s*$/)![0];
  return { ok: true, text: `${lead}${core}${trail}` };
}

/** Keys sorted the way the extractor sorts the catalog, so locale files diff cleanly. */
export const sorted = (dict: Record<string, string>) =>
  Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));

// Rough token counts: English UI text is about 4 characters a token. Other scripts take more tokens for the same text.
const OUTPUT_FACTOR: Record<string, number> = { zh: 1.4, ja: 1.6, ko: 1.8, hi: 2.6, th: 2.4, ar: 1.8, ru: 1.7, vi: 1.6 };

/** Estimated tokens to translate these texts into one language (input, output including Claude's thinking). */
export function estimate(texts: Text[], language: string, perRequestPrompt: number, chunkSize: number) {
  const requests = Math.ceil(texts.length / chunkSize);
  const textTokens = texts.reduce((n, t) => n + Math.ceil((t.en.length + t.where.length + 24) / 4), 0);
  const outTokens = texts.reduce((n, t) => n + Math.ceil(((t.en.length * 1.2) / 4) * (OUTPUT_FACTOR[language] ?? 1.3)) + 8, 0);
  const thinking = requests * 1500;
  return { requests, input: textTokens + requests * perRequestPrompt, output: outTokens + thinking };
}
