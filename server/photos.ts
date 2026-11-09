import type { PhotoChoice } from "../shared/types.ts";

// Photos to choose from for a place: ones taken there (geotagged on Wikimedia Commons), or found by searching Commons.
// Commons photos are free to use; each keeps a link to its page, which credits the photographer and gives the licence.

const UA = "Estela-travel-app/0.1 (https://github.com/jooycamille/hey-joy)";
const API = "https://commons.wikimedia.org/w/api.php";
const cache = new Map<string, { at: number; value: PhotoChoice[] }>();

type Page = { title: string; imageinfo?: { thumburl?: string; descriptionurl?: string; mime?: string; width?: number; height?: number }[]; index?: number };

async function ask(params: Record<string, string>): Promise<PhotoChoice[]> {
  const key = JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.value;
  const res = await fetch(`${API}?${new URLSearchParams({ ...params, prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: "640", format: "json", origin: "*" })}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}`);
  const body = (await res.json()) as { query?: { pages?: Record<string, Page> }; error?: { info?: string } };
  if (body.error) throw new Error(body.error.info ?? "Wikimedia Commons couldn't answer");
  const pages = Object.values(body.query?.pages ?? {});
  const value = pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ p, info: p.imageinfo?.[0] }))
    // Photos only (no maps, logos or diagrams, which are PNG or SVG), and not tiny ones.
    .filter(({ info }) => info?.thumburl && info.descriptionurl && /^image\/(jpeg|webp)$/.test(info.mime ?? "") && (info.width ?? 0) >= 400)
    .map(({ p, info }) => ({ url: info!.thumburl!, page: info!.descriptionurl!, title: p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "") }));
  if (value.length) cache.set(key, { at: Date.now(), value }); // nothing found may be a hiccup: ask again next time
  return value;
}

/** Photos taken within a few hundred metres of a place, nearest first. */
export const photosNear = (lat: number, lon: number) =>
  ask({ action: "query", generator: "geosearch", ggsnamespace: "6", ggscoord: `${lat}|${lon}`, ggsradius: "400", ggslimit: "24" });

/** Photos found by words ("Jericó botanical garden"). */
export const searchPhotos = (q: string) =>
  ask({ action: "query", generator: "search", gsrnamespace: "6", gsrsearch: `${q} filetype:bitmap`, gsrlimit: "24" });

/** Only photos from Wikimedia can be picked by address (an image from anywhere could track who looks at it). */
export const isCommonsPhoto = (url: string, page: string) =>
  /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url) && /^https:\/\/(commons|[a-z]+)\.wikimedia\.org\/wiki\/|^https:\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(page);
