import type { EntryPhoto, ListEntry } from "../shared/types.ts";
import { IDEAS } from "./listIdeas.ts";
import { distanceKm } from "./tripPlaces.ts";

// A short description for something you typed into a list: Estela's own guide first, then Wikipedia (free, no key). A wrong
// description is worse than none, so a Wikipedia article is only used when it's clearly about the same thing.

export type Description = { text: string; source: "guide" | "wikipedia"; url?: string; image?: string; at?: { lat: number; lon: number } };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const stem = (w: string) => (w.length > 4 ? w.replace(/(?:es|s)$/, "") : w);
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2).map(stem);
const FILLER = new Set(["the", "and", "with", "for", "from", "try", "visit", "tour", "class", "lesson", "tasting", "experience", "trip", "day", "local", "best", "ride", "walk", "de", "la", "el", "los", "las", "en", "al"].map(stem));
const meaningful = (s: string) => words(s).filter((w) => !FILLER.has(w));

// What an article about something to eat or drink says near the start. "Corvina" is a fish on a Panama menu, but
// Wikipedia's page is a wine grape, so "wine" alone doesn't count.
const FOOD_WORDS = new Set(
  ["food", "dish", "cuisine", "stew", "soup", "meat", "beef", "pork", "chicken", "seafood", "bread", "pastry", "dessert", "snack", "sauce", "tortilla", "taco", "corn", "maize", "rice", "bean", "cheese", "noodle", "dumpling", "cake", "candy", "fritter", "sandwich", "drink", "beverage", "coffee", "cocktail", "beer", "liquor", "spirit", "cooked", "fried", "grilled", "baked", "braised", "roasted", "steamed", "stewed", "marinated", "barbecue", "cooking", "eaten", "culinary", "recipe", "ingredient"].map(stem),
);
const aboutFood = (extract: string) => words(extract.slice(0, 300)).some((w) => FOOD_WORDS.has(w));

