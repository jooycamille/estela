import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_LANGUAGES } from "../shared/types.ts";
import { LANGUAGES, t, tn } from "../src/i18n.ts";

const dir = new URL("../src/locales/", import.meta.url);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("the server and the page offer the same languages", () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), [...APP_LANGUAGES]);
});

test("every translation keeps its {placeholders}, and every file is for a language the app offers", () => {
  const codes = new Set<string>(APP_LANGUAGES);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "catalog.json")) {
    const code = file.replace(/\.json$/, "");
    assert.ok(codes.has(code), `${file}: not one of the app's languages`);
    const dict = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Record<string, string>;
    for (const [english, translated] of Object.entries(dict)) {
      assert.equal(typeof translated, "string", `${file}: ${english}`);
      assert.deepEqual(placeholders(translated), placeholders(english), `${file}: "${english}" → "${translated}"`);
    }
  }
});

test("without a translation, text shows in English with its values filled in", () => {
  assert.equal(t("Day {day} of {days}", { day: 3, days: 12 }), "Day 3 of 12");
  assert.equal(tn(1, "{n} item", "{n} items"), "1 item");
  assert.equal(tn(4, "{n} item", "{n} items"), "4 items");
});
