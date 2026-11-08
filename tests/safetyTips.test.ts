import assert from "node:assert/strict";
import { test } from "node:test";
import { safetyTips } from "../server/safetyTips.ts";

test("a country has its scams and rules, linked to the advice they came from", () => {
  const tips = safetyTips("SG");
  assert.ok(tips.scams.length && tips.safety.length && tips.rules.length);
  assert.match(tips.sourceUrl, /^https:\/\/www\.gov\.uk\/foreign-travel-advice\/singapore\//);
  assert.ok(tips.checked);
});

test("a city adds its own, whichever way its name is written", () => {
  assert.ok(safetyTips("CO", "Medellín").here?.length);
  assert.ok(safetyTips("CO", "medellin").here?.length);
  assert.equal(safetyTips("CO", "Madeup Town").here, undefined);
  assert.equal(safetyTips("MX").here, undefined);
});

test("a country Estela has no tips for only points to the advice, with no guesses", () => {
  const tips = safetyTips("ZZ");
  assert.deepEqual([tips.scams, tips.safety, tips.rules, tips.checked], [[], [], [], undefined]);
  assert.equal(tips.sourceUrl, "https://www.gov.uk/foreign-travel-advice");
  assert.equal(safetyTips().sourceUrl, tips.sourceUrl);
});
