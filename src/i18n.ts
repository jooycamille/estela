// Estela in your language. Text in the code is written in English and wrapped in t("…"); the English is the key, so a
// screen reads as it always did, and anything not translated yet simply shows in English. Each language's translations
// are in src/locales/<code>.json ({ "English": "translation" }), loaded once, before the app is drawn.
//
// Placeholders: t("In {n} days", { n: 3 }). Counts: tn(n, "{n} item", "{n} items") picks the right form for the
// language (in languages without plurals, the translator gives both the same).

export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "ru", name: "Русский" },
  { code: "zh", name: "中文（简体）" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "hi", name: "हिन्दी" },
  { code: "ar", name: "العربية" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
  { code: "tr", name: "Türkçe" },
  { code: "fil", name: "Filipino" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
const RTL = new Set<string>(["ar"]);
const STORE = "estela-language";

let current: LanguageCode = "en";
let dict: Record<string, string> = {};

/** The language the app is showing, as a BCP 47 tag for dates and numbers ("es", "zh-Hans"…). */
export const language = (): LanguageCode => current;
export const locale = () => (current === "zh" ? "zh-Hans" : current);
export const isEnglish = () => current === "en";

/** Values put into a text: empty ones (null, undefined, false) show as nothing, as they would on the page. */
type Vars = Record<string, string | number | boolean | null | undefined>;
const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k] == null || vars[k] === false ? "" : String(vars[k])) : m)) : text;

/** The text in the app's language (English if there's no translation for it yet). */
export function t(text: string, vars?: Vars): string {
  return fill(dict[text] || text, vars);
}

/**
 * For text kept in data (lists, tables) rather than written where it's shown: tx("Hello") marks it, so it's collected
 * for translation, and returns it as is; tv(value) translates such a value when it's shown.
 */
export const tx = <S extends string>(text: S): S => text;
export const tv = (text: string, vars?: Vars): string => t(text, vars);

/** A count with the right word form: tn(3, "{n} item", "{n} items") → "3 items" (or the language's own forms). */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const form = new Intl.PluralRules(locale()).select(n) === "one" ? one : other;
  return t(form, { n, ...vars });
}

const isLanguage = (code: string | null | undefined): code is LanguageCode => !!code && LANGUAGES.some((l) => l.code === code);

/** Which language to show: the one chosen in Account (remembered on this device), else the device's own, else English. */
export function preferredLanguage(chosen?: string | null): LanguageCode {
  if (isLanguage(chosen)) return chosen;
  try {
    const saved = localStorage.getItem(STORE);
    if (isLanguage(saved)) return saved;
  } catch {
    /* fine without */
  }
  for (const tag of typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    const code = base === "tl" ? "fil" : base; // Tagalog is written as Filipino here
    if (isLanguage(code)) return code;
  }
  return "en";
}

// Each language's file is its own small download, fetched only when it's the one in use.
// (Outside the browser, e.g. in tests, there are none: everything is in English.)
type Files = Record<string, () => Promise<{ default: Record<string, string> }>>;
let files: Files = {};
try {
  // Vite turns this into the list of language files when it builds the app; elsewhere it isn't there.
  files = import.meta.glob<{ default: Record<string, string> }>(["./locales/*.json", "!./locales/catalog.json"]);
} catch {
  /* not built by Vite (tests): English only */
}

/** Loads a language's translations and sets the page's language and direction (Arabic reads right to left). */
export async function loadLanguage(code: LanguageCode) {
  current = code;
  dict = {};
  if (code !== "en") {
    const load = files[`./locales/${code}.json`];
    dict = load ? (await load().catch(() => ({ default: {} }))).default : {};
  }
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale();
  document.documentElement.dir = RTL.has(code) ? "rtl" : "ltr";
}

/** Choosing a language in Account: remembered on this device, then the app is drawn again in it. */
export function rememberLanguage(code: LanguageCode) {
  try {
    localStorage.setItem(STORE, code);
  } catch {
    /* fine without */
  }
}
