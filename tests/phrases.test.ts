import assert from "node:assert/strict";
import { test } from "node:test";
import { PHRASE_KEYS, phrasebooks } from "../src/phrases.ts";

const LANGS = ["es", "pt", "fr", "it", "de", "nl", "ja", "zh", "ko", "th", "vi", "id", "tr", "el", "ar"];
const COUNTRY = { es: "ES", pt: "BR", fr: "FR", it: "IT", de: "DE", nl: "NL", ja: "JP", zh: "CN", ko: "KR", th: "TH", vi: "VN", id: "ID", tr: "TR", el: "GR", ar: "AE" } as const;

test("every phrase in every language says how it sounds", () => {
  const books = phrasebooks(LANGS.map((l) => COUNTRY[l as keyof typeof COUNTRY]));
  assert.equal(books.length, LANGS.length);
  for (const b of books) {
    assert.equal(b.phrases.length, PHRASE_KEYS.length, b.lang);
    for (const p of b.phrases) {
      assert.ok(p.like, `${b.lang}: ${p.en}`);
      assert.match(p.like!, /^[a-zA-Z' …/,.-]+$/, `${b.lang}: ${p.like}`); // plain English letters, readable without a key
      if (p.say.includes("…")) assert.ok(p.like!.includes("…"), `${b.lang}: ${p.en} keeps the gap`);
    }
  }
});

test("English isn't suggested, and a language spoken in two trip countries is one list", () => {
  const books = phrasebooks(["GB", "ES", "MX"]);
  assert.deepEqual(books.map((b) => [b.lang, b.countries]), [["es", ["ES", "MX"]]]);
  assert.match(books[0].phrases[8].like!, /KWAN-toh KWES-tah/);
});
