// Collects every text the app shows in t("…") and tn(n, "…", "…") into src/locales/catalog.json: the English texts to
// translate, each with where it's used (which helps whoever translates it). Run: npm run i18n:extract
// Texts must be written out in the call (t("Save"), not t(label)), so they can be found here.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(f)) files.push(p);
  }
};
walk(SRC);

// A string literal: "…" or '…' (with escapes), or `…` without ${}.
const LIT = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60[^\x60$]*\x60)`;
// t("…"), or tr("…") where `t` is already taken (e.g. by a trip).
const T = new RegExp(String.raw`\b(?:tr?|tx)\(\s*${LIT}`, "g");
const TN = new RegExp(String.raw`\btn\(\s*[^,]+,\s*${LIT}\s*,\s*${LIT}`, "g");
const unquote = (s) => (s[0] === "`" ? s.slice(1, -1) : JSON.parse(s[0] === "'" ? `"${s.slice(1, -1).replace(/"/g, '\\"').replace(/\\'/g, "'")}"` : s));

const catalog = new Map(); // English → files using it
const loose = [];
for (const file of files) {
  if (file.endsWith("i18n.ts")) continue;
  const code = readFileSync(file, "utf8");
  const where = relative(ROOT, file);
  const add = (text) => catalog.set(text, new Set([...(catalog.get(text) ?? []), where]));
  for (const m of code.matchAll(T)) add(unquote(m[1]));
  for (const m of code.matchAll(TN)) {
    add(unquote(m[1]));
    add(unquote(m[2]));
  }
  // t(…) with something other than written-out text can't be translated: list them.
  for (const m of code.matchAll(/\btr?\(\s*(?!["'\x60])([^)\s][^)]{0,40})/g)) loose.push(`${where}: t(${m[1]}`);
}

const out = Object.fromEntries([...catalog].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort().join(", ")]));
writeFileSync(join(SRC, "locales", "catalog.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${catalog.size} texts in src/locales/catalog.json`);
if (loose.length) {
  console.log(`\nNot written out, so they can't be translated (${loose.length}):`);
  for (const l of loose) console.log(`  ${l}`);
  process.exitCode = 1;
}
