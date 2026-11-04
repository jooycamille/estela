// What counts as private, and how to spot it. The list of terms is built on your own machine from data/ and .env,
// plus an optional .private-terms file (one per line). All of those are git-ignored; the terms never enter the repo.

import { existsSync, readFileSync } from "node:fs";

// Files that must never be committed, whatever is in them.
export const FORBIDDEN_PATH = /^(?:data\/|\.env(?:\.(?!example$)[^/]*)?$|\.private-terms$)|\.(?:eml|pem|p12|key)$|(?:^|\/)push-keys\.json$/i;

// Secrets recognisable by their shape, in anyone's checkout.
const SECRET_SHAPES = [
  [/sk-ant-[\w-]{20,}/, "Anthropic API key"],
  [/\bAIza[\w-]{35}\b/, "Google API key"],
  [/\bre_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}\b/, "Resend API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub token"],
  [/[\w-]+\.tail[0-9a-f]{4,}\.ts\.net/, "Tailscale address"],
];

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Whole words only, ignoring case and accents: "Sample St", not "Sample Stone". */
export function findPrivate(text, terms) {
  const found = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [re, label] of SECRET_SHAPES) if (re.test(line)) found.push({ line: i + 1, what: label });
    const f = fold(line);
    for (const term of terms) {
      const t = fold(term.value);
      const at = f.indexOf(t);
      if (at < 0) continue;
      const before = f[at - 1] ?? " ", after = f[at + t.length] ?? " ";
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      found.push({ line: i + 1, what: term.kind, value: term.value });
    }
  });
  return found;
}

/**
 * Terms from an address: the parts that identify a place, not the public names of cities, regions and countries
 * (those appear in guides on purpose). `isPublicPlace` says whether a part is such a name.
 */
export function addressTerms(address, isPublicPlace) {
  return address
    .split(",")
    .map((p) => p.trim().replace(/[.\s]+$/, ""))
    .filter((p) => p.length >= 5 && !isPublicPlace(p.replace(/\s*\d+\s*/g, " ").trim()));
}

const add = (terms, value, kind) => {
  const v = String(value ?? "").trim();
  if (v.length >= 5 && !terms.some((t) => fold(t.value) === fold(v))) terms.push({ value: v, kind });
};

/** Everything private this machine knows about. */
export function loadTerms(root = ".") {
  const terms = [];
  const read = (f) => (existsSync(`${root}/${f}`) ? readFileSync(`${root}/${f}`, "utf8") : undefined);

  for (const line of (read(".env") ?? "").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m) add(terms, m[2].replace(/^["']|["']$/g, ""), `value of ${m[1]}`);
  }
  // .private-terms: one term per line; "!term" marks something as fine to publish (a public place, demo data).
  const lines = (read(".private-terms") ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const allowed = new Set(lines.filter((l) => l.startsWith("!")).map((l) => fold(l.slice(1))));
  for (const line of lines) if (!line.startsWith("!")) add(terms, line, "term in .private-terms");

  const dbText = read("data/db.json");
  if (dbText) {
    const db = JSON.parse(dbText);
    const placesText = read("server/data/places.json");
    const places = placesText ? JSON.parse(placesText) : { regions: [], cities: [] };
    const publicNames = new Set([...places.regions.flatMap((r) => [r[0], r[1]]), ...places.cities.flatMap((c) => [c[0], c[1], c[3]])].filter(Boolean).map(fold));
    const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const n = regionNames.of(String.fromCharCode(a, b));
      if (n) publicNames.add(fold(n));
    }
    const isPublicPlace = (p) => publicNames.has(fold(p));

    for (const u of db.users ?? []) add(terms, u.email, "account email");
    for (const i of db.items ?? []) {
      add(terms, i.confirmationCode, "booking reference");
      if (i.kind === "stay") {
        add(terms, i.name, "stay name");
        for (const t of addressTerms(i.address ?? "", isPublicPlace)) add(terms, t, "part of a stay address");
      }
      if (i.kind === "activity") for (const t of addressTerms(i.location ?? "", isPublicPlace)) add(terms, t, "part of an activity address");
      for (const a of i.attachments ?? []) add(terms, a.filename, "attachment name");
    }
    for (const inbox of db.inboxes ?? []) add(terms, inbox.address, "trip inbox address");
    for (const t of db.trips ?? []) add(terms, t.id, "trip id");
    // Names and references in forwarded emails: "Booking ID 123", "To: Someone <a@b>".
    for (const inbox of db.inboxes ?? []) {
      for (const body of Object.values(inbox.bodies ?? {})) {
        for (const m of String(body).matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) if (!/(?:noreply|no-reply|do-not-reply|notification|support|info|help|booking|service)/i.test(m[0])) add(terms, m[0], "email address in a forwarded email");
      }
    }
  }
  return terms.filter((t) => !allowed.has(fold(t.value)));
}
