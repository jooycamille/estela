import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error plain JavaScript, run directly by the git hooks
import { addressTerms, FORBIDDEN_PATH, findPrivate } from "../scripts/privacy/terms.mjs";

const terms = [{ value: "12 Sample Street", kind: "address" }, { value: "ABC123", kind: "booking reference" }, { value: "Café Ejemplo", kind: "stay name" }];

test("finds private terms: any case or accent, whole words only", () => {
  assert.deepEqual(findPrivate("ok\nStay at 12 SAMPLE street now", terms), [{ line: 2, what: "address", value: "12 Sample Street" }]);
  assert.equal(findPrivate("cafe ejemplo", terms).length, 1);
  assert.equal(findPrivate("XABC1234 is a different code", terms).length, 0);
});

test("finds secrets by their shape, with no list needed", () => {
  for (const secret of ["sk-ant-" + "a".repeat(30), "AIza" + "b".repeat(35), "my-mac." + "tail12ab.ts.net", "-----BEGIN " + "PRIVATE KEY-----", "ghp_" + "c".repeat(36)])
    assert.equal(findPrivate(`x = "${secret}"`, []).length, 1, secret);
  assert.equal(findPrivate("https://your-mac.your-tailnet.ts.net", []).length, 0);
});

test("private files are refused; the template and ordinary files aren't", () => {
  for (const f of ["data/db.json", "data/attachments/a/b.pdf", ".env", ".env.local", ".private-terms", "x.eml", "a/server.pem"]) assert.ok(FORBIDDEN_PATH.test(f), f);
  for (const f of [".env.example", "server/data/airports.json", "server/index.ts", "src/data.ts"]) assert.ok(!FORBIDDEN_PATH.test(f), f);
});

test("address terms keep what identifies a place, not public city names", () => {
  const isPublic = (p: string) => ["Sample City", "Samplestan"].includes(p);
  assert.deepEqual(addressTerms("12 Sample Street, Old Quarter, Sample City 1000, Samplestan.", isPublic), ["12 Sample Street", "Old Quarter"]);
});
