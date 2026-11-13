import { test } from "node:test";
import assert from "node:assert/strict";
import { check, chunks, estimate, missing } from "../scripts/i18n/translateCore.ts";

test("only texts without a translation are left to do", () => {
  const catalog = { Save: "src/components/ItemForm.tsx", Cancel: "src/components/A.tsx, src/components/B.tsx", "Go {n}": "src/x.ts" };
  const todo = missing(catalog, { Save: "Guardar", Cancel: " " });
  assert.deepEqual(todo.map((t) => t.en), ["Cancel", "Go {n}"]);
  assert.equal(todo[0].where, "A, B");
  assert.deepEqual(new Set(todo.map((t) => t.id)).size, 2);
});

test("a translation must keep the placeholders", () => {
  assert.deepEqual(check("In {n} days", "En {n} días"), { ok: true, text: "En {n} días" });
  assert.equal(check("In {n} days", "En {num} días").ok, false);
  assert.equal(check("In {n} days", "En unos días").ok, false);
  assert.equal(check("{who} invited you to {trip}", "{trip}: {who} te invitó").ok, true);
  assert.equal(check("Save", "  ").ok, false);
});

test("the English text's leading and trailing spaces are kept", () => {
  assert.deepEqual(check(" · ticked off", "· marcado "), { ok: true, text: " · marcado" });
  assert.deepEqual(check(", then ", ", luego"), { ok: true, text: ", luego " });
});

test("chunks and estimates", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const texts = missing({ "Hello there": "src/a.tsx" }, {});
  const latin = estimate(texts, "es", 500, 100);
  const thai = estimate(texts, "th", 500, 100);
  assert.equal(latin.requests, 1);
  assert.ok(thai.output > latin.output);
  assert.ok(latin.input > 500);
});
