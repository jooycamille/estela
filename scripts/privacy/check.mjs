#!/usr/bin/env node
// Blocks private data from reaching the repo. Runs by itself before each commit and push (see .githooks), or by hand:
//   npm run privacy              everything tracked now, plus every past commit
//   node scripts/privacy/check.mjs --staged     just what's about to be committed

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { FORBIDDEN_PATH, findPrivate, loadTerms } from "./terms.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const SKIP = /^(?:server\/data\/|package-lock\.json$|public\/brand\/)|\.(?:png|jpe?g|gif|ico|webp|woff2?|pdf)$/i;
const mode = process.argv[2] ?? "--all";
const show = process.argv.includes("--show"); // print the matched text (your own terminal only)
const terms = loadTerms();
const problems = [];

const scan = (where, path, text) => {
  if (FORBIDDEN_PATH.test(path)) problems.push(`${where}${path}: this file must never be committed`);
  if (SKIP.test(path) || text.includes("\0")) return;
  for (const f of findPrivate(text, terms)) problems.push(`${where}${path}:${f.line}: ${f.what}${show && f.value ? ` (${f.value})` : ""}`);
};
// Each file version is read once, however many commits contain it.
const seen = new Set();
const scanTree = (rev, label) => {
  for (const row of git("ls-tree", "-r", rev).split("\n").filter(Boolean)) {
    const [info, path] = row.split("\t");
    const sha = info.split(" ")[2];
    if (FORBIDDEN_PATH.test(path)) scan(label, path, "");
    if (FORBIDDEN_PATH.test(path) || SKIP.test(path) || seen.has(sha)) continue;
    seen.add(sha);
    scan(label, path, git("cat-file", "blob", sha));
  }
};
const scanMessages = (range) => {
  for (const f of findPrivate(git("log", "--format=%H %B", ...range), terms)) problems.push(`commit message: ${f.what}${show && f.value ? ` (${f.value})` : ""}`);
};

if (mode === "--staged") {
  for (const path of git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean)) {
    scan("", path, FORBIDDEN_PATH.test(path) || SKIP.test(path) ? "" : git("show", `:${path}`));
  }
} else if (mode === "--commit-msg") {
  for (const f of findPrivate(readMessage(process.argv[3]), terms)) problems.push(`commit message: ${f.what}`);
} else {
  // --all (and before a push): the current files and every commit that exists.
  for (const path of git("ls-files").split("\n").filter(Boolean)) {
    let text = "";
    try {
      text = FORBIDDEN_PATH.test(path) || SKIP.test(path) ? "" : readFileSync(path, "utf8");
    } catch {
      continue; // deleted but not yet committed
    }
    scan("now ", path, text);
  }
  const revs = git("rev-list", "--all").split("\n").filter(Boolean);
  for (const rev of revs) scanTree(rev, `${rev.slice(0, 7)} `);
  scanMessages(["--all"]);
}

function readMessage(path) {
  return readFileSync(path, "utf8");
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`\n✋ Private data found (${terms.length} private terms checked):\n`);
  for (const p of unique.slice(0, show ? 100000 : 60)) console.error(`  ${p}`);
  if (!show && unique.length > 60) console.error(`  …and ${unique.length - 60} more`);
  console.error("\nReplace these with made-up examples. Nothing was committed or pushed.\n");
  process.exit(1);
}
console.log(`✓ No private data found (${terms.length} private terms checked).`);