// Articles about bands, records, films and people are never what a travel list means: a town can share its name
// with a rock band. Checked at the start of the article, where it says what it's about.
const MEDIA = /\b(?:is|was|are|were)\s+(?:an?|the)\s+(?:[\w'-]+\s+){0,3}?(?:band|album|song|single|film|movie|television series|tv series|sitcom|soap opera|novel|video game|singer|singer-songwriter|rapper|songwriter|musician|footballer|actor|actress|racehorse|record label|musical group|duo)\b/i;
export const aboutMedia = (extract: string) => MEDIA.test(extract.slice(0, 220));

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

type Page = { title: string; index?: number; extract?: string; pageprops?: { disambiguation?: string }; thumbnail?: { source: string }; coordinates?: { lat: number; lon: number }[] };

// Only at the start: a good article can say "may refer to" further down, about something else.
const listsMeanings = (extract: string) => /\bmay refer to\b/i.test(extract.slice(0, 120));

/** The first search result that's really about this: named by it, or naming it right at the start of the article. */
export function pickPage(name: string, pages: Page[], food = false): Page | undefined {
  const wanted = meaningful(name);
  if (!wanted.length) return;
  const sorted = [...pages]
    .sort((a, b) => (a.index ?? 9) - (b.index ?? 9))
    .filter((p) => !p.extract || (food ? aboutFood(p.extract) : !aboutMedia(p.extract)));
  // An article with exactly this name beats one that merely mentions it ("Barbacoa" isn't Birria, a kind of barbacoa).
  const exact = sorted.find((p) => !p.pageprops && p.extract && !listsMeanings(p.extract) && meaningful(p.title).sort().join(" ") === [...wanted].sort().join(" "));
  if (exact) return exact;
  const found = sorted.find((p) => {
    if (p.pageprops || !p.extract || listsMeanings(p.extract)) return false;
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
  if (found || !food) return found;
  // "Tacos de carnitas": an article on carnitas needn't mention tacos, as long as that's its whole subject.
  const filling = name.trim().match(/^\S+\s+(?:de|del|con)\s+(.+)$/i)?.[1];
  if (!filling) return;
  const subject = meaningful(filling).sort().join(" ");
  return sorted.find((p) => !p.pageprops && p.extract && !listsMeanings(p.extract) && meaningful(p.title).sort().join(" ") === subject);
}

const cache = new Map<string, Description | null>();

async function fromWikipedia(name: string, food: boolean): Promise<Description | undefined> {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: name, gsrlimit: "5", prop: "extracts|pageprops|pageimages|coordinates", exintro: "1", explaintext: "1",
    exsentences: "3", exlimit: "5", ppprop: "disambiguation", piprop: "thumbnail", pithumbsize: "640", pilimit: "5", colimit: "5", format: "json", origin: "*",
  });
  const ask = () => fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": "Estela-travel-app/0.1 (https://github.com/jooycamille/hey-joy)" }, signal: AbortSignal.timeout(5000) });
  const res = await ask().catch(ask); // one more go: the first request after a quiet spell can be slow
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } };
  const page = pickPage(name, Object.values(data.query?.pages ?? {}), food);
  if (!page?.extract) return;
  const text = tidyExtract(page.extract);
  return text ? { text, source: "wikipedia", url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, image: page.thumbnail?.source, at: page.coordinates?.[0] } : undefined;
}

/** Wikipedia's article about this, remembered while the server runs. A failed request throws, so it can be tried again. */
async function wikipedia(name: string, food: boolean) {
  const key = `${food ? "food:" : ""}${fold(name)}`;
  if (cache.has(key)) return cache.get(key) ?? undefined;
  const found = await fromWikipedia(name, food);
  cache.set(key, found ?? null);
  return found;
}

export async function describe(name: string, countryCode?: string, food = false): Promise<Description | undefined> {
  const clean = name.trim();
  if (clean.length < 3) return;
  const known = fromGuide(clean, countryCode);
  if (known) return known;
  return wikipedia(clean, food);
}

// Words that say what kind of place it is, not which one: "Museo de Zefiria" and "Museum of Zefiria" share Zefiria.
const KIND_WORDS = new Set(
  ["museo", "museum", "plaza", "square", "parque", "park", "iglesia", "church", "catedral", "cathedral", "basilica", "mercado", "market", "casa", "house",
    "calle", "street", "barrio", "comuna", "centro", "center", "centre", "jardin", "garden", "botanico", "botanical", "cerro", "hill", "mirador", "lookout",
    "san", "santa", "santo", "nuestra", "senora", "of", "del", "las", "los", "city", "ciudad", "national", "nacional", "teatro", "theatre", "theater",
    "biblioteca", "library", "universidad", "university", "estadio", "stadium", "monumento", "monument", "palacio", "palace", "puente", "bridge"].map(stem),
);
const distinctive = (s: string) => meaningful(s).filter((w) => !KIND_WORDS.has(w));

/** A photograph, not a map, logo or diagram (those are PNG or SVG). */
export const isPhoto = (url?: string) => !!url && /\.(?:jpe?g|webp)(?:\/|\?|$)/i.test(url.replace(/\/\d+px-[^/]*$/, ""));

/** Articles about places within 1 km: one sharing a distinctive word with the name is about the same place (or part of
 *  it, like a town's cathedral). */
export function pickNearby(name: string, pages: Page[]): Page | undefined {
  const wanted = distinctive(name);
  if (!wanted.length) return;
  return [...pages].sort((a, b) => (a.index ?? 9) - (b.index ?? 9)).find((p) => isPhoto(p.thumbnail?.source) && distinctive(p.title).some((w) => wanted.includes(w)));
}

async function nearbyPhoto(name: string, lat: number, lon: number): Promise<EntryPhoto | null> {
  const params = new URLSearchParams({
    action: "query", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: "1000", ggslimit: "20", prop: "pageimages",
    piprop: "thumbnail", pithumbsize: "640", pilimit: "20", format: "json", origin: "*",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": "Estela-travel-app/0.1 (https://github.com/jooycamille/hey-joy)" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } };
  const page = pickNearby(name, Object.values(data.query?.pages ?? {}));
  return page?.thumbnail ? { url: page.thumbnail.source, page: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, near: true } : null;
}

// How far a same-named article's own map position may be from the place: a town's centre can be a few km from its pin.
const PHOTO_KM = 8;

/** A photo for a place you've planned, from the Wikipedia article that's clearly about it (none rather than a wrong one).
 *  Sharing the name isn't enough (a town and a band can share one): the article must be on the map where the place is,
 *  either named like it and within a few km, or within 1 km and sharing its name. No map position, no photo. */
export async function findPhoto(name: string, at?: { lat?: number; lon?: number }): Promise<EntryPhoto | null> {
  return (await placeArticle(name, at)).photo;
}

/** The photo, and the article's opening when it's about this very place (named like it and on the map near it). */
async function placeArticle(name: string, at?: { lat?: number; lon?: number }): Promise<{ photo: EntryPhoto | null; text?: string; url?: string }> {
  const clean = name.trim();
  if (clean.length < 3 || at?.lat === undefined || at.lon === undefined) return { photo: null };
  const here = { lat: at.lat, lon: at.lon };
  const found = await wikipedia(clean, false);
  const same = found?.url && found.at && distanceKm(found.at, here) <= PHOTO_KM ? found : undefined;
  const photo = same && isPhoto(same.image) ? { url: same.image!, page: same.url!, near: true as const } : await nearbyPhoto(clean, here.lat, here.lon);
  return { photo, text: same?.text, url: same?.url };
}

// Raised when the way photos are matched changes, so places looked up the old way are looked up again.
export const PHOTO_VERSION = 3;
export const photoDue = (entry: ListEntry) => !entry.photoPicked && entry.photoLooked !== PHOTO_VERSION;

/** Looks for an entry's photo once, and fills in a description for a place that has none: Estela's guide, or the article
 *  about this very place. A failed lookup leaves it to try again next time. */
export async function fillPhoto(entry: ListEntry, countryCode?: string) {
  if (!photoDue(entry)) return false;
  const found = await placeArticle(entry.title, entry);
  entry.photo = found.photo;
  entry.photoLooked = PHOTO_VERSION;
  if (!entry.notes && !entry.noDescription) {
    const guide = fromGuide(entry.title, countryCode);
    if (guide) entry.notes = guide.text;
    else if (found.text && found.url) {
      entry.notes = found.text;
      entry.links = [...(entry.links ?? []), { label: "Wikipedia", url: found.url }];
      entry.descriptionChecked = true;
    }
  }
  return true;
}

// An article about a place further than this from the one on your list is about somewhere else with the same name.
const DESCRIBE_KM = 50;
const elsewhere = (found: Description, entry: Pick<ListEntry, "lat" | "lon">) =>
  !!found.at && entry.lat !== undefined && entry.lon !== undefined && distanceKm(found.at, { lat: entry.lat, lon: entry.lon }) > DESCRIBE_KM;

/** Fills in a list entry's description. A failed lookup throws, and an entry left blank can be tried again later. */
export async function describeEntry(entry: ListEntry, countryCode?: string, food = false) {
  const found = await describe(entry.title, countryCode, food);
  if (!found || entry.notes || elsewhere(found, entry)) return;
  entry.notes = found.text;
  entry.descriptionChecked = true;
  if (found.url) entry.links = [...(entry.links ?? []), { label: "Wikipedia", url: found.url }];
}

/** A description filled in from Wikipedia before these checks: removed if it's about a band, a film or a place far away,
 *  as long as it's still exactly what was filled in (your own edits are kept). Throws if Wikipedia can't be reached. */
export async function recheckDescription(entry: ListEntry) {
  const link = entry.links?.find((l) => l.label === "Wikipedia" && l.url.startsWith("https://en.wikipedia.org/wiki/"));
  if (!link || !entry.notes) return false;
  const title = decodeURIComponent(link.url.slice("https://en.wikipedia.org/wiki/".length)).replace(/_/g, " ");
  const params = new URLSearchParams({ action: "query", titles: title, prop: "extracts|coordinates", exintro: "1", explaintext: "1", exsentences: "3", format: "json", origin: "*" });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { "User-Agent": "Estela-travel-app/0.1 (https://github.com/jooycamille/hey-joy)" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } };
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page?.extract || tidyExtract(page.extract) !== entry.notes) return false;
  const at = page.coordinates?.[0];
  if (!aboutMedia(page.extract) && !elsewhere({ text: "", source: "wikipedia", at }, entry)) return false;
  entry.notes = undefined;
  entry.links = entry.links!.filter((l) => l !== link);
  if (!entry.links.length) entry.links = undefined;
  entry.noDescription = true; // so it isn't filled in with the same wrong article again
  return true;
}
