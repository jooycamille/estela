import { IDEAS } from "./listIdeas.ts";

// A short description for something you typed into a list: Joy's own guide first, then Wikipedia (free, no key). A wrong
// description is worse than none, so a Wikipedia article is only used when it's clearly about the same thing.

export type Description = { text: string; source: "guide" | "wikipedia"; url?: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:es|s)$/, "") : w);
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).map(stem);
const FILLER = new Set(["the", "and", "with", "for", "from", "try", "visit", "tour", "class", "lesson", "tasting", "experience", "trip", "day", "local", "best", "ride", "walk", "de", "la", "el", "los", "las", "en", "al"].map(stem));
const meaningful = (s: string) => words(s).filter((w) => !FILLER.has(w));

export function fromGuide(name: string, countryCode?: string): Description | undefined {
  const wanted = meaningful(name);
  if (!wanted.length) return;
  const countries = [...(countryCode && IDEAS[countryCode] ? [countryCode] : []), ...Object.keys(IDEAS).filter((c) => c !== countryCode)];
  for (const cc of countries) {
    const ideas = IDEAS[cc];
    const hit =
      ideas.find((i) => fold(i.title) === fold(name.trim())) ??
      // A looser match only in your own country's guide: "Lucha libre" and "Lucha libre at Arena México", but "Tacos"
      // isn't "Tacos al pastor". The name must start with what you typed, and one word must be the whole name.
      (cc === countryCode
        ? ideas.find((i) => {
            const idea = meaningful(i.title);
            return wanted.every((w, n) => idea[n] === w) && (wanted.length >= 2 || idea.length === 1);
          })
        : undefined);
    if (hit?.detail) return { text: hit.detail, source: "guide" };
  }
}

/** Wikipedia's opening without pronunciation guides, kept to a sentence or two. */
export function tidyExtract(extract: string) {
  const text = extract
    .replace(/\s*\([^()]*(?:pronunciation|listen|\bUS:|\bUK:|\[)[^()]*\)/gi, "")
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()) ?? [text];
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > 240) break;
    out = out ? `${out} ${s}` : s;
    if (out.length >= 120) break;
  }
  return out;
}

type Page = { title: string; index?: number; extract?: string; pageprops?: { disambiguation?: string } };

/** The first search result that's really about this: named by it, or naming it right at the start of the article. */
export function pickPage(name: string, pages: Page[]): Page | undefined {
  const wanted = meaningful(name);
  if (!wanted.length) return;
  const sorted = [...pages].sort((a, b) => (a.index ?? 9) - (b.index ?? 9));
  return sorted.find((p) => {
    if (p.pageprops || !p.extract || /\bmay refer to\b/i.test(p.extract)) return false;
    const title = meaningful(p.title);
    const covered = title.filter((w) => wanted.includes(w)).length;
    const article = new Set(words(p.extract));
    // Named by it: every word of the title is in what you typed, and the article mentions all of what you typed (so
    // "Mole poblano" isn't the poblano pepper, and "Coffee farm tour" isn't a concert series called Farm Tour).
    if (title.length > 0 && covered === title.length && wanted.every((w) => article.has(w))) return true;
    // Or named at the start, like "Tostones … also called patacones", for a single-word name.
    const opening = new Set(words(p.extract.slice(0, 300)));
    return wanted.length === 1 && opening.has(wanted[0]);
  });
}

const cache = new Map<string, Description | null>();

async function fromWikipedia(name: string): Promise<Description | undefined> {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: name, gsrlimit: "3", prop: "extracts|pageprops", exintro: "1", explaintext: "1",
    exsentences: "3", exlimit: "3", ppprop: "disambiguation", format: "json", origin: "*",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": "HeyJoy-travel-app/0.1" }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } };
  const page = pickPage(name, Object.values(data.query?.pages ?? {}));
  if (!page?.extract) return;
  const text = tidyExtract(page.extract);
  return text ? { text, source: "wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}` } : undefined;
}

export async function describe(name: string, countryCode?: string): Promise<Description | undefined> {
  const clean = name.trim();
  if (clean.length < 3) return;
  const known = fromGuide(clean, countryCode);
  if (known) return known;
  const key = fold(clean);
  if (cache.has(key)) return cache.get(key) ?? undefined;
  // Only a real answer is remembered: a failed request (rate limited, offline) throws, so it can be tried again.
  const found = await fromWikipedia(clean);
  cache.set(key, found ?? null);
  return found;
}
