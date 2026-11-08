import assert from "node:assert/strict";
import { test } from "node:test";
import { listTheme } from "../shared/lists.ts";

test("list themes come from the name or emoji", () => {
  assert.equal(listTheme("Mexico Eats"), "food");
  assert.equal(listTheme("Mexico Places"), "sights");
  assert.equal(listTheme("Coffee in Medellín"), "drinks");
  assert.equal(listTheme("Souvenirs"), "shopping");
  assert.equal(listTheme("Beaches"), "nature");
  assert.equal(listTheme("For the kids", "🌮"), "food");
  assert.equal(listTheme("Misc"), "general");
});

test("a type picked for the list wins over its name", () => {
  assert.equal(listTheme("Coffee spots", "🏛️"), "sights");
  assert.equal(listTheme("Coffee spots", "📝"), "general");
  assert.equal(listTheme("Coffee spots", "🦜"), "drinks"); // an older list's own emoji: the name decides
});
