import type { Link } from "../shared/types.ts";

// Useful links in booking emails ("Manage my booking", "View ticket", …). Emails wrap them in click-tracking
// redirects, so unwrap to the real destination and drop tracking parameters.

const WANTED: [RegExp, string][] = [
  [/\b(?:view|download|open|show|get)\s+(?:your\s+|my\s+)?(?:e-?)?tickets?\b|^(?:e-?)?tickets?$|\bvoucher\b|boarding pass/i, "Ticket"],
  [/\bmanage\s+(?:my\s+|your\s+)?(?:booking|reservation|trip)\b/i, "Manage booking"],
  [/\b(?:view|check|see)\s+(?:my\s+|your\s+)?(?:booking|reservation|trip|itinerary|order)(?:\s+details)?\b|\bsee activity details\b|\bbooking details\b/i, "Booking details"],
  [/\bcheck[\s-]?in online\b|\bonline check[\s-]?in\b/i, "Online check-in"],
];
const SKIP = /availability|unsubscribe|privacy|terms|help center|facebook|instagram|linkedin|twitter|app store|google play|go to app|directions/i;
const REDIRECT_PARAMS = ["adj_fallback", "adj_redirect", "af_web_dp", "af_r", "url", "u", "redirect", "redirect_url", "target", "destination", "dest"];
const TRACKING_PARAM = /^(?:utm_.*|mtid|partner_id|visitor_id|adj_.*|af_.*|pid|c|mc_.*|_hs.*|fbclid|gclid)$/i;

function unwrap(raw: string, depth = 0): string {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/g, "&"));
  } catch {
    return raw;
  }
  if (depth < 3) {
    for (const p of REDIRECT_PARAMS) {
      const v = url.searchParams.get(p);
      if (v && /^https?:\/\//i.test(v)) return unwrap(v, depth + 1);
    }
  }
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  return url.toString();
}

export function findLinks(raw: string): Link[] {
  const found: { label: string; url: string }[] = [];
  // Plain-text emails: "Manage your booking\n<https://…>" or "Manage your booking <https://…>"
  for (const m of raw.matchAll(/([^\n<>]{3,80}?)\s*\n?\s*<(https?:\/\/[^>\s]+)>/g)) found.push({ label: m[1].trim(), url: m[2] });
  // HTML emails: <a href="…">Manage your booking</a>
  for (const m of raw.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    found.push({ label: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), url: m[1] });
  }

  const links: Link[] = [];
  for (const { label, url } of found) {
    if (!label || SKIP.test(label) || !/^https?:/i.test(url)) continue;
    const kind = WANTED.find(([re]) => re.test(label))?.[1];
    if (!kind) continue;
    const clean = unwrap(url);
    if (/\/apps?\b|apps\.apple|play\.google/i.test(clean)) continue;
    if (links.some((l) => l.url === clean || l.label === kind)) continue;
    links.push({ label: kind, url: clean });
  }
  return links.slice(0, 4);
}
