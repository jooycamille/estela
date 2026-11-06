import assert from "node:assert/strict";
import { test } from "node:test";
import { fromGuide, pickPage, tidyExtract } from "../server/describe.ts";

const page = (title: string, extract: string, index = 1, disambig = false) => ({ title, extract, index, ...(disambig ? { pageprops: { disambiguation: "" } } : {}) });

test("uses Joy's own guide first, exactly anywhere, loosely only in your country", () => {
  assert.ok(fromGuide("Tacos al pastor", "MX")?.text);
  assert.equal(fromGuide("Tacos al pastor", "MX")?.source, "guide");
  assert.ok(fromGuide("tacos al pastor", "PA")?.text);
  assert.ok(fromGuide("Lucha libre", "MX")?.text);
  assert.equal(fromGuide("Lucha libre", "PA"), undefined);
  assert.equal(fromGuide("Tacos", "MX"), undefined); // not any one kind of taco
  assert.equal(fromGuide("Hot chocolate", "MX"), undefined); // not the churros that come with it
  assert.equal(fromGuide("Something Nobody Has Heard Of", "MX"), undefined);
});

test("only an article clearly about the same thing", () => {
  assert.equal(pickPage("Tacos al pastor", [page("Al pastor", "Al pastor, or tacos al pastor, is spit-grilled pork."), page("Taco", "A taco is…", 2)])?.title, "Al pastor");
  assert.equal(pickPage("Xochimilco trajineras", [page("Trajinera", "A trajinera is a boat on Lake Xochimilco.")])?.title, "Trajinera");
  assert.equal(pickPage("Patacones", [page("Tostones", "Tostones, also called patacones, are fried plantain.")])?.title, "Tostones");
  assert.equal(pickPage("Mole poblano", [page("Poblano", "The poblano is a mild chili pepper.")]), undefined);
  assert.equal(pickPage("Coffee farm tour", [page("Farm Tour", "Farm Tour is a concert series.")]), undefined);
  // The real results for these were a sitcom, and events elsewhere.
  assert.equal(pickPage("Salsa class", [page("Here We Go (TV series)", "A British sitcom."), page("Quikr", "A marketplace.", 2)]), undefined);
  assert.equal(pickPage("Sunday bike ride", [page("Bike Week (cycling)", "A yearly event."), page("Great Victorian Bike Ride", "An annual event.", 2)]), undefined);
  assert.equal(pickPage("Temazcal", [page("Temescal", "Temazcal may refer to several things.", 1, true)]), undefined);
});

test("tidies Wikipedia's opening", () => {
  assert.equal(tidyExtract('Pozole (Spanish pronunciation: [po\'sole]; from Nahuatl languages: pozolli) is a traditional soup. It is made from hominy. It is served with radishes.').startsWith("Pozole is a traditional soup."), true);
  assert.equal(tidyExtract("A temazcal [temasˈkal] is a type of sweat lodge."), "A temazcal is a type of sweat lodge.");
  const long = tidyExtract(`${"A very long opening sentence about this thing goes on. ".repeat(10)}`);
  assert.ok(long.length <= 240);
});
